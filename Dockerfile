FROM oven/bun:1.4.0 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:22-bookworm-slim AS runtime

COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV NODE_ENV=production \
    PORT=10000 \
    HOSTNAME=0.0.0.0 \
    QUORUM_DATA_DIR=/var/data/mcp \
    QUORUM_STORE_PATH=/var/data/quorum-store.json

RUN useradd --system --uid 1001 quorum \
    && mkdir -p /var/data/mcp \
    && chown -R quorum:quorum /var/data

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/mini-services/quorum-mcp ./mini-services/quorum-mcp
COPY --from=build /app/mini-services/quorum-mcp/data/tenders ./deploy-seed/tenders
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/scripts/start-render-api.sh ./scripts/start-render-api.sh

USER quorum

EXPOSE 10000

CMD ["bash", "scripts/start-render-api.sh"]
