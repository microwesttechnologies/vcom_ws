#!/usr/bin/env bash
# Diagnostica y asegura que wschat.vcommunity.cloud apunte al contenedor :8081
set -euo pipefail

echo "=== docker ps ==="
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}' | head -n 40 || true

echo "=== health contenedor host:8081 ==="
HOST_HEALTH="$(curl -sS http://127.0.0.1:8081/health || true)"
echo "$HOST_HEALTH"
echo "$HOST_HEALTH" | grep -q buildId || {
  echo "ERROR: :8081 no responde con buildId. Revisa docker compose."
  exit 1
}

echo "=== docs en :8081 ==="
curl -sS -o /tmp/docs_body.txt -w "HTTP:%{http_code}\n" http://127.0.0.1:8081/docs || true
head -c 180 /tmp/docs_body.txt; echo

echo "=== listeners ==="
ss -lntp 2>/dev/null | grep -E ':8081|:80|:443|:3000|:4000|:5000|:8080' || true

echo "=== buscando nginx ==="
CONF=""
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* /etc/nginx/sites-available/*; do
  [ -f "$f" ] || continue
  if grep -Eq "wschat\.vcommunity\.cloud" "$f"; then
    CONF="$f"
    break
  fi
done

if [ -z "$CONF" ]; then
  echo "No hay server_name wschat en nginx. Creando /etc/nginx/conf.d/wschat.conf"
  CONF="/etc/nginx/conf.d/wschat.conf"
  cat > "$CONF" <<'EOF'
server {
    listen 80;
    server_name wschat.vcommunity.cloud;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF
else
  echo "Config encontrada: $CONF"
  cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
  echo "=== antes ==="
  cat "$CONF"
  # Forzar todos los proxy_pass locales al puerto del contenedor
  sed -i -E 's|proxy_pass http://127\.0\.0\.1:[0-9]+|proxy_pass http://127.0.0.1:8081|g' "$CONF"
  sed -i -E 's|proxy_pass http://localhost:[0-9]+|proxy_pass http://127.0.0.1:8081|g' "$CONF"
fi

nginx -t
systemctl reload nginx 2>/dev/null || service nginx reload

echo "=== health via nginx (Host wschat) ==="
curl -sS -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/health || true
echo
curl -sS -o /dev/null -w "docs via nginx HTTP:%{http_code}\n" -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/docs || true

echo "DONE"
