const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const {
  fcmProjectId,
  fcmServiceAccountFile,
  fcmServiceAccountJson,
} = require('../config/env');

const FIREBASE_MESSAGING_SCOPE =
  'https://www.googleapis.com/auth/firebase.messaging';

class FcmService {
  constructor() {
    this.auth = null;
  }

  isConfigured() {
    return Boolean(
      fcmProjectId &&
        (fcmServiceAccountFile || fcmServiceAccountJson),
    );
  }

  async sendChatMessagePush({ tokens, message, senderUser }) {
    const uniqueTokens = Array.from(
      new Set(
        (tokens || [])
          .map((item) => String(item.push_token || '').trim())
          .filter(Boolean),
      ),
    );

    if (!this.isConfigured() || uniqueTokens.length === 0) {
      return { sent: 0, failed: 0, invalidTokens: [] };
    }

    const accessToken = await this.getAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`;
    const invalidTokens = [];
    let sent = 0;
    let failed = 0;

    for (const pushToken of uniqueTokens) {
      try {
        await axios.post(
          url,
          {
            message: {
              token: pushToken,
              notification: this.buildNotification(message, senderUser),
              data: this.buildDataPayload(message, senderUser),
              android: {
                priority: 'high',
                notification: {
                  channel_id: 'chat_messages',
                  sound: 'default',
                },
              },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        if (this.isInvalidTokenError(error)) {
          invalidTokens.push(pushToken);
        }
        console.error('[fcm] send error:', this.serializeError(error));
      }
    }

    return { sent, failed, invalidTokens };
  }

  async getAccessToken() {
    if (!this.auth) {
      const authOptions = {
        scopes: [FIREBASE_MESSAGING_SCOPE],
      };

      if (fcmServiceAccountFile) {
        authOptions.keyFile = fcmServiceAccountFile;
      } else if (fcmServiceAccountJson) {
        authOptions.credentials = JSON.parse(fcmServiceAccountJson);
      }

      this.auth = new GoogleAuth(authOptions);
    }

    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse?.token || tokenResponse;

    if (!accessToken) {
      throw new Error('No fue posible obtener access token para FCM');
    }

    return accessToken;
  }

  buildNotification(message, senderUser) {
    return {
      title: senderUser?.name_user
        ? `Nuevo mensaje de ${senderUser.name_user}`
        : 'Nuevo mensaje',
      body: this.buildBody(message),
    };
  }

  buildDataPayload(message, senderUser) {
    return {
      type: 'chat_message',
      conversation_id: String(message.id_conversation ?? ''),
      sender_id: String(message.sender_id ?? ''),
      other_user_id: String(message.sender_id ?? ''),
      other_user_name: String(senderUser?.name_user ?? 'Usuario'),
      other_user_role: String(senderUser?.role_user ?? ''),
      content: String(message.content ?? ''),
      chat_message_type: String(message.message_type ?? 'text'),
    };
  }

  buildBody(message) {
    const messageType = String(message.message_type || 'text').toLowerCase();
    if (messageType === 'image') return 'Te envio una imagen';
    if (messageType === 'video') return 'Te envio un video';

    const content = String(message.content || '').trim();
    if (!content) return 'Tienes un nuevo mensaje';
    return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  }

  isInvalidTokenError(error) {
    const code = this.extractFirebaseErrorCode(error);
    return (
      code === 'UNREGISTERED' ||
      code === 'INVALID_ARGUMENT' ||
      code === 'NOT_FOUND'
    );
  }

  extractFirebaseErrorCode(error) {
    return (
      error?.response?.data?.error?.details?.[0]?.errorCode ||
      error?.response?.data?.error?.status ||
      ''
    );
  }

  serializeError(error) {
    return {
      message: error?.message || 'Unknown error',
      status: error?.response?.status || null,
      data: error?.response?.data || null,
    };
  }
}

module.exports = new FcmService();
