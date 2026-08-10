const userDirectoryService = require('../services/userDirectory.service');
const { enrichAdminFromJwt } = require('../utils/roles');

function extractBearerToken(authHeader) {
  const value = String(authHeader || '').trim();
  if (!value) return null;

  const match = value.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();

  // JWT crudo (sin esquema)
  if (value.split('.').length === 3) return value;

  return null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Token requerido' });
    }

    const currentUser = await userDirectoryService.getCurrentUser(token);
    if (!currentUser?.id_user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    req.auth = {
      token,
      user: enrichAdminFromJwt(token, currentUser),
    };

    return next();
  } catch (error) {
    const status = error.response?.status || 401;
    const message = error.response?.data?.message || 'No autenticado';
    return res.status(status).json({ success: false, message });
  }
}

module.exports = authMiddleware;
