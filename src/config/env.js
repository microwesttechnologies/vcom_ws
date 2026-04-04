const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8081),
  databaseUrl: process.env.DATABASE_URL,
  vcomApiBaseUrl: (process.env.VCOM_API_BASE_URL || 'https://vcamb.microwesttechnologies.com').replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  fcmProjectId: process.env.FCM_PROJECT_ID || '',
  fcmServiceAccountFile: process.env.FCM_SERVICE_ACCOUNT_FILE || '',
  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || '',
  chatUploadDir: process.env.CHAT_UPLOAD_DIR || 'storage/chat-media',
  chatPublicBaseUrl: (process.env.CHAT_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  };
