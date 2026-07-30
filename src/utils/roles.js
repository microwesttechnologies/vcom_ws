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
 */
function toRoleGroup(role) {
  const normalized = normalizeRole(role);
  if (normalized.includes('monitor')) return 'monitor';
  if (normalized.includes('model') || normalized.includes('modal')) return 'model';
  return 'other';
}

function canChatBetween(roleA, roleB) {
  const a = toRoleGroup(roleA);
  const b = toRoleGroup(roleB);
  return (a === 'model' && b === 'monitor') || (a === 'monitor' && b === 'model');
}

module.exports = {
  normalizeRole,
  toRoleGroup,
  canChatBetween,
};
