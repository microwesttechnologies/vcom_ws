#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="${1:-/opt/api-vcom-chat}"
cd "$REMOTE_DIR"

echo "=== contenido desplegado ==="
ls -la
rm -f compose.override.yml

echo "=== src ==="
du -sh src
find src -type f | wc -l
test -f src/docs/swagger.js || { echo "ERROR: falta src/docs/swagger.js"; exit 1; }
grep -q mountSwagger src/app.js || { echo "ERROR: src/app.js sin mountSwagger"; exit 1; }
grep -q buildId src/app.js || { echo "ERROR: src/app.js sin buildId"; exit 1; }

docker compose -f compose.vps.yml build --no-cache api-vcom-chat
docker compose -f compose.vps.yml up -d --force-recreate api-vcom-chat
sleep 4

echo "=== dentro del contenedor /app ==="
docker exec api-vcom-chat ls -la /app
docker exec api-vcom-chat test -f /app/src/docs/swagger.js
docker exec api-vcom-chat grep -q buildId /app/src/app.js
echo CONTAINER_FILES_OK

echo "=== health HOST :8081 ==="
curl -sS http://127.0.0.1:8081/health
echo
curl -sS -o /dev/null -w "docs/ :8081 HTTP:%{http_code}\n" http://127.0.0.1:8081/docs/

echo "=== docker ps ==="
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'

echo "=== FIX TRAEFIK (no nginx) ==="
chmod +x fix-traefik-wschat.sh
bash fix-traefik-wschat.sh

echo "=== verificacion publica local (si hay curl a dominio) ==="
curl -sS https://wschat.vcommunity.cloud/health || true
echo
curl -sS -o /dev/null -w "docs/ publico HTTP:%{http_code}\n" https://wschat.vcommunity.cloud/docs/ || true

echo "DEPLOY_REMOTE_OK"
