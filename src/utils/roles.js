function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Mapea cualquier variante del nombre de rol a un grupo canonico.
 *
 * Se evalua 'monitor' primero: nombres como "monitor de modelos"
 * contienen ambas palabras; sin ese orden se clasificarian como 'model'.
 * Admin hereda el grupo monitor (misma experiencia en la app móvil).
 */
function toRoleGroup(role) {
  const normalized = normalizeRole(role);
  // Admin se evalúa aparte con isAdminActor; aquí solo agrupa peers de chat.
  if (normalized.includes('monitor')) return 'monitor';
  if (normalized.includes('admin')) return 'monitor';
  if (normalized.includes('model') || normalized.includes('modal')) return 'model';
  return 'other';
}

function isAdminRole(role) {
  return normalizeRole(role).includes('admin');
}

/** Admin por nombre de rol o role_id (Laravel: Admin = 5). */
function isAdminActor(userOrRole, roleId = null) {
  if (userOrRole && typeof userOrRole === 'object') {
    if (isAdminRole(userOrRole.role_user ?? userOrRole.role)) return true;
    const id = Number(userOrRole.role_id ?? userOrRole.id_role ?? roleId);
    return id === 5;
  }
  if (isAdminRole(userOrRole)) return true;
  return Number(roleId) === 5;
}

function canChatBetween(roleA, roleB) {
  // Admin (panel web) puede chatear con modelos y monitores.
  if (isAdminRole(roleA) || isAdminRole(roleB)) {
    const other = isAdminRole(roleA) ? toRoleGroup(roleB) : toRoleGroup(roleA);
    return other === 'model' || other === 'monitor';
  }

  const a = toRoleGroup(roleA);
  const b = toRoleGroup(roleB);
  return (a === 'model' && b === 'monitor') || (a === 'monitor' && b === 'model');
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

/** Completa role_user/role_id Admin desde JWT (permissions a veces no trae el rol). */
function enrichAdminFromJwt(token, currentUser) {
  const user = currentUser && typeof currentUser === 'object' ? currentUser : { role_user: currentUser };
  if (isAdminActor(user)) {
    return {
      ...user,
      role_user: isAdminRole(user.role_user) ? user.role_user : 'admin',
    };
  }

  const payload = decodeJwtPayload(token);
  if (payload) {
    const role = payload?.role_user ?? payload?.role ?? '';
    const roleId = Number(payload?.role_id ?? payload?.id_role ?? NaN);
    if (isAdminRole(role) || roleId === 5) {
      return {
        ...user,
        role_user: 'admin',
        role_id: Number.isFinite(roleId) ? roleId : 5,
      };
    }
  }

  return user;
}

module.exports = {
  normalizeRole,
  toRoleGroup,
  isAdminRole,
  isAdminActor,
  canChatBetween,
  decodeJwtPayload,
  enrichAdminFromJwt,
};
