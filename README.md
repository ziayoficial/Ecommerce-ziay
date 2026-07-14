# ZIAY · Comercio Conversacional + Atribución Inteligente

Plataforma de comercio agéntico para LATAM. WhatsApp, Messenger, Instagram con atribución de pauta, agentes IA y compliance regulatorio Colombia.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values (at minimum: NEXTAUTH_SECRET, ENCRYPTION_KEY)

# 3. Set up database
bun run db:push
bun run db:seed

# 4. Start dev server
bun run dev
```

Open http://localhost:3000/login and use the demo credentials:
- **Admin:** valentina@saramantha.co / demo123
- **Agent:** camila@saramantha.co / demo123
- **Trafficker:** sebastian@trafficker.co / demo123

## Prerequisites

- Node.js 20+ or Bun 1.0+
- SQLite (dev) or PostgreSQL 16+ (prod)
- Meta Business account (for WhatsApp/Messenger/Instagram)
- Payment gateway account (MercadoPago, Wompi, Stripe, or PayU)

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript 5 (strict)
- **Database:** Prisma 6 + SQLite/PostgreSQL
- **UI:** Tailwind CSS 4 + shadcn/ui
- **Auth:** NextAuth.js v4 + JWT + RBAC
- **AI:** z-ai-web-dev-sdk (glm-4.6) + multi-provider adapter
- **Real-time:** Socket.io (port 3003)
- **Protocols:** AP2, UCP, ACP, MCP, A2A

## Documentation

- [Architecture](docs/MAESTRO-arquitectura.md)
- [Deployment Guide](upload/GUIA-DEPLOY-PRODUCCION.md)
- [Production Checklist](PRODUCTION-CHECKLIST.md)
- [DR Runbook](docs/DR-RUNBOOK.md)
- [API Docs](/api-docs) (when running)

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (port 3000) |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | ESLint check |
| `bun run test` | Run unit tests |
| `bun run test:e2e` | Run E2E tests (Playwright) |
| `bun run db:push` | Push schema to database |
| `bun run db:seed` | Seed demo data |
| `bun run db:migrate` | Run migrations |

## License

Proprietary — Indisutex SAS © 2026
