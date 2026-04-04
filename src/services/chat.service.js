const pool = require('../db/pool');
const userDirectoryService = require('./userDirectory.service');
const { canChatBetween } = require('../utils/roles');

function canonicalPair(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  return aStr < bStr ? [aStr, bStr] : [bStr, aStr];
}

class ChatService {
  async ensureConversation({ token, currentUser, otherUserId }) {
    if (String(currentUser.id_user) === String(otherUserId)) {
      const error = new Error('No puedes crear una conversacion contigo mismo');
      error.status = 400;
      throw error;
    }

    const allowedContacts = await userDirectoryService.getAllowedContacts(
      token,
      currentUser.role_user,
      currentUser.id_user,
    );
    const otherUser = (allowedContacts || []).find(
      (item) => String(item.id_user) === String(otherUserId),
    ) || null;

    if (!otherUser?.id_user) {
      const error = new Error('Usuario destino no encontrado');
      error.status = 404;
      throw error;
    }

    if (!canChatBetween(currentUser.role_user, otherUser.role_user)) {
      const error = new Error('Roles incompatibles: solo modelo <-> monitor');
      error.status = 400;
      throw error;
    }

    const [participantA, participantB] = canonicalPair(currentUser.id_user, otherUser.id_user);

    const existing = await pool.query(
      `SELECT id_conversation, participant_a, participant_b, created_at, updated_at, last_message_at
       FROM chat_conversations
       WHERE participant_a = $1 AND participant_b = $2`,
      [participantA, participantB],
    );

    if (existing.rowCount > 0) {
      return { conversation: existing.rows[0], created: false };
    }

    const created = await pool.query(
      `INSERT INTO chat_conversations (participant_a, participant_b)
       VALUES ($1, $2)
       RETURNING id_conversation, participant_a, participant_b, created_at, updated_at, last_message_at`,
      [participantA, participantB],
    );

    return { conversation: created.rows[0], created: true };
  }

  async getConversationById(conversationId) {
    const result = await pool.query(
      `SELECT id_conversation, participant_a, participant_b, created_at, updated_at, last_message_at
       FROM chat_conversations
       WHERE id_conversation = $1`,
      [conversationId],
    );
    return result.rows[0] || null;
  }

  ensureAccess(conversation, userId) {
    const uid = String(userId);
    if (!conversation || (String(conversation.participant_a) !== uid && String(conversation.participant_b) !== uid)) {
      const error = new Error('No tienes acceso a esta conversacion');
      error.status = 403;
      throw error;
    }
  }

  resolveRecipient(conversation, senderId) {
    return String(conversation.participant_a) === String(senderId)
      ? String(conversation.participant_b)
      : String(conversation.participant_a);
  }

  async listConversations(userId) {
    const result = await pool.query(
      `SELECT
          c.id_conversation,
          c.participant_a,
          c.participant_b,
          c.created_at,
          c.updated_at,
          c.last_message_at,
          m.id_message AS last_message_id,
          m.content AS last_message_content,
          m.message_type AS last_message_type,
          m.sender_id AS last_message_sender_id,
          m.created_at AS last_message_created_at,
          COALESCE(unread.total, 0) AS unread_count
       FROM chat_conversations c
       LEFT JOIN LATERAL (
         SELECT id_message, content, message_type, sender_id, created_at
         FROM chat_messages
         WHERE id_conversation = c.id_conversation
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::INT AS total
         FROM chat_messages
         WHERE id_conversation = c.id_conversation
           AND recipient_id = $1
           AND status IN ('unseen', 'received')
       ) unread ON TRUE
       WHERE c.participant_a = $1 OR c.participant_b = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      [userId],
    );

    return result.rows;
  }

  async listMessages({ conversationId, userId, limit = 50, before }) {
    const conversation = await this.getConversationById(conversationId);
    this.ensureAccess(conversation, userId);

    const params = [conversationId, Math.max(1, Math.min(limit, 200))];
    let beforeFilter = '';

    if (before) {
      params.push(before);
      beforeFilter = `AND created_at < $${params.length}`;
    }

    const query = `SELECT
      id_message,
      id_conversation,
      sender_id,
      recipient_id,
      content,
      message_type,
      media_url,
      media_thumbnail_url,
      media_content_type,
      media_metadata,
      status,
      created_at,
      received_at,
      seen_at
    FROM chat_messages
    WHERE id_conversation = $1
      ${beforeFilter}
    ORDER BY created_at DESC
    LIMIT $2`;

    const result = await pool.query(query, params);

    return result.rows.reverse();
  }

  async createMessage({
    conversationId,
    senderId,
    content,
    messageType = 'text',
    mediaUrl = null,
    mediaThumbnailUrl = null,
    mediaContentType = null,
    mediaMetadata = null,
  }) {
    const conversation = await this.getConversationById(conversationId);
    this.ensureAccess(conversation, senderId);

    const recipientId = this.resolveRecipient(conversation, senderId);
    const normalizedMessageType = String(messageType || 'text').toLowerCase();
    const normalizedMediaUrl = mediaUrl ? String(mediaUrl).trim() : null;
    const normalizedThumbnailUrl = mediaThumbnailUrl ? String(mediaThumbnailUrl).trim() : null;
    const normalizedContentType = mediaContentType ? String(mediaContentType).trim() : null;
    const normalizedContent = String(content || '').trim();

    const storedContent = normalizedMessageType === 'text'
      ? normalizedContent
      : (normalizedMediaUrl || normalizedContent);

    const inserted = await pool.query(
      `INSERT INTO chat_messages (
        id_conversation,
        sender_id,
        recipient_id,
        content,
        message_type,
        media_url,
        media_thumbnail_url,
        media_content_type,
        media_metadata,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'unseen')
      RETURNING id_message, id_conversation, sender_id, recipient_id, content, message_type, media_url, media_thumbnail_url, media_content_type, media_metadata, status, created_at, received_at, seen_at`,
      [
        conversationId,
        senderId,
        recipientId,
        storedContent,
        normalizedMessageType,
        normalizedMediaUrl,
        normalizedThumbnailUrl,
        normalizedContentType,
        mediaMetadata ? JSON.stringify(mediaMetadata) : null,
      ],
    );

    await pool.query(
      `UPDATE chat_conversations
       SET updated_at = NOW(), last_message_at = NOW()
       WHERE id_conversation = $1`,
      [conversationId],
    );

    return inserted.rows[0];
  }

  async markMessageReceived(messageId, recipientId) {
    const result = await pool.query(
      `UPDATE chat_messages
       SET status = 'received', received_at = NOW()
       WHERE id_message = $1
         AND recipient_id = $2
         AND status = 'unseen'
       RETURNING id_message, id_conversation, status, received_at, seen_at`,
      [messageId, recipientId],
    );

    return result.rows[0] || null;
  }

  async markConversationSeen(conversationId, recipientId) {
    const conversation = await this.getConversationById(conversationId);
    this.ensureAccess(conversation, recipientId);

    const result = await pool.query(
      `UPDATE chat_messages
       SET status = 'seen', seen_at = NOW(),
           received_at = COALESCE(received_at, NOW())
       WHERE id_conversation = $1
         AND recipient_id = $2
         AND status IN ('unseen', 'received')
       RETURNING id_message, id_conversation, status, received_at, seen_at`,
      [conversationId, recipientId],
    );

    return result.rows;
  }

  async setPresence({ userId, isOnline, isTyping = false, typingConversationId = null }) {
    await pool.query(
      `INSERT INTO chat_user_presence (user_id, is_online, is_typing, typing_conversation_id, last_seen, updated_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $2 = FALSE THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         is_online = EXCLUDED.is_online,
         is_typing = EXCLUDED.is_typing,
         typing_conversation_id = EXCLUDED.typing_conversation_id,
         last_seen = CASE WHEN EXCLUDED.is_online = FALSE THEN NOW() ELSE chat_user_presence.last_seen END,
         updated_at = NOW()`,
      [userId, isOnline, isTyping, typingConversationId],
    );
  }

  async registerPushToken({ userId, pushToken, platform = 'android' }) {
    await pool.query(
      `INSERT INTO chat_push_tokens (user_id, push_token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (push_token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         updated_at = NOW()`,
      [String(userId), String(pushToken), String(platform || 'android')],
    );
  }

  async unregisterPushToken({ userId, pushToken }) {
    const result = await pool.query(
      `DELETE FROM chat_push_tokens
       WHERE user_id = $1
         AND push_token = $2`,
      [String(userId), String(pushToken)],
    );

    return result.rowCount || 0;
  }

  async deletePushToken(pushToken) {
    const result = await pool.query(
      `DELETE FROM chat_push_tokens
       WHERE push_token = $1`,
      [String(pushToken)],
    );

    return result.rowCount || 0;
  }

  async listPushTokens(userId) {
    const result = await pool.query(
      `SELECT push_token, platform
       FROM chat_push_tokens
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [String(userId)],
    );

    return result.rows;
  }
}

module.exports = new ChatService();
