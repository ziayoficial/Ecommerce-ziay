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
