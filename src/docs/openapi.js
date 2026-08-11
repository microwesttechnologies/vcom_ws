/** OpenAPI 3.0 — VCOM Chat API (vcom_ws) */
function buildOpenApiSpec({ serverUrl } = {}) {
  const servers = serverUrl
    ? [{ url: serverUrl, description: 'Servidor actual' }]
    : [
        { url: 'https://wschat.vcommunity.cloud', description: 'Producción' },
        { url: 'http://localhost:8081', description: 'Local' },
      ];

  return {
    openapi: '3.0.3',
    info: {
      title: 'VCOM Chat API',
      version: '1.0.0',
      description:
        'API HTTP del chat VCOM (Node + PostgreSQL + WebSocket). ' +
        'Autenticación: header `Authorization: Bearer <JWT>` (mismo token Laravel).',
    },
    servers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
        ChatUser: {
          type: 'object',
          properties: {
            id_user: { type: 'string' },
            name_user: { type: 'string' },
            role_user: { type: 'string' },
            role_id: { type: 'integer', nullable: true },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            id_user: { type: 'string' },
            name_user: { type: 'string' },
            role_user: { type: 'string', example: 'monitor' },
            is_online: { type: 'boolean' },
            last_seen: { type: 'string', nullable: true },
            id_employee: { type: 'string', nullable: true },
            id_model: { type: 'string', nullable: true },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            id_conversation: { type: 'integer' },
            other_user_id: { type: 'string' },
            unread_count: { type: 'integer' },
            last_message: { type: 'object', nullable: true },
          },
        },
        ConversationCreated: {
          type: 'object',
          properties: {
            id_conversation: { type: 'integer' },
            participant_a: { type: 'string' },
            participant_b: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
            last_message_at: { type: 'string', nullable: true },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id_message: { type: 'integer' },
            id_conversation: { type: 'integer' },
            sender_id: { type: 'string' },
            recipient_id: { type: 'string' },
            content: { type: 'string' },
            message_type: { type: 'string', example: 'text' },
            status: { type: 'string' },
            created_at: { type: 'string' },
            media_url: { type: 'string', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Health check',
          responses: {
            200: {
              description: 'API arriba',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/db': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Health check de PostgreSQL',
          responses: {
            200: { description: 'DB ok' },
            503: { description: 'DB down' },
          },
        },
      },
      '/api/chat/me': {
        get: {
          tags: ['Chat'],
          summary: 'Usuario autenticado en chat',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      user: { $ref: '#/components/schemas/ChatUser' },
                    },
                  },
                },
              },
            },
            401: { description: 'No autenticado' },
          },
        },
      },
      '/api/chat/contacts': {
        get: {
          tags: ['Chat'],
          summary: 'Contactos permitidos según rol',
          description:
            'Modelo → monitores. Monitor → modelos. Admin → modelos + monitores.',
          responses: {
            200: {
              description: 'Lista de contactos',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Contact' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/chat/conversations': {
        get: {
          tags: ['Chat'],
          summary: 'Listar conversaciones del usuario',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Conversation' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Chat'],
          summary: 'Crear o obtener conversación (ensure)',
          description:
            'Body: `{ "other_user_id": "<id_user|id_employee|id_model>" }`. ' +
            'Si el destino no existe en el directorio responde 404 `Usuario destino no encontrado` ' +
            '(la ruta SÍ existe; el 404 es de negocio).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['other_user_id'],
                  properties: {
                    other_user_id: {
                      type: 'string',
                      description: 'UUID id_employee (monitor) o id_model (modelo)',
                      example: '534910e2-c2c5-4c66-b934-e0140c07c696',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Conversación ya existía',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      created: { type: 'boolean', example: false },
                      conversation: { $ref: '#/components/schemas/ConversationCreated' },
                    },
                  },
                },
              },
            },
            201: { description: 'Conversación creada' },
            404: {
              description: 'Usuario destino no encontrado',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            422: { description: 'other_user_id requerido' },
          },
        },
      },
      '/api/chat/conversations/{conversationId}/messages': {
        get: {
          tags: ['Chat'],
          summary: 'Listar mensajes de una conversación',
          parameters: [
            {
              name: 'conversationId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'before',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Message' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/chat/conversations/{conversationId}/read': {
        post: {
          tags: ['Chat'],
          summary: 'Marcar conversación como leída',
          parameters: [
            {
              name: 'conversationId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            200: { description: 'OK' },
          },
        },
      },
      '/api/chat/messages': {
        post: {
          tags: ['Chat'],
          summary: 'Enviar mensaje',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['conversation_id'],
                  properties: {
                    conversation_id: { type: 'integer' },
                    content: { type: 'string' },
                    message_type: { type: 'string', default: 'text' },
                    media_url: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Mensaje creado' },
            422: { description: 'Datos incompletos' },
          },
        },
      },
      '/api/chat/devices/push-tokens': {
        post: {
          tags: ['Push'],
          summary: 'Registrar push token FCM',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['push_token'],
                  properties: {
                    push_token: { type: 'string' },
                    platform: { type: 'string', example: 'android' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Registrado' },
          },
        },
        delete: {
          tags: ['Push'],
          summary: 'Eliminar push token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['push_token'],
                  properties: {
                    push_token: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'OK' },
          },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec };
