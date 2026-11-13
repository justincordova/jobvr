# syntax=docker/dockerfile:1

# --- Base: Node + pnpm (Corepack is no longer bundled with Node 25+) ---
FROM node:26-slim AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack@0.36.0 && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY poller/package.json poller/
COPY api/package.json api/
COPY web/package.json web/
# Download the pnpm version pinned in package.json once, shared by later stages
RUN corepack install

# --- Build: web SPA + bundled API, then a production-only API install ---
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY core core
COPY poller poller
COPY api api
COPY web web
RUN pnpm --filter @jobvr/api build && pnpm --filter @jobvr/web build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm --filter @jobvr/api deploy --prod --legacy --ignore-scripts /prod/api

# --- Runtime ---
FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/api

# Same relative layout as the repo, so WEB_DIST_DIR / MIGRATIONS_DIR defaults work.
# Files stay root-owned (read-only to the app); the process runs as `node`.
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /app/api/dist ./dist
COPY --from=build /app/core/drizzle /app/core/drizzle
COPY --from=build /app/web/dist /app/web/dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health`).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Exec form: Node is PID 1 and receives SIGTERM directly for graceful shutdown
CMD ["node", "--enable-source-maps", "dist/index.js"]
