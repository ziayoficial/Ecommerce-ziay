# Task I2-R9R10 — R-9 (credential encryption) + R-10 (RLS SQL extension)

**Agent:** full-stack-developer (crypto+rls)
**Scope:** Two independent audit findings from `public/presentaciones/AUDITORIA-FINTECH.md`:
- **R-9** (Medium): gateway credentials stored as plaintext JSON in `Setting.value` for `cred::*` keys. Only TOTP secrets were AES-256-GCM encrypted. DB compromise → ALL gateway API keys exposed.
- **R-10** (Medium): RLS SQL covered 19 tables but missed 13 tenant-scoped models (wallet, 2FA, AP2, UCP, identity, consent, decision log, FX, Setting, marketplace, lead referral, fraud).

## Files Changed (5)

| # | Fix | File | Nature |
|---|-----|------|--------|
| R-9 | Shared AES-256-GCM helper | `src/lib/crypto/secret-encryption.ts` | NEW (305 lines) — `encryptSecret`/`decryptSecret` with `enc:v1:`/`enc:v0:` wire format, fail-closed in prod, dev-only `enc:v0:` plaintext fallback |
| R-9 | Encrypt `cred::*` Setting.value at-rest | `src/lib/services/credentials.service.ts` | Encrypt on write (`upsertCredentialRow`/`updateCredentialValue`), decrypt on read (`parseCredValue`), lazy migration via read-time fallthrough. Added `migrateLegacyCredentials(tenantId?)` + `auditCredentialEncryptionState(tenantId?)`. |
| R-9 | Re-export crypto helpers | `src/lib/services/index.ts` | Barrel export of `encryptSecret`/`decryptSecret`/`isEncryptedSecret`/`isLegacyPlaintextSecret`/`ENC_PREFIX_V1`/`ENC_PREFIX_V0` |
| R-9 | Admin migration endpoint | `src/app/api/admin/migrate-credentials/route.ts` | NEW — `POST` (bulk re-encrypt) + `GET` (dry-run audit). `requireRole(['admin'])`. Tenant admins scoped to own tenant; platform admins → global. |
| R-10 | Extend RLS SQL to 13 missing tables | `prisma/sql/rls-policies.sql` | 191 → 386 lines, 20 → 31 active `CREATE POLICY` (11 new). 4 nullable-tenant, 6 strict, 1 dual-tenant. Setting + FxRate documented as no-RLS. 3 fraud-table templates as comments. |

## Key Decisions

1. **Wire format** — `enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>` (AES-256-GCM, 12-byte IV, 16-byte auth tag). The `enc:v1:` prefix lets us distinguish encrypted vs legacy-plaintext at read time and is forward-compatible (e.g. `enc:v2:` for a future KMS-backed scheme). Kept totp.ts's existing `iv:authTag:ciphertext` format private (changing it would break stored TOTP secrets + `totp.test.ts`).

2. **Fail-closed policy** — `encryptSecret` THROWS in production when `ENCRYPTION_KEY` is unset (per R-9 spec). In non-production, logs a loud warning and writes `enc:v0:<plaintext>` (clearly marked as unencrypted so the migration helper re-encrypts it once a key is configured). `decryptSecret` only throws for `enc:v1:` ciphertexts that fail GCM auth (tampering / key mismatch) — legacy plaintext and `enc:v0:` fallthrough silently so the lazy migration can keep reading.

3. **Key derivation** — accepts both 64-char hex (`openssl rand -hex 32`) and 32+ char UTF-8 passphrases (matches totp.ts behaviour so a key configured for TOTP also works here without a redeploy). Hex form preferred.

4. **Lazy + admin migration** — two complementary paths converge on `enc:v1:`:
   - **Lazy**: `parseCredValue` decrypts any format transparently (legacy plaintext → returns as-is; `enc:v0:` → strips prefix; `enc:v1:` → GCM decrypt). Next write re-encrypts to `enc:v1:`.
   - **Admin**: `POST /api/admin/migrate-credentials` does a one-shot bulk re-encryption. Per-row failures are captured into `summary.errors` (don't throw — so one bad row doesn't block the rest). Scan failures throw (operator needs to know).

5. **RLS wire convention** — kept the existing `current_setting('app.tenant_id', true)` pattern (NOT the `app_current_tenant_id()` pseudocode from the task spec — the existing convention is the source of truth, 20 existing policies use it).

6. **Nullable-tenant tables** — `WalletAccount`, `WalletTransaction`, `WithdrawalRequest`, `TwoFactorConfig` all have `tenantId String?` (wallet/2FA rows can be trafficker-owned with no tenant). Used the AuditLog pattern `tenant_id = X OR tenant_id IS NULL` so platform-level rows stay visible.

7. **LeadReferral dual-tenant** — has `fromTenantId` + `toTenantId` (no plain `tenantId`). A referral is visible to BOTH the sharing tenant AND the receiving tenant. Policy: `USING (from_tenant_id = X OR to_tenant_id = X) WITH CHECK (from_tenant_id = X OR to_tenant_id = X)` so either side can read or update the status (e.g. mark as converted).

8. **Setting + FxRate — no RLS, documented** — Setting has no `tenant_id` column but stores BOTH tenant-scoped (`cred::{tenantId}::`) AND global key/value pairs. Tenant isolation is enforced at the APPLICATION LAYER via the key namespace convention (the credential service's `listForNamespace(ns)` always filters by the full key prefix, so a tenant can't read another tenant's `cred::*` row by guessing the key). R-9 further hardens this by encrypting the values at rest. FxRate is a global lookup (one row per ISO 4217 currency — market data, not tenant-scoped). Documented in Section 2 of the SQL file with a future-migration note (add a nullable `tenant_id` column to Setting + a generated column / trigger to extract the tenant from the key).

9. **Fraud tables — not yet in schema** — `FraudBlocklistEntry`, `FraudEvent`, `VelocityWindow` don't exist in `prisma/schema.prisma` (parallel I2-R3 agent hasn't added them — confirmed via `rg "^model (Fraud|Velocity)"` returning 0 matches). Included commented-out template policies in Section 3 of the SQL file so the parallel agent has a copy-paste starting point. Noted that FraudBlocklistEntry may be GLOBAL (shared blocklist) — if so, omit its policy and document in Section 2 instead.

## Verification

- `npx tsc --noEmit`: **0 errors** (exit 0, no `error TS` lines)
- `bun run lint`: **0 errors, 37 pre-existing warnings** (none in any of the 5 changed files — verified via `grep -E "credentials\.service|secret-encryption|migrate-credentials|rls-policies"` returning no matches in the lint output)
- `grep -c "^CREATE POLICY" prisma/sql/rls-policies.sql`: **31 active policies** (20 existing + 11 new). Plus 3 commented-out future fraud templates = 34 total `CREATE POLICY` references. Task spec said "~32+" — within range. The 2-table gap (Setting, FxRate → no tenantId → no policy) + 3-table gap (fraud tables not yet in schema) account for the difference vs the audit's 13-table list.
- Dev server stayed healthy throughout (verified `dev.log` — only normal 200 responses on `/login`, no compile errors).

## Encryption Scheme Summary

```
encryptSecret(plaintext: string): string
  - ENCRYPTION_KEY set            → "enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
                                    (AES-256-GCM, 12-byte IV, 16-byte auth tag)
  - production + no key           → THROW (fail-closed)
  - non-production + no key       → log warn + "enc:v0:<plaintext>"
                                    (clearly marked unencrypted, re-encrypted by migration)

decryptSecret(value: string): string
  - "enc:v1:..."                  → AES-256-GCM decrypt (THROW on GCM auth failure / tamper)
  - "enc:v0:..."                  → strip prefix, return plaintext (no key needed)
  - legacy plaintext              → return as-is (no key needed, lazy migration reads it)
```

Key derivation: `ENCRYPTION_KEY` env var → 64-char hex (preferred, `openssl rand -hex 32`) OR 32+ char UTF-8 passphrase (matches totp.ts).

## RLS Policy Summary

| Section | Tables | Pattern | Count |
|---------|--------|---------|-------|
| 1 (existing strict) | User, Channel, Customer, Conversation, Message, Product, Order, VolumePrice, SalesSpeech, Objection, ThemeDesign, CategoryCombo, DeliveryHistory, ImageIdentification, Campaign, Carrier, Shipment, CommissionEntry, Invoice | `tenant_id = current_setting('app.tenant_id', true)` | 19 |
| 1a (existing + R-10 nullable) | AuditLog (existing) + WalletAccount, WalletTransaction, WithdrawalRequest, TwoFactorConfig (new) | `tenant_id = X OR tenant_id IS NULL` | 5 (1 existing + 4 new) |
| 1b (R-10 strict) | AP2Mandate, UcpCheckoutSession, IdentityVerification, ConsentRecord, DecisionLog, MarketplaceListing | `tenant_id = current_setting('app.tenant_id', true)` | 6 new |
| 1c (R-10 dual-tenant) | LeadReferral | `from_tenant_id = X OR to_tenant_id = X` | 1 new |
| 2 (no RLS — documented) | Tenant, AdPlatform, AutomationRule, OrderItem, OrderEvent, Attribution, AdSpend, Ad, FxRate, Setting, StatusIncident, StatusCheck | n/a (global or via parent RLS) | 0 policies |
| 3 (future — commented) | FraudBlocklistEntry, FraudEvent, VelocityWindow | (template only — tables don't exist yet) | 0 active |
| **TOTAL ACTIVE POLICIES** | | | **31** |
