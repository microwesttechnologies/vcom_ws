#!/usr/bin/env bash
# Enruta wschat.vcommunity.cloud (Traefik) al contenedor nuevo api-vcom-chat
set -euo pipefail

OLD_CONTAINER="${OLD_CONTAINER:-ws-vcom-vcomchat-api-1}"
NEW_CONTAINER="${NEW_CONTAINER:-api-vcom-chat}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/api-vcom-chat}"

cd "$COMPOSE_DIR"

echo "=== health nuevo :8081 ==="
curl -sS http://127.0.0.1:8081/health
echo

if ! docker ps --format '{{.Names}}' | grep -qx "$NEW_CONTAINER"; then
  echo "ERROR: no esta corriendo $NEW_CONTAINER"
  exit 1
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$OLD_CONTAINER"; then
  echo "WARN: no existe $OLD_CONTAINER; se intentara configurar Traefik con valores por defecto"
  OLD_CONTAINER=""
fi

NETWORK=""
CERT_RESOLVER=""
ENTRYPOINT="websecure"

if [ -n "$OLD_CONTAINER" ]; then
  echo "=== labels Traefik del contenedor viejo ==="
  docker inspect "$OLD_CONTAINER" --format '{{range $k, $v := .Config.Labels}}{{println $k "=" $v}}{{end}}' | grep -i traefik || true

  NETWORK="$(docker inspect "$OLD_CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -n 1)"
  CERT_RESOLVER="$(docker inspect "$OLD_CONTAINER" --format '{{index .Config.Labels "traefik.http.routers.vcomchat.tls.certresolver"}}{{index .Config.Labels "traefik.http.routers.wschat.tls.certresolver"}}{{index .Config.Labels "traefik.http.routers.api-vcom-chat.tls.certresolver"}}' 2>/dev/null || true)"
  # Buscar certresolver en cualquier label
  if [ -z "$CERT_RESOLVER" ]; then
    CERT_RESOLVER="$(docker inspect "$OLD_CONTAINER" --format '{{range $k, $v := .Config.Labels}}{{println $k "=" $v}}{{end}}' | grep -i 'certresolver' | head -n 1 | sed -E 's/.*=//')"
  fi
  # Buscar entrypoint
  EP="$(docker inspect "$OLD_CONTAINER" --format '{{range $k, $v := .Config.Labels}}{{println $k "=" $v}}{{end}}' | grep -i 'entrypoints' | head -n 1 | sed -E 's/.*=//')"
  if [ -n "$EP" ]; then ENTRYPOINT="$EP"; fi
fi

# Fallbacks comunes en stacks wa-vcom / ws-vcom
if [ -z "$NETWORK" ]; then
  for n in wa-vcom_default ws-vcom_default traefik proxy web; do
    if docker network ls --format '{{.Name}}' | grep -qx "$n"; then
      NETWORK="$n"
      break
    fi
  done
fi

if [ -z "$NETWORK" ]; then
  echo "ERROR: no se pudo detectar la red de Traefik"
  docker network ls
  exit 1
fi

if [ -z "$CERT_RESOLVER" ]; then
  CERT_RESOLVER="letsencrypt"
fi

echo "NETWORK=$NETWORK"
echo "ENTRYPOINT=$ENTRYPOINT"
echo "CERT_RESOLVER=$CERT_RESOLVER"

cat > compose.traefik.yml <<EOF
services:
  api-vcom-chat:
    networks:
      - default
      - traefik
    labels:
      - traefik.enable=true
      - traefik.docker.network=${NETWORK}
      - traefik.http.routers.wschat.rule=Host(\`wschat.vcommunity.cloud\`)
      - traefik.http.routers.wschat.entrypoints=${ENTRYPOINT}
      - traefik.http.routers.wschat.tls=true
      - traefik.http.routers.wschat.tls.certresolver=${CERT_RESOLVER}
      - traefik.http.routers.wschat.service=wschat
      - traefik.http.services.wschat.loadbalancer.server.port=8081
      # HTTP -> HTTPS opcional (si existe entrypoint web)
      - traefik.http.routers.wschat-http.rule=Host(\`wschat.vcommunity.cloud\`)
      - traefik.http.routers.wschat-http.entrypoints=web
      - traefik.http.routers.wschat-http.middlewares=wschat-https
      - traefik.http.middlewares.wschat-https.redirectscheme.scheme=https

networks:
  traefik:
    external: true
    name: ${NETWORK}
EOF

echo "=== compose.traefik.yml ==="
cat compose.traefik.yml

echo "=== recreando api-vcom-chat con labels Traefik ==="
docker compose -f compose.vps.yml -f compose.traefik.yml up -d --force-recreate --no-deps api-vcom-chat
sleep 3

if [ -n "$OLD_CONTAINER" ]; then
  echo "=== deteniendo contenedor viejo $OLD_CONTAINER (deja de recibir trafico Traefik) ==="
  docker stop "$OLD_CONTAINER" || true
fi

echo "=== health :8081 ==="
curl -sS http://127.0.0.1:8081/health
echo
echo "=== docs :8081/docs/ ==="
curl -sS -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1:8081/docs/ || true

echo "DONE"
echo "Abre: https://wschat.vcommunity.cloud/docs/"
echo "Health publico debe incluir buildId"
