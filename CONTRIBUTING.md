# Contributing to ZIAY

## Development Workflow

1. **Branch:** `feat/description` or `fix/description`
2. **Commit:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)
3. **PR:** Squash-merge to `main`

## Before Submitting a PR

- [ ] `bun run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `bun run test` passes
- [ ] No new `any` types
- [ ] No `console.log` in server code (use `logger`)
- [ ] Zod validation on new API endpoints
- [ ] `requireTenantAccess` on tenant-scoped routes

## Code Style

- TypeScript strict mode
- `'use client'` / `'use server'` directives where needed
- shadcn/ui components over custom
- Spanish UI text (LATAM market)
- JSDoc on exported functions

## Adding New Features

### New API route
1. Create `src/app/api/<path>/route.ts`
2. Use `requireTenantAccess(tenantId)` for auth
3. Validate input with Zod
4. Wrap in `withErrorHandling()`
5. Add to `/api-docs` if user-facing

### New AI agent
1. Add prompt to `src/lib/agents/prompts/`
2. Register in `AGENT_NAMES` + `AGENT_LABELS`
3. Add output Zod schema to `src/lib/agents/schemas.ts`
4. Add fallback message in `FALLBACKS`

### New payment adapter
1. Create `src/lib/adapters/<gateway>.ts`
2. Implement `PaymentAdapter` interface
3. Register in `payment-registry.ts`
4. Add webhook route `src/app/api/webhooks/<gateway>/route.ts`
5. Verify HMAC signature with `timingSafeEqual`
