const userDirectoryService = require('../services/userDirectory.service');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Token requerido' });
    }

    const currentUser = await userDirectoryService.getCurrentUser(token);
    if (!currentUser?.id_user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    req.auth = {
      token,
      user: currentUser,
    };

    return next();
  } catch (error) {
    const status = error.response?.status || 401;
    const message = error.response?.data?.message || 'No autenticado';
    return res.status(status).json({ success: false, message });
  }
}

module.exports = authMiddleware;
