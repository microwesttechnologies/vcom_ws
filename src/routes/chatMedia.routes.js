const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const authMiddleware = require('../middleware/auth.middleware');
const chatService = require('../services/chat.service');
const chatMediaService = require('../services/chatMedia.service');
const { chatUploadDir } = require('../config/env');

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = VIDEO_MAX_BYTES;
const TEMP_UPLOAD_DIR = path.resolve(process.cwd(), chatUploadDir, '_incoming');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: ABSOLUTE_MAX_BYTES,
  },
});

function createChatMediaRouter() {
  const router = express.Router();

  router.use(authMiddleware);

  router.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
      const type = String(req.body?.type || '').trim().toLowerCase();
      const conversationIdRaw = req.body?.conversation_id;
      const conversationId = conversationIdRaw == null || conversationIdRaw === ''
        ? null
        : Number(conversationIdRaw);
      if (!req.file) {
        return res.status(422).json({ success: false, message: 'file es requerido' });
      }

      if (conversationId !== null && !Number.isInteger(conversationId)) {
        return res.status(422).json({
          success: false,
          message: 'conversation_id debe ser numerico',
        });
      }

      if (type === 'image' && req.file.size > IMAGE_MAX_BYTES) {
        return res.status(413).json({
          success: false,
          message: 'La imagen no debe superar 30MB',
        });
      }

      if (type === 'video' && req.file.size > VIDEO_MAX_BYTES) {
        return res.status(413).json({
          success: false,
          message: 'El video no debe superar 50MB',
        });
      }

      if (conversationId !== null) {
        const conversation = await chatService.getConversationById(conversationId);
        chatService.ensureAccess(conversation, req.auth.user.id_user);
      }

      const result = await chatMediaService.processUpload({
        file: req.file,
        type,
        conversationId,
        userId: req.auth.user.id_user,
        req,
      });

      res.status(201).json({
        success: true,
        url: result.url,
        path: result.path,
        thumbnail_url: result.thumbnailUrl || null,
        thumbnail_path: result.thumbnailPath || null,
        content_type: result.contentType,
        original_size: result.originalSize,
        stored_size: result.storedSize,
        reduction_percent: result.reductionPercent,
        metadata: result.metadata,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createChatMediaRouter;
