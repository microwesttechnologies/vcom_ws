const swaggerUi = require('swagger-ui-express');
const { buildOpenApiSpec } = require('./openapi');

/**
 * Monta:
 * - GET /docs          → Swagger UI
 * - GET /docs.json     → OpenAPI JSON
 * - GET /api-docs      → alias UI
 * - GET /api-docs.json → alias JSON
 *
 * Rutas cortas /docs evitan choques con proxies que solo enrutan /api/*.
 */
function mountSwagger(app) {
  const sendSpec = (req, res) => {
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https'
      ? 'https'
      : req.protocol;
    const host = req.get('host');
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildOpenApiSpec({ serverUrl: `${protocol}://${host}` }));
  };

  app.get('/docs.json', sendSpec);
  app.get('/api-docs.json', sendSpec);

  const ui = swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/docs.json',
      persistAuthorization: true,
    },
    customSiteTitle: 'VCOM Chat API — Swagger',
  });

  app.use('/docs', swaggerUi.serve, ui);
  app.use('/api-docs', swaggerUi.serve, ui);
  // Evitar confusion del 301: /docs -> /docs/
  app.get('/docs', (_req, res) => res.redirect(301, '/docs/'));
  app.get('/api-docs', (_req, res) => res.redirect(301, '/api-docs/'));

  console.log('[swagger] UI en /docs/ y /api-docs/ | JSON en /docs.json');
}

module.exports = { mountSwagger };
