# API_vcomChat

Backend de chat en **Node.js + WebSocket + PostgreSQL** para VCOM.

## Reglas de negocio implementadas

- Solo se permite conversar entre roles:
  - `modelo` (o `modal`) <-> `monitor`
- No se permite conversación con uno mismo.
- Estados manejados en tiempo real:
  - `connected`
  - `disconnected`
  - `typing`
  - `unseen`
  - `received`
  - `seen`

## Dependencias

- Node.js 20+
- PostgreSQL 14+

## Configuración

1. Copiar variables de entorno:

```bash
cp .env.example .env
```

2. Instalar dependencias:

```bash
npm install
```

3. Ejecutar migraciones:

```bash
npm run migrate
```

4. Iniciar servidor:

```bash
npm run dev
```

Servidor por defecto: `http://localhost:8081`
WebSocket: `ws://localhost:8081/ws?token=<JWT>`

## Endpoints REST

- `GET /health`
- `GET /api/chat/me`
- `GET /api/chat/contacts`
- `POST /api/chat/conversations` body `{ "other_user_id": "<uuid>" }`
- `GET /api/chat/conversations`
- `GET /api/chat/conversations/:conversationId/messages?limit=50&before=<ISO_DATE>`
- `POST /api/chat/messages` body `{ "conversation_id": 1, "content": "hola", "message_type": "text" }`
- `POST /api/chat/conversations/:conversationId/read`

Todos requieren `Authorization: Bearer <token>`.

## Eventos WebSocket

Cliente -> servidor:

- `conversation.join` `{ conversation_id }`
- `conversation.leave` `{ conversation_id }`
- `typing.start` `{ conversation_id }`
- `typing.stop` `{ conversation_id }`
- `message.send` `{ conversation_id, content, message_type }`
- `message.seen` `{ conversation_id }`
- `ping` `{}`

Servidor -> cliente:

- `connection.ready`
- `presence.update`
- `typing.update`
- `message.new`
- `message.status`
- `error`
- `pong`

## Integración con API principal

Este backend valida el token y consulta usuarios usando:

- `GET /api/v1/auth/permissions`
- `GET /api/v1/users`
- `GET /api/v1/users/{id}`

sobre `https://vcamb.microwesttechnologies.com` (o la URL configurada en `VCOM_API_BASE_URL`).
