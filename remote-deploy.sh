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
curl -sS -o /dev/null -w "docs :8081 HTTP:%{http_code}\n" http://127.0.0.1:8081/docs

echo "=== puertos ==="
ss -lntp | grep -E '8081|80|443|3000|4000|5000|8080' || true

echo "=== nginx grep ==="
grep -RInE "wschat|8081|proxy_pass" /etc/nginx 2>/dev/null | head -n 80 || true

echo "=== FIX NGINX ==="
chmod +x fix-nginx-wschat.sh
bash fix-nginx-wschat.sh

echo "=== health via nginx Host header ==="
curl -sS -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/health || true
echo
curl -sS -o /dev/null -w "docs via nginx HTTP:%{http_code}\n" -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/docs || true

echo "DEPLOY_REMOTE_OK"
