FROM node:22-alpine

WORKDIR /app

# Dépendances (pg) — layer séparé pour le cache de build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Statiques servis par server.js depuis /app/public
COPY server/server.js /app/server.js
COPY index.html login.html /app/public/
COPY style.css /app/public/style.css
COPY js/ /app/public/js/

# Volume migration (lecture /data/state.json)
RUN mkdir -p /data && chown node:node /data \
    && chmod -R a+rX /app
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FILE=/data/state.json

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

EXPOSE 3000
CMD ["node", "server.js"]
