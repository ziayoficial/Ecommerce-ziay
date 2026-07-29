# ZIAY Style Guide

## TypeScript

- Strict mode (no `any`, no `@ts-ignore`)
- Use `interface` for object shapes, `type` for unions
- Prefer `unknown` over `any` for error catches
- Use Zod for runtime validation

## File Organization

- API routes: `src/app/api/<resource>/route.ts`
- Services: `src/lib/services/<name>.service.ts`
- Adapters: `src/lib/adapters/<name>.ts`
- Components: `src/components/<category>/<name>.tsx`
- Hooks: `src/hooks/use-<name>.ts`

## Naming

- Files: `kebab-case.ts` / `PascalCase.tsx`
- Components: `PascalCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

## Spanish UI

- All user-facing text in Spanish (LATAM)
- Error messages in Spanish
- Code comments in English or Spanish (be consistent within a file)

## Database

- Prisma model names: `PascalCase` singular
- Fields: `camelCase`
- Indexes: `@@index([field1, field2])`
- Always add `tenantId` + `@@index([tenantId])` for tenant-scoped models
