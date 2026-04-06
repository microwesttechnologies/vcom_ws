const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { corsOrigin, chatUploadDir } = require('./config/env');
const pool = require('./db/pool');
const createChatRouter = require('./routes/chat.routes');
const createChatMediaRouter = require('./routes/chatMedia.routes');

function createApp({ wsGateway }) {
  const app = express();

  // Detras de Nginx/Hostinger, req.protocol debe respetar X-Forwarded-Proto
  app.set('trust proxy', true);

  app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/', (req, res) => {
    const protocol = req.protocol === 'https' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${req.get('host')}/ws?token=<JWT>`;

    res.type('html').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VCOM Chat API</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0f14;
        --card: #121922;
        --border: rgba(255,255,255,.08);
        --text: #f3f6fb;
        --muted: #9aa4b2;
        --ok: #22c55e;
        --warn: #f59e0b;
        --danger: #ef4444;
        --accent: #f1bf27;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(241,191,39,.14), transparent 30%),
          linear-gradient(180deg, #0b0f14 0%, #0f1722 100%);
        font-family: Arial, sans-serif;
        color: var(--text);
      }
      .card {
        width: min(680px, calc(100vw - 32px));
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 20px 60px rgba(0,0,0,.35);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(34,197,94,.12);
        color: #baf7cb;
        border: 1px solid rgba(34,197,94,.35);
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
        font-size: 12px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 12px var(--ok);
      }
      .dot--warn {
        background: var(--warn);
        box-shadow: 0 0 12px var(--warn);
      }
      .dot--danger {
        background: var(--danger);
        box-shadow: 0 0 12px var(--danger);
      }
      h1 {
        margin: 18px 0 10px;
        font-size: 34px;
      }
      p {
        margin: 0 0 18px;
        color: var(--muted);
        line-height: 1.5;
      }
      .panel {
        margin-top: 22px;
        padding: 18px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
      }
      .label {
        color: var(--accent);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .08em;
        margin-bottom: 8px;
      }
      code {
        display: block;
        overflow-x: auto;
        white-space: nowrap;
        color: var(--text);
        font-size: 14px;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 22px;
      }
      .grid--single {
        grid-template-columns: 1fr;
      }
      .row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }
      input {
        width: 100%;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.04);
        color: var(--text);
        border-radius: 12px;
        padding: 14px 16px;
        outline: none;
      }
      button {
        border: 0;
        border-radius: 12px;
        padding: 12px 16px;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-primary {
        background: var(--accent);
        color: #161616;
      }
      .btn-secondary {
        background: rgba(255,255,255,.08);
        color: var(--text);
      }
      .status {
        font-size: 14px;
        color: var(--muted);
      }
      .status strong {
        color: var(--text);
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .stat {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        background: rgba(255,255,255,.03);
      }
      .stat-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      .stat-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 800;
      }
      .log {
        max-height: 280px;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: #0d131b;
        padding: 12px;
        font-family: Consolas, monospace;
        font-size: 13px;
      }
      .log-line {
        padding: 8px 0;
        border-bottom: 1px solid rgba(255,255,255,.04);
        word-break: break-word;
      }
      .log-line:last-child {
        border-bottom: 0;
      }
      .muted {
        color: var(--muted);
      }
      @media (max-width: 720px) {
        .grid,
        .stats {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="badge" id="heroBadge"><span class="dot dot--warn" id="heroDot"></span> WebSocket pendiente</div>
      <h1>VCOM Chat API</h1>
      <p>El servicio HTTP esta activo y el gateway WebSocket esta expuesto en este servidor. Puedes probar la conexion y ver eventos en tiempo real desde aqui.</p>
      <div class="panel">
        <div class="label">Health</div>
        <code>GET ${req.protocol}://${req.get('host')}/health</code>
        <div class="status" style="margin-top:10px;">DB: <strong id="dbState">verificando...</strong></div>
      </div>
      <div class="panel">
        <div class="label">WebSocket</div>
        <code>${wsUrl}</code>
      </div>
      <div class="grid grid--single">
        <div class="panel">
          <div class="label">Realtime Test</div>
          <div class="row">
            <input id="tokenInput" type="text" placeholder="Pega un JWT para probar el WebSocket" />
          </div>
          <div class="row" style="margin-top:12px;">
            <button class="btn-primary" id="connectBtn" type="button">Conectar</button>
            <button class="btn-secondary" id="disconnectBtn" type="button">Desconectar</button>
            <button class="btn-secondary" id="pingBtn" type="button">Ping</button>
          </div>
          <div class="status" style="margin-top:12px;">
            Estado: <strong id="connectionState">desconectado</strong>
          </div>
        </div>
      </div>
      <div class="grid">
        <div class="panel">
          <div class="label">Metricas</div>
          <div class="stats">
            <div class="stat">
              <div class="stat-label">Eventos</div>
              <div class="stat-value" id="eventsCount">0</div>
            </div>
            <div class="stat">
              <div class="stat-label">Mensajes</div>
              <div class="stat-value" id="messagesCount">0</div>
            </div>
            <div class="stat">
              <div class="stat-label">Presencia</div>
              <div class="stat-value" id="presenceCount">0</div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="label">Eventos</div>
          <div class="log" id="eventLog">
            <div class="log-line muted">Esperando conexion...</div>
          </div>
        </div>
      </div>
    </main>
    <script>
      const tokenInput = document.getElementById('tokenInput');
      const connectBtn = document.getElementById('connectBtn');
      const disconnectBtn = document.getElementById('disconnectBtn');
      const pingBtn = document.getElementById('pingBtn');
      const connectionState = document.getElementById('connectionState');
      const eventLog = document.getElementById('eventLog');
      const eventsCount = document.getElementById('eventsCount');
      const messagesCount = document.getElementById('messagesCount');
      const presenceCount = document.getElementById('presenceCount');
      const heroBadge = document.getElementById('heroBadge');
      const heroDot = document.getElementById('heroDot');
      const dbState = document.getElementById('dbState');

      let socket = null;
      let totalEvents = 0;
      let totalMessages = 0;
      let totalPresence = 0;

      function setHero(state) {
        heroDot.className = 'dot';
        if (state === 'connected') {
          heroBadge.innerHTML = '<span class="dot" id="heroDot"></span> WebSocket conectado';
        } else if (state === 'connecting') {
          heroBadge.innerHTML = '<span class="dot dot--warn" id="heroDot"></span> WebSocket conectando';
        } else {
          heroBadge.innerHTML = '<span class="dot dot--danger" id="heroDot"></span> WebSocket desconectado';
        }
      }

      function updateState(text) {
        connectionState.textContent = text;
      }

      function appendLog(title, payload) {
        totalEvents += 1;
        eventsCount.textContent = String(totalEvents);

        if (title === 'message.new') {
          totalMessages += 1;
          messagesCount.textContent = String(totalMessages);
        }
        if (title === 'presence.update' || title === 'presence.snapshot') {
          totalPresence += 1;
          presenceCount.textContent = String(totalPresence);
        }

        const line = document.createElement('div');
        line.className = 'log-line';
        const now = new Date().toLocaleTimeString();
        line.innerHTML = '<strong>[' + now + ']</strong> ' + title + '<br><span class="muted">' +
          escapeHtml(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)) +
          '</span>';
        eventLog.prepend(line);
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function disconnectSocket() {
        if (socket) {
          socket.close();
          socket = null;
        }
      }

      async function checkDb() {
        try {
          const response = await fetch('/health/db', { cache: 'no-store' });
          const payload = await response.json();
          const ok = response.ok && payload && payload.success && payload.db === 'ok';
          if (ok) {
            dbState.textContent = 'conectado';
            dbState.style.color = '#22c55e';
          } else {
            dbState.textContent = 'desconectado';
            dbState.style.color = '#ef4444';
          }
        } catch (_) {
          dbState.textContent = 'desconectado';
          dbState.style.color = '#ef4444';
        }
      }

      connectBtn.addEventListener('click', function () {
        const token = tokenInput.value.trim();
        if (!token) {
          appendLog('ui.error', 'Debes ingresar un JWT antes de conectar.');
          return;
        }

        disconnectSocket();
        setHero('connecting');
        updateState('conectando');

        const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(wsProtocol + '//' + location.host + '/ws?token=' + encodeURIComponent(token));
        socket = ws;

        ws.addEventListener('open', function () {
          setHero('connected');
          updateState('conectado');
          appendLog('socket.open', { readyState: ws.readyState });
        });

        ws.addEventListener('message', function (event) {
          try {
            const parsed = JSON.parse(event.data);
            appendLog(parsed.event || 'socket.message', parsed.data ?? parsed);
          } catch (_) {
            appendLog('socket.message.raw', event.data);
          }
        });

        ws.addEventListener('close', function (event) {
          setHero('disconnected');
          updateState('desconectado');
          appendLog('socket.close', { code: event.code, reason: event.reason || '' });
        });

        ws.addEventListener('error', function () {
          setHero('disconnected');
          updateState('error');
          appendLog('socket.error', 'Fallo la conexion WebSocket.');
        });
      });

      disconnectBtn.addEventListener('click', function () {
        disconnectSocket();
        setHero('disconnected');
        updateState('desconectado');
        appendLog('ui.disconnect', 'Conexion cerrada manualmente.');
      });

      pingBtn.addEventListener('click', function () {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          appendLog('ui.error', 'No hay una conexion WebSocket abierta.');
          return;
        }

        const payload = { event: 'ping', data: {} };
        socket.send(JSON.stringify(payload));
        appendLog('client.ping', payload);
      });

      setHero('disconnected');
      checkDb();
      setInterval(checkDb, 15000);
    </script>
  </body>
</html>`);
  });

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'API chat running' });
  });

  app.get('/health/db', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ success: true, db: 'ok' });
    } catch (error) {
      res.status(503).json({
        success: false,
        db: 'down',
        message: error.message || 'database unavailable',
      });
    }
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
