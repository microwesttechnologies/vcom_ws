const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const chatService = require('../services/chat.service');
const userDirectoryService = require('../services/userDirectory.service');

function mapConversationForUser(conversationRow, currentUserId) {
  const participantA = String(conversationRow.participant_a);
  const participantB = String(conversationRow.participant_b);

  return {
    id_conversation: Number(conversationRow.id_conversation),
    other_user_id: participantA === String(currentUserId) ? participantB : participantA,
    created_at: conversationRow.created_at,
    updated_at: conversationRow.updated_at,
    last_message_at: conversationRow.last_message_at,
    last_message: conversationRow.last_message_content
      ? {
          id_message: Number(conversationRow.last_message_id),
          content: conversationRow.last_message_content,
          message_type: conversationRow.last_message_type,
          sender_id: conversationRow.last_message_sender_id,
          created_at: conversationRow.last_message_created_at,
        }
      : null,
    unread_count: Number(conversationRow.unread_count || 0),
  };
}

function createChatRouter({ wsGateway }) {
  const router = express.Router();

  router.use(authMiddleware);

  router.get('/me', async (req, res) => {
    res.json({ success: true, user: req.auth.user });
  });

  router.get('/contacts', async (req, res, next) => {
    try {
      const contacts = await userDirectoryService.getAllowedContacts(
        req.auth.token,
        req.auth.user.role_user,
        req.auth.user.id_user,
      );
      res.json({ success: true, data: contacts });
    } catch (error) {
      next(error);
    }
  });

  router.post('/devices/push-tokens', async (req, res, next) => {
    try {
      const pushToken = String(req.body?.push_token || '').trim();
      const platform = String(req.body?.platform || 'android').trim() || 'android';

      if (!pushToken) {
        return res.status(422).json({ success: false, message: 'push_token es requerido' });
      }

      await chatService.registerPushToken({
        userId: req.auth.user.id_user,
        pushToken,
        platform,
      });

      res.status(201).json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/devices/push-tokens', async (req, res, next) => {
    try {
      const pushToken = String(req.body?.push_token || '').trim();

      if (!pushToken) {
        return res.status(422).json({ success: false, message: 'push_token es requerido' });
      }

      const deleted = await chatService.unregisterPushToken({
        userId: req.auth.user.id_user,
        pushToken,
      });

      res.json({ success: true, deleted });
    } catch (error) {
      next(error);
    }
  });

  router.post('/conversations', async (req, res, next) => {
    try {
      const otherUserId = req.body?.other_user_id;
      if (!otherUserId) {
        return res.status(422).json({ success: false, message: 'other_user_id es requerido' });
      }

      const result = await chatService.ensureConversation({
        token: req.auth.token,
        currentUser: req.auth.user,
        otherUserId,
      });

      return res.status(result.created ? 201 : 200).json({
        success: true,
        created: result.created,
        conversation: {
          id_conversation: Number(result.conversation.id_conversation),
          participant_a: result.conversation.participant_a,
          participant_b: result.conversation.participant_b,
          created_at: result.conversation.created_at,
          updated_at: result.conversation.updated_at,
          last_message_at: result.conversation.last_message_at,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/conversations', async (req, res, next) => {
    try {
      const rows = await chatService.listConversations(req.auth.user.id_user);
      const conversations = rows.map((row) => mapConversationForUser(row, req.auth.user.id_user));
      res.json({ success: true, data: conversations });
    } catch (error) {
      next(error);
    }
  });

  router.get('/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const limit = Number(req.query.limit || 50);
      const before = req.query.before || null;

      const messages = await chatService.listMessages({
        conversationId,
        userId: req.auth.user.id_user,
        limit,
        before,
      });

      res.json({ success: true, data: messages });
    } catch (error) {
      next(error);
    }
  });

  router.post('/messages', async (req, res, next) => {
    try {
      const conversationId = Number(req.body?.conversation_id);
      const content = String(req.body?.content || '').trim();
      const messageType = String(req.body?.message_type || 'text').toLowerCase();
      const mediaUrl = String(req.body?.media_url || '').trim() || null;
      const mediaThumbnailUrl = String(req.body?.media_thumbnail_url || '').trim() || null;
      const mediaContentType = String(req.body?.media_content_type || '').trim() || null;
      const mediaMetadata = req.body?.media_metadata && typeof req.body.media_metadata === 'object'
        ? req.body.media_metadata
        : null;

      const hasMessageBody = content || mediaUrl;
      if (!conversationId || !hasMessageBody) {
        return res.status(422).json({ success: false, message: 'conversation_id y content son requeridos' });
      }

      const message = await chatService.createMessage({
        conversationId,
        senderId: req.auth.user.id_user,
        content,
        messageType,
        mediaUrl,
        mediaThumbnailUrl,
        mediaContentType,
        mediaMetadata,
      });

      wsGateway.emitNewMessage(message, {
        senderUser: req.auth.user,
      });
      res.status(201).json({ success: true, data: message });
    } catch (error) {
      next(error);
    }
  });

  router.post('/conversations/:conversationId/read', async (req, res, next) => {
    try {
      const conversationId = Number(req.params.conversationId);
      const updates = await chatService.markConversationSeen(conversationId, req.auth.user.id_user);
      wsGateway.emitBulkSeen(updates);
      res.json({ success: true, updated: updates.length, data: updates });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createChatRouter;
