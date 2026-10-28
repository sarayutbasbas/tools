FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN node scripts/ensure-yt-dlp.mjs \
    && npm run build \
    && ./node_modules/.bin/tsc -p server/tsconfig.build.json

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=1111

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ghostscript ca-certificates \
    && rm -r /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/build-server ./server
COPY --from=build --chown=node:node /app/.toolbox-bin ./.toolbox-bin

USER node

EXPOSE 1111

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
