#!/bin/bash
set -e

# Clean stale build caches that cause false lint/tsc results
# Document §SPRINT-POLISH-001: ESLint reads cached AST from tsbuildinfo

echo "🧹 Cleaning stale caches..."

# Remove TypeScript build info
rm -f tsconfig.tsbuildinfo
rm -f .next/cache/.tsbuildinfo 2>/dev/null || true

# Remove ESLint cache (if any)
rm -f .eslintcache 2>/dev/null || true

# Remove .next cache (will be rebuilt on next dev/build)
rm -rf .next/cache 2>/dev/null || true

# Remove vitest cache
rm -rf node_modules/.vite 2>/dev/null || true

echo "✅ Caches cleaned. Run 'bun run lint' + 'npx tsc --noEmit' for fresh results."
