const vcomApiService = require('./vcomApi.service');
const pool = require('../db/pool');
const { toRoleGroup } = require('../utils/roles');

const MOCK_ENABLED = String(process.env.CHAT_ENABLE_MOCK_USERS || 'false').toLowerCase() === 'true';
const MOCK_USERS = [
  {
    id_user: 'mock-tes1',
    name_user: 'tes1',
    role_user: 'modelo',
    is_online: false,
    last_seen: null,
  },
  {
    id_user: 'mock-test2',
    name_user: 'test2',
    role_user: 'monitor',
    is_online: false,
    last_seen: null,
  },
];

function getMockUserById(userId) {
  return MOCK_USERS.find((item) => String(item.id_user) === String(userId)) || null;
}

function unwrapCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.users)) return payload.users;
  if (payload.data && Array.isArray(payload.data.data)) return payload.data.data;
  if (payload.result && Array.isArray(payload.result)) return payload.result;

  return [];
}

function unwrapEntity(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.user && typeof payload.user === 'object') return payload.user;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

function mapUser(raw) {
  const source = raw && typeof raw === 'object'
    ? (
      (raw.user && typeof raw.user === 'object' && raw.user) ||
      (raw.employee && typeof raw.employee === 'object' && raw.employee) ||
      (raw.model && typeof raw.model === 'object' && raw.model) ||
      raw
    )
    : {};

  const inferredRole =
    source.role_user ??
    source.role ??
    raw.role_user ??
    raw.role ??
    ((raw.id_model != null || raw.model != null) ? 'modelo' : null) ??
    ((raw.id_employee != null || raw.employee != null) ? 'monitor' : null) ??
    'unknown';

  const resolvedName =
    source.name_user ??
    source.full_name ??
    source.name ??
    source.artistic_name ??
    source.username ??
    source.social_username ??
    raw.name_user ??
    raw.full_name ??
    raw.name ??
    raw.artistic_name ??
    raw.username ??
    raw.social_username ??
    raw.model_name ??
    raw.employee_name ??
    'Sin nombre';

  return {
    id_user: String(
      source.id_user ??
      source.id ??
      raw.id_user ??
      raw.user_id ??
      raw.id_model ??
      raw.id_employee ??
      raw.id ??
      '',
    ),
    name_user: String(resolvedName).trim() || 'Sin nombre',
    role_user: inferredRole,
    is_online: Boolean(source.is_online ?? raw.is_online),
    last_seen: source.last_seen ?? raw.last_seen ?? null,
  };
}

function toInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function getMonitorRoleIds(token) {
  try {
    const rolesPayload = await vcomApiService.getRoles(token);
    const roles = unwrapCollection(rolesPayload);
    const ids = new Set();

    for (const role of roles) {
      const name = String(role?.name_role ?? role?.role_name ?? role?.name ?? '')
        .trim()
        .toLowerCase();
      if (!name.includes('monitor')) continue;
      const id = toInt(role?.id_role ?? role?.id);
      if (id != null) ids.add(id);
    }

    if (ids.size > 0) return ids;
  } catch (_) {}

  return new Set([3]);
}

class UserDirectoryService {
  async getCurrentUser(token) {
    if (MOCK_ENABLED && (token === 'mock-tes1' || token === 'mock-test2')) {
      return getMockUserById(token.replace('mock-', 'mock-'));
    }

    const data = await vcomApiService.getPermissions(token);
    const user = data.user || {};
    const role = user.role_user || data.role?.name_role || data.role?.role_user || null;

    return {
      id_user: String(user.id_user ?? user.id ?? ''),
      name_user: user.name_user ?? user.name ?? 'Usuario',
      role_user: role ?? 'unknown',
    };
  }

  async getUserById(token, userId) {
    if (MOCK_ENABLED) {
      const mockUser = getMockUserById(userId);
      if (mockUser) return mockUser;
    }

    const data = await vcomApiService.getUserById(token, userId);
    return mapUser(unwrapEntity(data));
  }

  async getAllowedContacts(token, currentUserRole, currentUserId) {
    const currentGroup = toRoleGroup(currentUserRole);

    if (MOCK_ENABLED && String(currentUserId).startsWith('mock-')) {
      const mockAllowed = MOCK_USERS
        .filter((item) => item.id_user !== String(currentUserId))
        .filter((item) => {
          const group = toRoleGroup(item.role_user);
          return (currentGroup === 'model' && group === 'monitor') ||
            (currentGroup === 'monitor' && group === 'model');
        });
      return mockAllowed;
    }

    let users = [];
    let usersFromRoleEndpoints = false;

    try {
      if (currentGroup === 'monitor') {
        const modelsPayload = await vcomApiService.getModels(token);
        users = unwrapCollection(modelsPayload);
        usersFromRoleEndpoints = true;
      } else if (currentGroup === 'model') {
        const employeesPayload = await vcomApiService.getEmployees(token);
        const employees = unwrapCollection(employeesPayload);
        const monitorRoleIds = await getMonitorRoleIds(token);
        users = (Array.isArray(employees) ? employees : []).filter((employee) => {
          const roleText = String(employee?.role_user ?? employee?.role ?? employee?.name_role ?? '')
            .trim()
            .toLowerCase();
          if (roleText.includes('monitor')) return true;

          const idRole = toInt(employee?.id_role);
          return idRole != null && monitorRoleIds.has(idRole);
        });
        usersFromRoleEndpoints = true;
      } else {
        const usersPayload = await vcomApiService.getUsers(token);
        users = unwrapCollection(usersPayload);
      }
    } catch (_) {
      const usersPayload = await vcomApiService.getUsers(token);
      users = unwrapCollection(usersPayload);
      usersFromRoleEndpoints = false;
    }

    const allowedBase = (Array.isArray(users) ? users : [])
      .map(mapUser)
      .filter((user) => user.id_user && user.id_user !== String(currentUserId))
      .filter((user) => {
        if (usersFromRoleEndpoints && (currentGroup === 'model' || currentGroup === 'monitor')) {
          return true;
        }
        const group = toRoleGroup(user.role_user);
        return (currentGroup === 'model' && group === 'monitor') ||
          (currentGroup === 'monitor' && group === 'model');
      });

    let allowed = allowedBase;

    if (MOCK_ENABLED) {
      const mockAllowed = MOCK_USERS
        .filter((item) => item.id_user !== String(currentUserId))
        .filter((item) => {
          const group = toRoleGroup(item.role_user);
          return (currentGroup === 'model' && group === 'monitor') ||
            (currentGroup === 'monitor' && group === 'model');
        });

      const byId = new Map(allowed.map((item) => [String(item.id_user), item]));
      for (const mock of mockAllowed) {
        if (!byId.has(String(mock.id_user))) {
          byId.set(String(mock.id_user), mock);
        }
      }
      allowed = Array.from(byId.values());
    }

    if (allowed.length === 0) return allowed;

    const ids = allowed.map((item) => item.id_user);
    const presenceResult = await pool.query(
      `SELECT user_id, is_online, last_seen
       FROM chat_user_presence
       WHERE user_id = ANY($1::text[])`,
      [ids],
    );

    const presenceMap = new Map(
      presenceResult.rows.map((row) => [
        String(row.user_id),
        {
          is_online: row.is_online === true,
          last_seen: row.last_seen ?? null,
        },
      ]),
    );

    const merged = allowed.map((item) => {
      const presence = presenceMap.get(item.id_user);
      if (!presence) return item;
      return {
        ...item,
        is_online: presence.is_online,
        last_seen: presence.last_seen,
      };
    });

    merged.sort((a, b) => {
      if (a.is_online === b.is_online) {
        return String(a.name_user).localeCompare(String(b.name_user));
      }
      return a.is_online ? -1 : 1;
    });

    return merged;
  }
}

module.exports = new UserDirectoryService();
