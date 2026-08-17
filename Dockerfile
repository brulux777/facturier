FROM node:22-alpine

WORKDIR /app

# Statiques servies par server.js depuis /app/public
COPY server/server.js /app/server.js
COPY index.html /app/public/index.html
COPY style.css /app/public/style.css
COPY js/ /app/public/js/

# Volume de données (/data/state.json)
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
