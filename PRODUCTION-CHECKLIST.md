# ZIAY — Production Deployment Checklist

> **Goal**: take ZIAY from the dev sandbox to a production tenant serving
> real customers. Work top-to-bottom — 🔴 blocks launch, 🟡 should ship in
> v1, 🟢 can land in v1.1.
>
> Last updated: SPRINT5-FINAL-001

---

## 🔴 Critical (must do before launch)

### Secrets & encryption
- [ ] Generate `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- [ ] Generate `ENCRYPTION_KEY` (32 hex bytes for 2FA secrets) — `openssl rand -hex 32`
- [ ] Rotate any demo secrets currently committed in `.env.example` out of git history
- [ ] Store all secrets in your secret manager (Vault / AWS SM / Doppler) — never in plaintext `.env` on the server

### Database
- [ ] Provision a PostgreSQL 15+ instance (SQLite is dev-only)
- [ ] Set `DATABASE_URL` with pooling params (`?connection_limit=20&pool_timeout=10`)
- [ ] Run `bun run db:migrate` (NOT `db:push` — `db:push` is dev-only and skips the migration history)
- [ ] Run `bunx prisma db seed` to load demo tenants / catalog
- [ ] Take a baseline snapshot / pg_dump after seeding
- [ ] Configure nightly automated backups (see `scripts/backup.sh`)

### Payments (all 4 gateways — at least one is required to launch)
- [ ] **MercadoPago** — set `MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET`; register webhook URL in MP dashboard
- [ ] **Wompi** — set `WOMPI_PUBLIC_KEY` + `WOMPI_PRIVATE_KEY` + `WOMPI_EVENT_SECRET`; register webhook
- [ ] **Stripe** — set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; `stripe listen --forward-to` in dev, production endpoint in dashboard
- [ ] **PayU** — set `PAYU_API_KEY` + `PAYU_MERCHANT_ID` + `PAYU_ACCOUNT_ID` + `PAYU_API_LOGIN`; set `PAYU_TEST_MODE=false`
- [ ] Set `PAYMENT_RETURN_URL_SUCCESS` / `_FAILURE` / `_PENDING` to your production domain
- [ ] Test each gateway end-to-end in sandbox mode before flipping to production keys

### WhatsApp & Meta
- [ ] Configure WhatsApp Business API credentials (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_TOKEN`, `WHATSAPP_CATALOG_ID`)
- [ ] Set `WA_VERIFY_TOKEN` and register the webhook URL in the Meta App Dashboard
- [ ] Set `META_VERIFY_TOKEN` + `META_APP_SECRET` for Instagram messaging
- [ ] Verify the webhook handshake works (`GET /api/webhooks/whatsapp?hub.verify_token=…`)

### Infrastructure
- [ ] Set `NEXTAUTH_URL` to the production HTTPS URL
- [ ] Configure HTTPS (Caddy auto-HTTPS is the default; nginx + Let's Encrypt works too)
- [ ] Configure `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` for error tracking
- [ ] Set up the cron job for backups — `crontab: 0 3 * * * /app/scripts/backup.sh`
- [ ] Confirm `bun run dev` → switch to `bun run start` (or PM2 / systemd) in production

### Smoke tests (run all before flipping DNS)
- [ ] `GET /api/health` returns `status: "ok"` (or `"warning"` for soft checks)
- [ ] `GET /api/health/ready` returns 200
- [ ] `POST /api/auth/[...nextauth]` (credentials flow) succeeds for a seeded user
- [ ] `GET /api/overview` returns KPIs for a seeded tenant
- [ ] A test conversation can be created and an AI reply generated
- [ ] A test order can be created and a payment link generated
- [ ] At least one webhook (WhatsApp recommended) round-trips successfully

---

## 🟡 Important (should do — ship in v1)

### Performance & scaling
- [ ] Set `REDIS_URL` for shared cache + socket.io adapter (multi-instance)
- [ ] Configure CDN for product images (CloudFront / Cloudflare / Bunny)
- [ ] Set `connection_limit` on `DATABASE_URL` to match your pooler's max
- [ ] Confirm the in-memory cache GC interval (5 min) isn't holding too much for your tenant count

### Observability
- [ ] Set up Uptime Kuma (or Pingdom) hitting `/api/health/live` every 30s
- [ ] Configure log rotation (`pm2-logrotate` or `logrotate` daemon)
- [ ] Set up email / Slack notifications for Sentry errors
- [ ] Add a Grafana board on top of `/api/health` JSON (Prometheus scraper available on request)

### Webhook hardening
- [ ] Configure payment webhook URLs in EACH gateway's dashboard (not just env vars)
- [ ] Verify HMAC signatures are being checked (`src/lib/middleware/hmac.ts`)
- [ ] Test Stripe's retry burst (5 retries over ~5 min) — confirm idempotency
- [ ] Confirm WhatsApp's `hub.challenge` handshake responds with the right token

### i18n & locale
- [ ] Set `ZIAY_LOCALE` to the tenant's primary locale (`es-CO`, `es-MX`, `en-US`)
- [ ] If adding a new locale, extend `src/lib/i18n.ts` and verify fallback to `es-CO`
- [ ] Test dates / currency formatting in the target locale

### Backups & DR
- [ ] Test restoring from a backup at least once (untested backups = no backups)
- [ ] Document the restore procedure in your runbook
- [ ] Configure offsite backup replication (S3 / GCS with lifecycle policy)

---

## 🐘 PostgreSQL Migration (dev SQLite → prod PostgreSQL)

> Step-by-step runbook for taking ZIAY from the bundled SQLite dev DB to a
> production PostgreSQL instance. Tracked under SPRINT7-POSTGRES-SERVICES-001.
> Companion files: `prisma/schema.prisma` (top comment), `prisma/migrations/
> 1_postgres_indexes/migration.sql` (RLS + index re-statement), `src/lib/db.ts`
> (pooling notes), `.env.example` (`DATABASE_URL` block).

1. **Install PostgreSQL 16** on the production host (or provision a managed
   instance — RDS / Cloud SQL / Neon / Supabase all work). Confirm with:
   ```bash
   psql --version          # expect psql (PostgreSQL) 16.x
   sudo systemctl status postgresql
   ```

2. **Create the database + app user** (run as the postgres superuser):
   ```bash
   sudo -u postgres psql
   ```
   ```sql
   CREATE DATABASE ziay;
   CREATE USER ziay_app WITH ENCRYPTED PASSWORD 'CHANGE_ME';
   GRANT ALL PRIVILEGES ON DATABASE ziay TO ziay_app;
   \c ziay
   GRANT ALL ON SCHEMA public TO ziay_app;
   -- Optional but recommended: enable pgvector up front for future RAG work.
   CREATE EXTENSION IF NOT EXISTS vector;
   \q
   ```

3. **Switch the Prisma provider to `postgresql`** in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
   The full SQLite→PG comment block at the top of the schema file lists the
   same steps for future reference.

4. **Set `DATABASE_URL`** in your production `.env` (or secret manager):
   ```bash
   DATABASE_URL=postgresql://ziay_app:CHANGE_ME@localhost:5432/ziay?schema=public&connection_limit=20&pool_timeout=10
   ```
   For PgBouncer / serverless, append `&pgbouncer=true` and drop
   `connection_limit` to ~10.

5. **Apply migrations** — `0_init` creates the tables, `1_postgres_indexes`
   re-states every `@@index` / `@@unique` (idempotent) and enables Row-Level
   Security on the 10 most critical tenant-scoped tables:
   ```bash
   bun run db:migrate        # prisma migrate deploy
   ```
   Verify in `_prisma_migrations` that both `0_init` and
   `1_postgres_indexes` are recorded as applied.

6. **Seed the database** with demo tenants + catalog:
   ```bash
   bunx prisma db seed
   ```

7. **Verify the migration landed correctly**:
   ```bash
   psql -d ziay -c "SELECT COUNT(*) FROM \"Tenant\";"
   psql -d ziay -c "SELECT COUNT(*) FROM \"Product\";"
   psql -d ziay -c "SELECT relname, relrowsecurity FROM pg_class WHERE relrowsecurity = true;"
   # The last query should list ~10 tables with RLS enabled.
   ```

8. **(Optional) Migrate existing SQLite data** if you have dev/seed data you
   need to preserve. Two options:
   - **pgloader** (recommended for one-shot moves):
     ```lisp
     # migrate.load
     LOAD DATABASE
       FROM sqlite:///home/z/my-project/db/custom.db
       INTO postgresql:///ziay
     WITH include drop, create tables, create indexes, reset sequences,
          downcase identifiers
     ALTER schema 'public' OWNER TO 'ziay_app'
     ;
     ```
     Run with `pgloader migrate.load`.
   - **Prisma data proxy** snapshot — export each model to JSON from SQLite,
     then `prisma db seed`-style re-insert into PostgreSQL. Slower but no
     extra binary dependency.

9. **Smoke test the API against the new DB** before flipping DNS:
   ```bash
   curl -s http://localhost:3000/api/health | jq .status          # "ok"
   curl -s 'http://localhost:3000/api/overview?tenantId=ten-saramantha' | jq .
   curl -s 'http://localhost:3000/api/orders?tenantId=ten-saramantha&limit=5' | jq '.orders | length'
   ```

10. **Take a baseline snapshot** and configure nightly `pg_dump` backups:
    ```bash
    pg_dump -Fc -d ziay -f /var/backups/ziay/$(date +%Y%m%d).dump
    # crontab: 0 3 * * * /usr/bin/pg_dump -Fc -d ziay -f /var/backups/ziay/$(date +\%Y\%m\%d).dump
    ```

> Rollback: keep the SQLite `custom.db` file alongside until the PostgreSQL
> instance has run cleanly for 7 days. To revert, flip `provider` back to
> `sqlite`, restore `DATABASE_URL=file:...`, and `bun run db:push`.

---

## 🟢 Nice to have (v1.1+)

- [ ] Set up Grafana + Prometheus for full metrics dashboards
- [ ] Generate an OpenAPI 3.1 spec from `/api-docs` and host Swagger UI at `/docs`
- [ ] Configure per-endpoint rate limits (`src/lib/middleware/rate-limit.ts`)
- [ ] Set up A/B testing for agent prompts (track via `prompt_version` field)
- [ ] Configure voice agents via Vapi AI (see `src/lib/agents/prompts/speech.ts`)
- [ ] Migrate idempotency Map → Redis SET (multi-instance safe, see worklog SPRINT4)
- [ ] Add tenant-level locale overrides (read from `tenant.locale` instead of env)
- [ ] Add a `/api/health/dependencies` graph view for the dashboard
- [ ] Set up Blue/Green deploys with health-check-gated traffic shifting

---

## 🚀 Pre-launch final review

- [ ] All 🔴 items checked
- [ ] At least 80% of 🟡 items checked
- [ ] Smoke tests all green
- [ ] DNS switched (or ready to switch)
- [ ] On-call rotation set up for the first week
- [ ] Rollback procedure documented and tested

---

## 📚 Reference

- **Worklog**: `/home/z/my-project/worklog.md` — full history of every sprint
- **API docs**: `GET /api-docs` — JSON manifest of all routes
- **Health**: `GET /api/health` — integration checks + runtime metrics
- **Schema**: `prisma/schema.prisma` — top comment block has the SQLite→PG migration guide
- **Backups**: `scripts/backup.sh` — wraps `sqlite3 .dump` / `pg_dump`
- **i18n**: `src/lib/i18n.ts` — lightweight `t()` function, no external deps
