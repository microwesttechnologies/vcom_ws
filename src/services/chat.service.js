const pool = require('../db/pool');
const userDirectoryService = require('./userDirectory.service');
const { canChatBetween, isAdminActor, isAdminRole, toRoleGroup } = require('../utils/roles');

function canonicalPair(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  return aStr < bStr ? [aStr, bStr] : [bStr, aStr];
}

function enrichAdminFromJwt(token, currentUser) {
  if (isAdminActor(currentUser)) {
    return {
      ...currentUser,
      role_user: isAdminRole(currentUser.role_user) ? currentUser.role_user : 'admin',
    };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(String(token || '').split('.')[1] || '', 'base64').toString('utf8'),
    );
    const role = payload?.role_user ?? payload?.role ?? '';
    const roleId = Number(payload?.role_id ?? payload?.id_role ?? NaN);
    if (isAdminRole(role) || roleId === 5) {
      return {
        ...currentUser,
        role_user: 'admin',
        role_id: Number.isFinite(roleId) ? roleId : 5,
      };
    }
  } catch (_) {
    // noop
  }

  return currentUser;
}

class ChatService {
  async ensureConversation({ token, currentUser, otherUserId }) {
    if (String(currentUser.id_user) === String(otherUserId)) {
      const error = new Error('No puedes crear una conversacion contigo mismo');
      error.status = 400;
      throw error;
    }

    // Panel web Admin: asegurar detección aunque /permissions no traiga role_user.
    const actor = enrichAdminFromJwt(token, currentUser);

    const allowedContacts = await userDirectoryService.getAllowedContacts(
      token,
      actor.role_user,
      actor.id_user,
      actor,
    );
    let otherUser = (allowedContacts || []).find(
      (item) => String(item.id_user) === String(otherUserId),
    ) || null;

    // Resolver por directorios Laravel (id_model / id_employee del panel).
    if (!otherUser?.id_user) {
      try {
        otherUser = await userDirectoryService.resolveDirectoryContactById(token, otherUserId);
      } catch (_) {
        // noop
      }
    }

    if (!otherUser?.id_user && isAdminActor(actor)) {
      try {
        const resolved = await userDirectoryService.getUserById(token, otherUserId);
        if (resolved?.id_user) otherUser = resolved;
      } catch (_) {
        // noop
      }
    }

    if (!otherUser?.id_user) {
      const error = new Error('Usuario destino no encontrado');
      error.status = 404;
      throw error;
    }

    const otherGroup = toRoleGroup(otherUser.role_user);
    const adminOk =
      isAdminActor(actor) && (otherGroup === 'model' || otherGroup === 'monitor');

    if (!adminOk && !canChatBetween(actor.role_user, otherUser.role_user)) {
      const error = new Error('Roles incompatibles: solo modelo <-> monitor');
      error.status = 400;
      throw error;
    }

    const [participantA, participantB] = canonicalPair(actor.id_user, otherUser.id_user);

    const existing = await pool.query(
      `SELECT id_conversation, participant_a, participant_b, created_at, updated_at, last_message_at
       FROM chat_conversations
       WHERE participant_a = $1 AND participant_b = $2`,
      [participantA, participantB],
    );

    if (existing.rowCount > 0) {
      return { conversation: existing.rows[0], created: false };
    }

    const created = await pool.query(
      `INSERT INTO chat_conversations (participant_a, participant_b)
       VALUES ($1, $2)
       RETURNING id_conversation, participant_a, participant_b, created_at, updated_at, last_message_at`,
      [participantA, participantB],
    );

    return { conversation: created.rows[0], created: true };
  }
