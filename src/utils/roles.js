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
  if (normalized.includes('monitor')) return 'monitor';
  if (normalized.includes('admin')) return 'monitor';
  if (normalized.includes('model') || normalized.includes('modal')) return 'model';
  return 'other';
}

function isAdminRole(role) {
  return normalizeRole(role).includes('admin');
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

module.exports = {
  normalizeRole,
  toRoleGroup,
  isAdminRole,
  canChatBetween,
};
