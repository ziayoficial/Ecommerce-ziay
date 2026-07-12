# ───────────────────────────────────────────────────────────────────────────
# CommerceFlow OS — Dockerfile
# Multi-stage build: deps → builder → runner.
# Output mode: standalone (Next.js). Runs as non-root user.
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install bun for fast, lockfile-faithful installs.
RUN npm install -g bun

# Copy lockfile + package manifest first for better layer caching.
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install dependencies (including devDependencies — needed for build).
RUN bun install --frozen-lockfile

# Generate Prisma client (used at build time and runtime).
RUN bun run db:generate || bunx prisma generate

# ── Stage 2: builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build.
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js app (output: standalone).
# Note: we skip ESLint errors blocking the build; lint is run separately in CI.
RUN bun run build

# ── Stage 3: runner ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root user for security.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy standalone server, static assets and public folder.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma needs its schema + generated client at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
