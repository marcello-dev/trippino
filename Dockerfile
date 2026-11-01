FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ libstdc++6 \
  && npm_config_build_from_source=true npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node app ./app
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node migrate.js ./migrate.js

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=5000 \
    DATABASE_URL=/data/trippino.sqlite

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "app/app.js"]
