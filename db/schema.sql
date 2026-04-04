CREATE TABLE IF NOT EXISTS chat_conversations (
  id_conversation BIGSERIAL PRIMARY KEY,
  participant_a TEXT NOT NULL,
  participant_b TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT participants_must_differ CHECK (participant_a <> participant_b),
  CONSTRAINT participant_order CHECK (participant_a::text < participant_b::text),
  CONSTRAINT unique_pair UNIQUE (participant_a, participant_b)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id_message BIGSERIAL PRIMARY KEY,
  id_conversation BIGINT NOT NULL REFERENCES chat_conversations(id_conversation) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  media_url TEXT,
  media_thumbnail_url TEXT,
  media_content_type TEXT,
  media_metadata JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'unseen',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  CONSTRAINT valid_message_status CHECK (status IN ('unseen', 'received', 'seen')),
  CONSTRAINT valid_message_type CHECK (message_type IN ('text', 'image', 'video'))
);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_thumbnail_url TEXT;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_content_type TEXT;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON chat_messages(id_conversation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_status
  ON chat_messages(recipient_id, status);

CREATE TABLE IF NOT EXISTS chat_user_presence (
  user_id TEXT PRIMARY KEY,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  is_typing BOOLEAN NOT NULL DEFAULT FALSE,
  typing_conversation_id BIGINT,
  last_seen TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_push_tokens (
  id_push_token BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  push_token TEXT NOT NULL UNIQUE,
  platform VARCHAR(20) NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_push_tokens_user
  ON chat_push_tokens(user_id);
