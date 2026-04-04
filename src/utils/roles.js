function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toRoleGroup(role) {
  const normalized = normalizeRole(role);
  if (['modelo', 'model', 'modal'].includes(normalized)) return 'model';
  if (['monitor'].includes(normalized)) return 'monitor';
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
