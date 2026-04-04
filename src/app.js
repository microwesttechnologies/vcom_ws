const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { corsOrigin, chatUploadDir } = require('./config/env');
const createChatRouter = require('./routes/chat.routes');
const createChatMediaRouter = require('./routes/chatMedia.routes');

function createApp({ wsGateway }) {
  const app = express();

  app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'API chat running' });
  });

  app.use('/api/chat', createChatRouter({ wsGateway }));
  app.use('/api/chat/media', createChatMediaRouter());
  app.use(
    '/media/chat',
    express.static(path.resolve(process.cwd(), chatUploadDir)),
  );

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'El archivo supera el limite permitido para chat',
      });
    }

    const status = err.status || 500;
    console.error('[chat-api] error:', err);
    res.status(status).json({
      success: false,
      message: err.message || 'Error interno',
    });
  });

  return app;
}

module.exports = createApp;
