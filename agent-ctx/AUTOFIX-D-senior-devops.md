# AUTOFIX-D — Senior DevOps + Real-Time Engineer

**Task ID:** AUTOFIX-D
**Scope:** chat-service tenant isolation + sane Next config + complete env example + docker-compose + Dockerfile

## Files Modified (3)
1. `mini-services/chat-service/index.ts` — rewritten with rooms, auth, env-driven CORS
2. `src/lib/socket.ts` — per-tenant socket cache + backwards-compat `getSocket(auth?)`
3. `next.config.ts` — `reactStrictMode: true`, `typescript.ignoreBuildErrors: false`, removed unsupported `eslint` block (Next 16)

## Files Created (3)
4. `.env.example` — 27 env vars documented, grouped, with security notes
5. `docker-compose.yml` — 11 production services, validated YAML
6. `Dockerfile` — multi-stage standalone build, non-root runtime

## Verification
- `bun run lint`: 0 errors / 0 warnings
- `npx tsc --noEmit | grep ^src/`: 0 errors
- chat-service restarted cleanly (port 3003 listening, logs show CORS + strict-auth status)
- dev server auto-restarted after next.config.ts edits, `Ready in 1497ms` with no warnings

## Key Decisions
- **Dev fallback tenant**: When `CHAT_STRICT_AUTH=false` (dev default) and `auth.tenantId` is missing, the socket is allowed to connect with `ten-saramantha` (logged as console.warn). Production should set `CHAT_STRICT_AUTH=true` to reject unauthenticated sockets.
- **`getSocket(auth?)` backwards-compat**: Callers that don't yet pass auth (i.e. `messenger-view.tsx`, owned by AUTOFIX-C) get a shared no-auth socket with a console.warn. AUTOFIX-C may upgrade the call site to pass `tenantId` from `useTenantStore`.
- **`eslint` key removed from next.config.ts**: Next.js 16 (Turbopack) emits `⚠ Unrecognized key(s) in object: 'eslint'` — the inline eslint block was removed in Next 16. Lint is now driven by `next lint` / `bun run lint` separately.
- **`.env` NOT modified**: preserved existing `DATABASE_URL` line so dev server keeps working.
- **Caddyfile NOT modified**: dev `:81` works for sandbox; production `docker-compose.yml` caddy uses `:80`+`:443` with auto-HTTPS.

## Cross-Agent Notes
- **AUTOFIX-C** (owns `src/components/dashboard/messenger-view.tsx`): please update the `getSocket()` call to `getSocket({ tenantId, conversationId })` using `useTenantStore` + the active conversation id. The backwards-compat path works but logs a warning on every connect.
- **AUTOFIX-A** (owns `src/app/api/**`): `/api/health` env-presence exposure accepted as informational (no values exposed, only booleans). No code change required.
