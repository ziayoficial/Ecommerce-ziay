# Chat-service Dockerfile — production build
# SPRINT-INFRA-FINAL-001 · Sprint 7A — switch from `bun --hot` bind-mount dev
# mode to a multi-stage production image. Build context is the repo root
# (set in docker-compose.yml: `context: ., dockerfile: mini-services/chat-service/Dockerfile`)
# so the COPY paths below resolve relative to the repo root.

# ── Stage 1: base — install deps ──────────────────────────────────────────────
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies (cached layer — only invalidated when package.json or
# bun.lock changes)
COPY mini-services/chat-service/package.json mini-services/chat-service/bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY mini-services/chat-service/index.ts ./
COPY mini-services/chat-service/tsconfig.json ./

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/index.ts ./
COPY --from=base /app/tsconfig.json ./

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3003/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "index.ts"]
