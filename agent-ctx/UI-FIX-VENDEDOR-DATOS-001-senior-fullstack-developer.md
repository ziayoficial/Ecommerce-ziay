# Worklog — UI-FIX-VENDEDOR-DATOS-001

**Task ID:** UI-FIX-VENDEDOR-DATOS-001
**Agent:** Senior Fullstack Developer
**Date:** 2026-07-11
**Scope:** New `/vendedor` SSR page + rich seed data (25 products, 201 orders, 82 conversations, 120 buyer behaviors, 10 novedades, 20 guide movements, 1 trafficker with wallet)

---

## PART 1 — Página del Vendedor (`src/app/vendedor/page.tsx`)

### New files created
- `src/app/vendedor/page.tsx` (server component, SSR, `force-dynamic`)
- `src/components/vendedor/performance-chart.tsx` (client component using Recharts AreaChart)

### Features implemented
- **`generateMetadata`** with dynamic title/description based on seller name + tenant brand
- **`resolveSeller(sellerId?)`** helper: uses `?sellerId=` param OR defaults to first admin/agent user
- **JSON-LD `Person` schema** with name, email, jobTitle, worksFor
- **Seller profile card**: avatar (initials fallback), name, role badge, email, tenant (link to `/t/[slug]`), "active since" date
- **6 KPI cards**: Convers. asignadas · Ventas hoy · Ventas semana · GMV mes · Conversión · AOV
- **Performance chart** (Recharts AreaChart, 14 days GMV with gradient fill, custom tooltip)
- **Active conversations list** (max 8, status badges, priority, perfil, unread count, time-ago)
- **Commissions card**: shows trafficker wallet (saldo disponible + pendiente) when seller.role === 'trafficker'; otherwise shows notional monthly incentive (30% of platform commission on confirmed sales)
- **Recent sales table** (last 10 orders): number, customer + phone, city, items count, total COP, payment mode, status badge with icon
- **Quick actions**: "Abrir mensajería" → `/?view=messenger`, "Ver catálogo" → `/t/[slug]`, "Solicitar retiro" → `/?view=wallet`
- **Seller switcher** (demo): server-rendered links to switch `?sellerId=` for all 10 users
- **Sticky header** + footer (sticky-to-bottom layout via `min-h-screen flex flex-col` + `mt-auto`)

### Status tone mappings
- Order: pending_confirmation (amber), intent_cancelacion/returned/cancelled (rose), datos_completados (sky), oficina (violet), despachado/delivered (emerald)
- Conversation: open (emerald), pending (amber), resolved (sky), closed (muted)
- Priority: urgent (rose), high (orange), normal/low (muted)

### TypeScript
- `dynamic = 'force-dynamic'` (SSR per request)
- Strict types throughout; no `any`
- All Prisma queries use `include` for relations
- `searchParams` typed as `Promise<{ sellerId?: string }>` (Next.js 16 async searchParams)

---

## PART 2 — Seed enrichment (`prisma/seed.ts`)

### Idempotency
- Added `cleanup()` function that `deleteMany`s ALL transactional tables in FK-safe order before re-seeding
- Keeps `tenants` + `users` (which use `upsert` by email) intact
- Verified: re-running the seed twice produces identical counts

### Rich demo data added (totals)
| Entity | Count | Notes |
|---|---|---|
| Tenants | 5 | Saramantha, Majestic, Lovely, Reina, INTL |
| Users | 10 | 1 admin + 1 agent per tenant + Sebastián (trafficker) for Saramantha + Lucía (intl admin) |
| Products | **25** (all with Unsplash images) | 10 Saramantha (shorts/pantalones/batolas en liso + Stitch + Hello Kitty + Marvel + Minnie) + 5 Majestic (mug/camiseta/totbag/cojín/termo sublimados) + 5 Lovely (satin/silk/lace/floral pijamas) + 5 Reina (bata/camisón/kimono/pijama/conjunto) |
| Customers | 75 | 18 per tenant × 4 + 3 INTL (Jessica DE, Sofía ES, Ricardo MX) |
| Conversations | 82 | 20 per tenant × 4 + 2 INTL; each with 5-10 realistic messages (greeting → inquiry → price neg → address → payment → confirm) |
| Messages | 629 | Inbound (customer) + outbound (Sara-style AI responses) |
| Orders | **201** | 50 per tenant × 4 + 1 INTL; status mix matches §15.1 funnel: 144 pending_confirmation (72%), 16 datos_completados (8%), 16 intent_cancelacion (8%), 12 oficina (6%), 8 despachado (4%), 5 delivered (2%) |
| OrderItems | ~400 | 1-3 items per order, mix of qty (1, 2, 3, 6, 12 for wholesale) |
| OrderEvents | ~280 | created + confirmed + shipped lifecycle |
| Shipments | 13 | For despachado/delivered orders (with numeroGuia, transportadora, tarifa) |
| CommissionEntries | 24 | 100% recognition at despachado, 50% at datos_completados (per §17.7) |
| GuideTracking | 13 | Linked to shipments with carrier canonical |
| **Novedades cases** | **10** | Mix of types (lost, damaged, wrong_product, delayed, not_delivered, returned); each with 1-2 evidence entries + 3-4 messages (customer/ai/agent) + resolution (replacement/compensation/refund) + compensation amount |
| **Buyer behaviors** | **120** (30 per tenant) | Mix of riskLevels: normal/caution/high_risk/blacklist; pattern flags (crossStoreOrdering, selectiveReturn, highReturnRate, chronicCancellation, codAbuse); generates BehaviorAlert for non-normal |
| BehaviorAlerts | ~60 | Linked to BuyerBehavior via FK; severity block/critical/warning |
| CustomerScores | 48 | 12 per tenant (confiable/riesgo/devolvedor mix) |
| **Guide movements** | **20** | Mix of events: created, picked_up, in_transit, out_for_delivery, delivery_attempt, delivered, returned, held_at_office, address_correction_requested, redelivery_scheduled |
| **Trafficker** | 1 (Sebastián Marín) | With wallet ($1.85M balance, $320K pending, $4.2M total earned), KYC verified, Bancolombia account, 2FA enabled |
| TraffickerCampaigns | 3 | Running pauta for 3 Saramantha products (meta/tiktok/google) |
| **TraffickerSales** | 12 | Linked to Saramantha orders from trafficker-driven ads (10% commission); mix of confirmed/pending/failed |
| TraffickerTransactions | 8 | Commission entries for confirmed sales (linked to sale + campaign) |
| WalletTransactions | 7 | Deposit + 4 commissions + 2 withdrawals (balance history: 0 → 500k → 300k → 1.85M) |
| WalletAccounts | 1 | Sebastián's Bancolombia account (verified, default) |
| WithdrawalRequest | 1 | $800K pending_processing (TOTP verified) |
| TwoFactorConfig | 1 | Sebastián's TOTP secret + backup codes |
| Invoices | 4 | One per tenant with GMV + fee + commission + tramo (0-10M/10-40M/40M+) |
| AdSpend | 168 | 12 ads × 14 days (with impressions, clicks, conversions) |
| AutomationRules | 2 | WhatsApp welcome + ROAS < 0.8 ad pauser |
| Settings | 4 | default_currency, roas_kill_threshold, cpa_target, cod_max_order_value |

### Realistic Colombian data
- **Cities**: 23 cities (Bogotá, Medellín, Cali, Pasto, Bucaramanga, Barranquilla, Cartagena, Cúcuta, Pereira, Manizales, Neiva, Popayán, Florencia, Apartadó, Ibagué, Villavicencio, Santa Marta, Riohacha, Valledupar, Montería, Sincelejo, Tunja, Armenia)
- **Names**: 48 first names × 36 last names → realistic Colombian full names
- **Phones**: +573XX-XXXX-XXX format with real Colombian mobile prefixes (300, 301, 310-323)
- **Addresses**: Calle X # Y-Z, Barrio, City (with 7+ neighborhood variants per major city)
- **Conversation messages**: 5-10 message exchanges covering greeting → product inquiry → price negotiation → address confirmation → payment link → confirmation → close (8 message template categories)

### Funnel match (§15.1)
Original spec: 73.2% pending_confirmation, 8.9% datos_completados, etc.
Actual seed: 144/201 = 71.6% pending_confirmation, 16/201 = 8% datos_completados, 8% intent_cancelacion, 6% oficina, 4% despachado, 2% delivered — **matches the funnel**.

---

## Execution log
1. ✅ `bun run db:push --accept-data-loss` — schema already in sync, generated Prisma Client v6.19.2
2. ✅ `bun x tsx prisma/seed.ts` — Seed v3 complete (note: `prisma db seed` not configured in package.json, used tsx directly)
3. ✅ `bun run lint` — 0 errors, 0 warnings (only pre-existing warning about `no-new` in credentials route)
4. ✅ `npx tsc --noEmit` — 0 errors
5. ✅ HTTP 200 verified for `/vendedor` (368KB), `/vendedor?sellerId=user-sebastian` (223KB trafficker view), `/vendedor?sellerId=user-andrea` (370KB Majestic view)

## Issues encountered & fixed
1. **`db.seoConfig` undefined** → Prisma camelCases `SEOConfig` → `sEOConfig` (SEO treated as all-caps abbreviation). Fixed by using `db.sEOConfig`.
2. **`BehaviorAlert.buyerBehaviorId` FK violation** → Originally tried to create alert first with empty `buyerBehaviorId` then backfill. Fixed by capturing `bb.id` from `buyerBehavior.create` and passing it directly to `behaviorAlert.create`.
3. **`BuyerBehavior` unique (tenantId, phone) violation** → 30 behaviors per tenant with 18 customers caused duplicates. Fixed by: (a) using `upsert` instead of `create`, (b) for i >= customerRecs.length, generating synthetic unique phones (untied to customers, `customerId: null`).
4. **`IMG pijamaBlue` syntax error** (missing dot) → Fixed to `IMG.pijamaBlue` for all product image refs.

## Verification
- `/vendedor` returns HTTP 200 with title "Valentina Restrepo · Saramantha · Vendedor"
- JSON-LD Person schema present (`"@type":"Person"`)
- All 7 required sections present: Conversaciones activas, Ventas recientes, Rendimiento, Incentivo del mes, Abrir mensajería, Ver catálogo, Solicitar retiro
- Trafficker view shows "Comisiones de trafficker" + "Saldo disponible" + "wallet"
- Recharts PerformanceChart renders (14-day GMV area chart with gradient)
- Seed is idempotent (verified by running twice with identical counts)

Stage Summary:
- New `/vendedor` SSR page live with seller profile, 6 KPIs, 14-day performance chart, active conversations, commissions (trafficker or agent view), recent sales table, quick actions, seller switcher
- Seed v3 adds 25 products with Unsplash images, 201 orders matching §15.1 funnel, 82 conversations with 629 realistic Colombian messages, 10 novedades cases with evidence + resolution, 120 buyer behaviors with alerts, 20 guide movements, full trafficker wallet (Sebastián with $1.85M balance, 12 sales, 7 wallet transactions, 2FA, withdrawal request)
- Lint + tsc clean; HTTP 200 verified for 3 seller IDs (admin, trafficker, agent of another tenant)
