FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copiar codigo de forma explicita (evita contextos vacios / ignores raros)
COPY src ./src
COPY db ./db

RUN test -f /app/src/server.js \
  && test -f /app/src/app.js \
  && test -f /app/src/docs/swagger.js \
  && test -f /app/src/docs/openapi.js \
  && echo "SOURCE_OK"

ENV NODE_ENV=production
EXPOSE 8081

CMD ["npm", "start"]
