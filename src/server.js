const http = require('http');
const createApp = require('./app');
const { port } = require('./config/env');
const { runMigration } = require('./db/migrate');
const SocketGateway = require('./ws/socket.gateway');

async function startServer() {
  await runMigration();

  const wsGateway = new SocketGateway();
  const app = createApp({ wsGateway });
  const server = http.createServer(app);

  wsGateway.attach(server);

  server.listen(port, () => {
    console.log(`Chat API listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start chat API:', error);
  process.exit(1);
});
