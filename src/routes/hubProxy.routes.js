const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { compressVideo, cleanupFiles } = require('../services/hubCompressor.service');
const { forwardHubPost } = require('../services/hubProxy.service');

const MAX_VIDEO_MB = 500;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `hub_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
});

function createHubProxyRouter() {
  const router = express.Router();

  /**
   * POST /api/hub/posts
   *
   * Proxy transparente: recibe el post (igual que Laravel), comprime los videos
   * con FFmpeg y reenvía todo a Laravel. Devuelve la respuesta de Laravel.
   *
   * Headers requeridos: Authorization: Bearer <jwt>
   * Body (multipart/form-data): title_post, content?, tag_id?, media[]?
   */
  router.post('/posts', (req, _res, next) => {
    console.info('[HubProxy] content-type:', req.headers['content-type']);
    console.info('[HubProxy] content-length:', req.headers['content-length']);
    next();
  }, upload.any(), async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'No autorizado' });
    }

    const toClean = [];

    try {
      const { title_post, content, tag_id } = req.body;

      console.info('[HubProxy] body:', { title_post, content, tag_id });
      console.info('[HubProxy] auth (primeros 30):', authHeader?.substring(0, 30));
      console.info('[HubProxy] files recibidos:', (req.files || []).map(f => ({
        field: f.fieldname,
        original: f.originalname,
        size: `${Math.round(f.size / 1024 / 1024)} MB`,
        mime: f.mimetype,
      })));

      if (!title_post) {
        return res.status(422).json({ success: false, message: 'El título es requerido' });
      }

      const rawFiles = req.files || [];
      const mediaFiles = [];

      for (const file of rawFiles) {
        toClean.push(file.path); // multer temp → siempre limpiar

        const isVideo = file.mimetype.startsWith('video/');

        if (isVideo) {
          console.info(
            `[HubProxy] Comprimiendo: ${file.originalname} ` +
              `(${Math.round(file.size / 1024 / 1024)} MB)`,
          );
          const result = await compressVideo(file.path);
          if (result.tempOutput) toClean.push(result.tempOutput);

          mediaFiles.push({
            finalPath: result.finalPath,
            filename: path.basename(file.originalname, path.extname(file.originalname)) + '.mp4',
            mimetype: 'video/mp4',
          });
        } else {
          mediaFiles.push({
            finalPath: file.path,
            filename: file.originalname,
            mimetype: file.mimetype,
          });
        }
      }

      console.info(`[HubProxy] Reenviando a Laravel (${mediaFiles.length} archivos)…`);

      const data = await forwardHubPost({
        titlePost: title_post,
        content,
        tagId: tag_id,
        mediaFiles,
        authHeader,
      });

      res.json(data);
    } catch (err) {
      console.error('[HubProxy] Error:', err.message);
      const status = err.response?.status || 500;
      const message = err.response?.data?.message || err.message || 'Error interno';
      res.status(status).json({ success: false, message });
    } finally {
      cleanupFiles(toClean);
    }
  });

  return router;
}

module.exports = createHubProxyRouter;
