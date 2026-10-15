FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_PATH=/data/orbita.sqlite \
    SECURE_COOKIES=true
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server-dist/server ./server-dist/server
COPY --from=build --chown=node:node /app/server-dist/src ./server-dist/src
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/check-livekit.mjs ./scripts/check-livekit.mjs
USER node
EXPOSE 3001
CMD ["node", "server-dist/server/main.js"]
