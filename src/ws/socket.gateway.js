const { WebSocketServer } = require('ws');
const url = require('url');
const userDirectoryService = require('../services/userDirectory.service');
const chatService = require('../services/chat.service');
const fcmService = require('../services/fcm.service');

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

class SocketGateway {
  constructor() {
    this.wss = null;
    this.userSockets = new Map();
    this.socketState = new WeakMap();
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, request) => this.onConnection(ws, request));
  }

  async onConnection(ws, request) {
    try {
      const parsed = url.parse(request.url, true);
      const token = parsed.query?.token;
      if (!token || typeof token !== 'string') {
        safeSend(ws, { event: 'error', data: { code: 'AUTH_REQUIRED', message: 'token es requerido' } });
        ws.close();
        return;
      }

      const user = await userDirectoryService.getCurrentUser(token);
      if (!user?.id_user) {
        safeSend(ws, { event: 'error', data: { code: 'AUTH_INVALID', message: 'token invalido' } });
        ws.close();
        return;
      }

      this.bindSocket(ws, user, token);

      await chatService.setPresence({ userId: user.id_user, isOnline: true });
      this.broadcastPresence(user.id_user, true, null);

      safeSend(ws, {
        event: 'connection.ready',
        data: {
          user,
          server_time: new Date().toISOString(),
        },
      });

      await this.emitPresenceSnapshot(ws, stateFromSocket(this.socketState, ws));

      ws.on('message', (raw) => this.onMessage(ws, raw));
      ws.on('close', () => this.onClose(ws));
      ws.on('error', () => this.onClose(ws));
    } catch (error) {
      safeSend(ws, { event: 'error', data: { code: 'AUTH_ERROR', message: 'No fue posible autenticar websocket' } });
      ws.close();
    }
  }

  bindSocket(ws, user, token) {
    const userId = String(user.id_user);
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }

    this.userSockets.get(userId).add(ws);
    this.socketState.set(ws, {
      user,
      token,
      activeConversationId: null,
      isInChatModule: false,
    });
  }

  async onClose(ws) {
    const state = this.socketState.get(ws);
    if (!state) return;

    const userId = String(state.user.id_user);
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        await chatService.setPresence({ userId, isOnline: false });
        this.broadcastPresence(userId, false, new Date().toISOString());
      }
    }

    this.socketState.delete(ws);
  }

  async onMessage(ws, raw) {
    const state = this.socketState.get(ws);
    if (!state) return;

    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch (_) {
      safeSend(ws, { event: 'error', data: { code: 'BAD_JSON', message: 'payload invalido' } });
      return;
    }

    const event = parsed.event;
    const data = parsed.data || {};

    try {
      if (event === 'conversation.join') {
        state.activeConversationId = Number(data.conversation_id) || null;
        safeSend(ws, { event: 'conversation.joined', data: { conversation_id: state.activeConversationId } });
        return;
      }

      if (event === 'conversation.leave') {
        state.activeConversationId = null;
        safeSend(ws, { event: 'conversation.left', data: {} });
        return;
      }

      if (event === 'chat.screen.open') {
        state.isInChatModule = true;
        safeSend(ws, { event: 'chat.screen.opened', data: {} });
        return;
      }

      if (event === 'chat.screen.close') {
        state.isInChatModule = false;
        state.activeConversationId = null;
        safeSend(ws, { event: 'chat.screen.closed', data: {} });
        return;
      }

      if (event === 'typing.start' || event === 'typing.stop') {
        await this.handleTyping(state, event === 'typing.start', Number(data.conversation_id));
        return;
      }

      if (event === 'message.send') {
        await this.handleSendMessage(state, data);
        return;
      }

      if (event === 'message.seen') {
        await this.handleSeen(state, Number(data.conversation_id));
        return;
      }

      if (event === 'ping') {
        safeSend(ws, { event: 'pong', data: { ts: Date.now() } });
        return;
      }

      safeSend(ws, { event: 'error', data: { code: 'UNKNOWN_EVENT', message: `Evento no soportado: ${event}` } });
    } catch (error) {
      const status = error.status || 500;
      safeSend(ws, {
        event: 'error',
        data: {
          code: 'EVENT_ERROR',
          status,
          message: error.message || 'Error interno',
        },
      });
    }
  }

  async handleTyping(state, isTyping, conversationId) {
    if (!conversationId) {
      const error = new Error('conversation_id es requerido');
      error.status = 422;
      throw error;
    }

    const conversation = await chatService.getConversationById(conversationId);
    chatService.ensureAccess(conversation, state.user.id_user);

    await chatService.setPresence({
      userId: state.user.id_user,
      isOnline: true,
      isTyping,
      typingConversationId: isTyping ? conversationId : null,
    });

    const payload = {
      event: 'typing.update',
      data: {
        conversation_id: conversationId,
        user_id: state.user.id_user,
        is_typing: isTyping,
      },
    };

    this.emitToConversationParticipants(conversation, payload);
  }

  async handleSendMessage(state, data) {
    const conversationId = Number(data.conversation_id);
    const content = String(data.content || '').trim();
    const messageType = String(data.message_type || 'text').toLowerCase();
    const mediaUrl = String(data.media_url || '').trim() || null;
    const mediaThumbnailUrl = String(data.media_thumbnail_url || '').trim() || null;
    const mediaContentType = String(data.media_content_type || '').trim() || null;
    const mediaMetadata = data.media_metadata && typeof data.media_metadata === 'object'
      ? data.media_metadata
      : null;

    if (!conversationId || (!content && !mediaUrl)) {
      const error = new Error('conversation_id y content son requeridos');
      error.status = 422;
      throw error;
    }

    const message = await chatService.createMessage({
      conversationId,
      senderId: state.user.id_user,
      content,
      messageType,
      mediaUrl,
      mediaThumbnailUrl,
      mediaContentType,
      mediaMetadata,
    });

    this.emitNewMessage(message, {
      senderUser: state.user,
    });
  }

  async handleSeen(state, conversationId) {
    if (!conversationId) {
      const error = new Error('conversation_id es requerido');
      error.status = 422;
      throw error;
    }

    const updates = await chatService.markConversationSeen(conversationId, state.user.id_user);
    this.emitBulkSeen(updates);
  }

  emitNewMessage(message, { senderUser = null } = {}) {
    const conversation = {
      participant_a: message.sender_id,
      participant_b: message.recipient_id,
    };

    this.emitToConversationParticipants(conversation, {
      event: 'message.new',
      data: message,
    });

    const recipientOnline = this.hasOnlineUser(message.recipient_id);
    const recipientViewingConversation = this.isUserViewingConversation(
      message.recipient_id,
      message.id_conversation,
    );
    const recipientInChatModule = this.isUserInChatModule(message.recipient_id);

    if (recipientOnline) {
      chatService.markMessageReceived(message.id_message, message.recipient_id).then((statusRow) => {
        if (!statusRow) return;
        const payload = {
          event: 'message.status',
          data: {
            id_message: Number(statusRow.id_message),
            id_conversation: Number(statusRow.id_conversation),
            status: statusRow.status,
            received_at: statusRow.received_at,
            seen_at: statusRow.seen_at,
          },
        };
        this.emitToUser(message.sender_id, payload);
        this.emitToUser(message.recipient_id, payload);
      }).catch(() => {});
    }

    if (recipientViewingConversation || recipientInChatModule) {
      return;
    }

    chatService.listPushTokens(message.recipient_id).then((tokens) => {
      return fcmService.sendChatMessagePush({
        tokens,
        message,
        senderUser,
      });
    }).then((result) => {
      if (!result?.invalidTokens?.length) return;
      return Promise.allSettled(
        result.invalidTokens.map((pushToken) => chatService.deletePushToken(pushToken)),
      );
    }).catch((error) => {
      console.error('[chat-push] error:', error?.message || error);
    });
  }

  emitBulkSeen(updates) {
    for (const row of updates) {
      const payload = {
        event: 'message.status',
        data: {
          id_message: Number(row.id_message),
          id_conversation: Number(row.id_conversation),
          status: row.status,
          received_at: row.received_at,
          seen_at: row.seen_at,
        },
      };
      this.broadcastToAll(payload);
    }
  }

  emitToConversationParticipants(conversation, payload) {
    this.emitToUser(conversation.participant_a, payload);
    this.emitToUser(conversation.participant_b, payload);
  }

  emitToUser(userId, payload) {
    const sockets = this.userSockets.get(String(userId));
    if (!sockets) return;

    for (const socket of sockets) {
      safeSend(socket, payload);
    }
  }

  broadcastToAll(payload) {
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        safeSend(ws, payload);
      }
    }
  }

  broadcastPresence(userId, isOnline, lastSeen) {
    this.broadcastToAll({
      event: 'presence.update',
      data: {
        user_id: String(userId),
        is_online: isOnline,
        last_seen: lastSeen,
      },
    });
  }

  hasOnlineUser(userId) {
    const sockets = this.userSockets.get(String(userId));
    return Boolean(sockets && sockets.size > 0);
  }

  isUserViewingConversation(userId, conversationId) {
    const sockets = this.userSockets.get(String(userId));
    if (!sockets || !conversationId) return false;

    for (const socket of sockets) {
      const state = this.socketState.get(socket);
      if (state?.activeConversationId === Number(conversationId)) {
        return true;
      }
    }

    return false;
  }

  isUserInChatModule(userId) {
    const sockets = this.userSockets.get(String(userId));
    if (!sockets) return false;

    for (const socket of sockets) {
      const state = this.socketState.get(socket);
      if (state?.isInChatModule === true) {
        return true;
      }
    }

    return false;
  }

  async emitPresenceSnapshot(ws, state) {
    if (!state?.token || !state?.user?.id_user) return;

    try {
      const contacts = await userDirectoryService.getAllowedContacts(
        state.token,
        state.user.role_user,
        state.user.id_user,
      );

      safeSend(ws, {
        event: 'presence.snapshot',
        data: {
          contacts: (contacts || []).map((item) => ({
            user_id: String(item.id_user),
            name_user: item.name_user,
            role_user: item.role_user,
            is_online: item.is_online === true,
            last_seen: item.last_seen ?? null,
          })),
        },
      });
    } catch (_) {
      // noop: snapshot es opcional, el realtime sigue por presence.update
    }
  }
}

function stateFromSocket(socketState, ws) {
  return socketState.get(ws);
}

module.exports = SocketGateway;
