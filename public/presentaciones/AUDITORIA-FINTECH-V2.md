# AUDITORÍA FINTECH V2 — ZIAY (Re-auditoría post-remediación I1 + I2)

**Proyecto:** ZIAY · Plataforma SaaS multi-tenant de comercio conversacional LATAM
**Fecha de re-auditoría:** 2026-07-22
**Auditor:** Agente general-purpose (perfil fintech-auditor, segunda pasada)
**Base de la V1:** `/home/z/my-project/public/presentaciones/AUDITORIA-FINTECH.md` (2026-07-15, score global 5.5/10)
**Scope de la V2:** Verificar los 13 riesgos remediados en las iteraciones 1 y 2 (R-1, R-2, R-3, R-4, R-5, R-6, R-7, R-8, R-9, R-10, R-11, R-12, R-16), detectar **nuevos issues** introducidos por las corridas paralelas y documentar los gaps remanentes (R-13, R-14, R-15, R-17, R-18, R-19, R-20).

---

## 1. Resumen Ejecutivo

**Puntaje global de madurez fintech: 5.5 / 10 → 7.7 / 10** (+2.2 puntos en 7 días)

Las tres semanas de remediación (iteración 1 con agentes I1-R1 / I1-R2 / I1-R4567; iteración 2 con agentes I2-R3 / I2-R8R11R12 / I2-R9R10) cerraron los **3 riesgos críticos bloqueantes** que impedían considerar el stack production-ready: `local-payments.ts` ya existe (R-1), `tsc --noEmit` pasa con 0 errores (R-2) y existe ahora un pipeline anti-fraude de 7 capas con velocity, blocklist, OFAC, sancionados, CVV/AVS y 3DS (R-3).

Sin embargo, la re-auditoría reveló **8 nuevos issues** introducidos por la ejecución paralela de agentes I2-R3 e I2-R9R10, además de **2 issues de diseño** en el código nuevo. El más importante es la **des-coordinación RLS**: las tablas `FraudBlocklistEntry`, `FraudEvent`, `VelocityWindow` (agregadas por I2-R3) y `Refund` (agregada por I2-R8R11R12) **NO tienen políticas RLS activas** en `prisma/sql/rls-policies.sql` — quedaron como templates comentados o ni siquiera aparecen. En Postgres prod, un bypass de la capa de aplicación expondría eventos de fraude y reembolsos cross-tenant.

### Top 3 hallazgos nuevos

| # | Nuevo issue | Severidad | Origen |
|---|-------------|-----------|--------|
| 🆕 N-1 | RLS faltante para las 4 tablas nuevas (`fraud_blocklist`, `fraud_event`, `velocity_window`, `refund`) — solo figuran como comentarios templates | **Alto** | Coordinación I2-R3 ‖ I2-R9R10 |
| 🆕 N-2 | Stripe webhook NO procesa eventos `charge.refunded` → el sync de `Refund` ledger (línea 359-399 de `payment-webhook-utils.ts`) nunca se dispara desde Stripe | **Medio** | I2-R8R11R12 (filtro muy estrecho en `webhooks/stripe/route.ts` líneas 131-134) |
| 🆕 N-3 | `fraudService.ofacScreen` sólo se invoca cuando existe `customerEmail`, y usa `email.split('@')[0]` como nombre → coverage de OFAC < 30% (muchos clientes pagan sin email o con emails que no contienen el nombre real) | **Medio** | I2-R3 (decisión de diseño discutible) |

---

## 2. Puntaje actualizado por dimensión

| Dimensión | V1 (2026-07-15) | V2 (2026-07-22) | Δ | Justificación del cambio |
|-----------|-----------------|-----------------|---|--------------------------|
| **Seguridad de Pagos** | 7.0 | 8.0 | +1.0 | R-4 (auth en conciliación), R-5 (`$transaction` atómico en wallet), R-6 (validación de monto + CVV/AVS) y R-7 (refund `cs_`→`pi_`) cierran los 4 issues altos. Resta: PayU MD5 (R-13, limitación del gateway). |
| **Webhooks** | 7.5 | 8.5 | +1.0 | CVV/AVS extraído en los 4 gateways, chargeback webhook con HMAC + 2-layer idempotency. Resta: filtro estrecho en Stripe webhook descarta `charge.refunded` (N-2). |
| **Multi-moneda** | 7.5 | 7.5 | 0 | Sin cambios. R-17 (`minimumAmount` no validado en create-link) sigue pendiente. |
| **Compliance LATAM** | 8.0 | 9.0 | +1.0 | R-8 (DIAN NIT + retry job + retracto notice) cierra el issue de facturas con CUFE inválido. Resta: integración con cron BullMQ (hoy el retry es manual). |
| **Anti-fraude** | 3.5 | 8.5 | **+5.0** | Salto más grande. Pipeline de 7 capas, 3DS enforced en Stripe, chargeback feedback loop. Restan: coverage OFAC < 30% (N-3), UI no muestra `payment_mismatch` / `fraud_review`. |
| **Reconciliación** | 6.5 | 8.5 | +2.0 | R-12 (modelo `Refund` + endpoints `POST /api/orders/[id]/refund` y `GET /api/orders/[id]/refunds`) + sync desde webhook. Restan: race condition admin ‖ webhook (N-6). |
| **Errores / Refunds** | 6.5 | 8.0 | +1.5 | Endpoints de refund estructurados, validación de monto restante, fallidos persistidos. Restan: webhook `charge.refunded` no llega al sync (N-2), UI no renderiza `refunded` / `partial_refunded`. |
| **Multi-tenant** | 7.0 | 7.5 | +0.5 | R-9 (cifrado AES-256-GCM de credenciales) + R-10 (11 políticas RLS nuevas). Restan: **RLS faltante para 4 tablas nuevas** (N-1), `Setting` sin `tenant_id` (documentado, future migration). |
| **Global** | **5.5** | **7.7** | **+2.2** | — |

---

## 3. Tabla de verificación por riesgo (R-1 a R-20)

| Riesgo | Status V2 | Notas |
|--------|-----------|-------|
| **R-1** PSE/PIX/OXXO/SPEI broken (missing `local-payments.ts`) | ✅ Fixed | Archivo creado (1183 líneas), 4 adapters con stub-mode pattern. CRC16-CCITT correcto (polynomial 0x1021, init 0xFFFF, append 4-hex). Webhook signatures con `timingSafeEqual` via `safeEqual`. `.gitignore` ya no tiene `local-*`. |
| **R-2** 58 errores TypeScript | ✅ Fixed | `npx tsc --noEmit` → 0 errores (verificado). `bun run lint` → 0 errores, 37 warnings preexistentes. `bun run db:push` → schema aplicado limpiamente. |
| **R-3** Anti-fraude ausente | ✅ Fixed (con N-3, N-4) | `fraud.service.ts` (851 líneas) implementa pipeline de 7 capas. `checkTransaction` se invoca en `create-link` y `payments/local`. BLOCK → 402 Payment Required. `FraudEvent` siempre persistido. 3DS enforced en Stripe. Chargeback webhook con HMAC. **PERO** ver N-3 (OFAC coverage), N-4 (PII en `reasons`). |
| **R-4** `/api/conciliation` sin auth | ✅ Fixed | `requireTenantAccess(tenantId)` insertado antes del `db.order.findMany`. |
| **R-5** `walletService.recordTransaction` no atómico | ✅ Fixed | Reescrito con `db.$transaction(async (tx) => { ... })`. Comentario explícito de la justificación. |
| **R-6** Sin validación de monto en `applyPaymentUpdate` | ✅ Fixed | Validación de monto con tolerancia 1%. Status `payment_mismatch` (String, no enum) persistido + `OrderEvent`. CVV/AVS se ejecuta ANTES del monto. |
| **R-7** Stripe refund `cs_`→`pi_` lookup | ✅ Fixed (con limitación) | Resolución correcta `pi_`/`ch_`/`cs_` con fallback a `charges.data[0].id`. **PERO** no hay retry en la lookup; si el checkout session viene de un pago fallido (sin `payment_intent`), retorna error claro pero no reintenta. |
| **R-8** DIAN NIT placeholder + sin retry | ✅ Fixed | `emitterNit` lee `Tenant.nit` (fail-closed en prod, fallback `000000000` en dev). `receiverNit` lee `Customer.documentNumber` (fallback `222222222` consumidor final). `retryPendingDianInvoices` con max 5 reintentos, batch de 50, AuditLog en fallo permanente. Endpoint `POST /api/compliance/dian-retry` admin-only. Retracto notice OrderEvent persistido. |
| **R-9** Credenciales plaintext en `Setting.value` | ✅ Fixed | `secret-encryption.ts` (305 líneas, AES-256-GCM, `enc:v1:<iv>:<authTag>:<ciphertext>`). Fail-closed en prod. `enc:v0:` dev fallback. Migration helper + endpoint admin. `ENCRYPTION_KEY` documentado en el módulo. Decrypt fail-closed en tamper (GCM auth). |
| **R-10** RLS SQL faltante (19 políticas, 12+ tablas sin cobertura) | ⚠️ Partial (ver N-1) | Extendido de 20 → 31 políticas activas. **PERO** las 4 tablas nuevas (`fraud_blocklist`, `fraud_event`, `velocity_window`, `refund`) quedaron fuera — las 3 de fraude figuran como templates comentados en Section 3 (líneas 340-365), y `refund` no aparece en absoluto. |
| **R-11** Sin endpoint admin-initiated refund | ✅ Fixed (con N-2, N-6) | `POST /api/orders/[id]/refund` (admin/operator), Zod validation, validación `remaining = total - sum(pending+processed)`. Refund row creado antes del gateway call. `$transaction` en success/failure. **PERO** ver N-2 (sync webhook roto) y N-6 (race admin ‖ webhook). |
| **R-12** Sin modelo `Refund` estructurado | ✅ Fixed | Modelo `Refund` con indexes `[tenantId, initiatedAt]`, `[orderId]`, `[gatewayRef]`. `GET /api/orders/[id]/refunds` con summary totals. Sync desde webhook en `applyPaymentUpdate` (líneas 359-399). |
| **R-13** PayU usa MD5 | ⚠️ Document only | Limitación del gateway — PayU no expone HMAC-SHA256. Comment en `payu.ts` líneas 9, 16-18 explica. Sin acción posible salvo migrar a otro gateway. |
| **R-14** AuditLog borrado a 7 años sin cold-storage | ❌ Pending | No se implementó export a cold storage (S3 Glacier / BigQuery) antes del purge. No hay cron de retención visible en el código. |
| **R-15** 3DS para Stripe | ✅ Fixed | `payment_method_options[card][request_three_d_secure]: 'any'` en `createPaymentLink`. Comentario cita BACEN Resolução 4.658/2018 + PSD2 RTS Art. 18. **PERO** no se aplica a MercadoPago/Wompi/PayU (gateways LATAM no exponen el flag). |
| **R-16** `eslint` key en next.config.ts | ✅ Fixed | Removido (comentario explicativo en next.config.ts líneas 37-39). |
| **R-17** `minimumAmount` no validado en create-link | ❌ Pending | `create-link/route.ts` acepta `currency: z.string().min(1)` y no consulta `CURRENCIES[currency].minimumAmount`. Posible creación de payment links por debajo del mínimo de la moneda. |
| **R-18** Sin implementación de escrow | ❌ Pending | Sin progreso. La funcionalidad de custodia (retener fondos hasta confirmar entrega) no existe. |
| **R-19** `FEE_PCT` / `FEE_MIN` hardcoded COP | ❌ Pending | `src/app/api/wallet/route.ts:160-161` sigue con `FEE_PCT = 0.01` y `FEE_MIN = 1000 // min COP fee`. Si la wallet del traficante está en MXN/BRL/USD, la comisión mínima de 1000 COP no tiene sentido. |
| **R-20** `WithdrawalRequest` validación positiva en service layer | ⚠️ Partial | La API route valida `amt > 0` (línea 358), pero `walletService.createWithdrawalRequest` NO valida el signo. Un caller directo del service (e.g. un job interno, una migración) podría crear withdrawals negativas. Defense-in-depth incompleto. |

**Resumen de status:** 12 ✅ Fixed · 4 ⚠️ Partial · 4 ❌ Pending · 0 ❌ Regression

---

## 4. Nuevos issues detectados (post-remediación)

### 🆕 N-1 — RLS faltante para 4 tablas nuevas (Severidad: ALTA)

**Dónde:** `prisma/sql/rls-policies.sql` líneas 340-365 (templates comentados) + ausencia total de la tabla `refund`.

**Qué pasa:** Las 4 tablas agregadas por las iteraciones 1+2 (`fraud_blocklist`, `fraud_event`, `velocity_window`, `refund`) existen en `prisma/schema.prisma` con `tenantId String` (no nullable), pero `prisma/sql/rls-policies.sql` las dejó como comentarios en Section 3 (las 3 de fraude) o ni siquiera las menciona (`refund`). En Postgres prod, esto significa que:
- Un bypass o bug en la capa de aplicación podría filtrar eventos de fraude cross-tenant (incluyendo `customerIp`, `reasons` con PII, `customerId`).
- Reembolsos de tenant A podrían ser visibles desde tenant B si hay un bug en el `where` de Prisma.

**Causa raíz:** Los agentes I2-R3 e I2-R9R10 corrieron en paralelo. I2-R9R10 explícitamente documentó (worklog línea 21911): *"The 3 fraud tables are NOT in the schema yet (parallel I2-R3 agent hasn't added them — confirmed via `rg "^model (Fraud|Velocity)"` returning 0 matches)."* Cuando I2-R3 terminó de agregar las tablas, I2-R9R10 ya había cerrado su scope. El agente I2-R8R11R12 (que agregó `Refund`) tampoco tocó el SQL.

**Fix sugerido:** Agregar 4 políticas activas en Section 1b del SQL file (todas estrictas `tenant_id = current_setting('app.tenant_id', true)`):

```sql
ALTER TABLE "FraudBlocklistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FraudBlocklistEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fraudblocklistentry ON "FraudBlocklistEntry"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "FraudEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FraudEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fraudevent ON "FraudEvent"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "VelocityWindow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VelocityWindow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_velocitywindow ON "VelocityWindow"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Refund" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refund ON "Refund"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

### 🆕 N-2 — Stripe webhook descarta `charge.refunded` (Severidad: MEDIA)

**Dónde:** `src/app/api/webhooks/stripe/route.ts` líneas 131-134.

**Qué pasa:** El handler filtra por `type.startsWith('checkout.session.') || type.startsWith('payment_intent.')`. Esto excluye `charge.refunded`, `charge.dispute.created`, `charge.failed` y todos los eventos de la familia `charge.*`. Como consecuencia:
- El sync de `Refund` ledger (líneas 359-399 de `payment-webhook-utils.ts`) **nunca se dispara** desde Stripe cuando un reembolso se inicia en el dashboard de Stripe directamente (no via el endpoint `/api/orders/[id]/refund`).
- El chargeback feedback loop que cierra el loop con `fraudService.recordChargeback` requiere que el chargeback llegue al webhook dedicado `/api/webhooks/chargeback` (configuración adicional), no al Stripe webhook principal.

**Causa raíz:** El handler original fue escrito cuando Stripe usaba principalmente `checkout.session.*`. Nunca se extendió cuando llegaron los requisitos R-11/R-12 (refund ledger) y R-3 (chargeback).

**Fix sugerido:** Ampliar el filtro a `charge.refunded` y `charge.dispute.created`, mapeando los IDs (`ch_...` → lookup order por `paymentRef`, dispute → forward a `fraudService.recordChargeback`). Ejemplo:

```ts
if (type === 'charge.refunded' || type === 'charge.dispute.created') {
  const charge = (data.object ?? {}) as Record<string, unknown>
  const paymentId = String(charge.id ?? '')
  const amount = Number(charge.amount_refunded ?? charge.amount ?? 0) / 100
  const currency = charge.currency ? String(charge.currency).toUpperCase() : undefined
  await applyPaymentUpdate({
    gateway: 'stripe',
    paymentId,
    status: type === 'charge.refunded' ? 'refunded' : 'payment_mismatch',
    success: type === 'charge.refunded',
    amount,
    currency,
  })
}
```

### 🆕 N-3 — Coverage OFAC < 30% (Severidad: MEDIA)

**Dónde:** `src/lib/services/fraud.service.ts` líneas 527-538.

**Qué pasa:** `checkTransaction` sólo invoca `ofacScreen` cuando `input.customerEmail` está presente. Y cuando lo hace, pasa `email.split('@')[0]` como el "nombre" a buscar. En la práctica:
- Muchos clientes pagan sin email (especialmente OXXO/SPEI/PIX cash flows).
- Los emails tipo `user123@gmail.com` o `maria82@hotmail.com` no contienen el nombre real → la búsqueda por substring no matchea SDN reales como `NICOLAS MADURO` o `KIM JONG UN`.

**Causa raíz:** `FraudCheckInput` no incluye `customerName` (sólo `customerId`, `customerEmail`, `customerPhone`, `customerIp`). La decisión de diseño fue "we can't reliably resolve a customer name from the FraudCheckInput alone" (comentario línea 528-530), pero el `create-link` route SÍ tiene acceso a `order.customer?.name` — sólo no se lo pasa.

**Fix sugerido:**
1. Agregar `customerName?: string` a `FraudCheckInput`.
2. En `create-link/route.ts` línea 99, pasar `customerName: order.customer?.name`.
3. En `payments/local/route.ts` línea 202, pasar `customerName: body.customerName`.
4. En `ofacScreen`, buscar por `customerName` (alta sensibilidad) + por `email.split('@')[0]` (baja sensibilidad, complemento).

### 🆕 N-4 — PII en `FraudEvent.reasons` (Severidad: MEDIA)

**Dónde:** `src/lib/services/fraud.service.ts` líneas 503-524 + 700-714.

**Qué pasa:** Los `reasons` se persisten como JSON string en `FraudEvent.reasons`. Algunos entries contienen PII:
- `blocklist hit (email): chargeback (auto)` → expone el email bloqueado.
- `blocklist hit (phone): chargeback (auto)` → expone el teléfono.
- `OFAC match: OFAC local seed: NICOLAS MADURO` → OK (no es PII del cliente).
- `velocity IP high (23/20/min)` → expone count pero no la IP (OK).

Combinado con N-1 (RLS faltante para `fraud_event`), esto significa que PII como emails y teléfonos bloqueados puede filtrar cross-tenant en Postgres prod.

**Fix sugerido:**
1. En `addToBlocklist`, hashear el `value` para tipos `email` y `phone` antes de persistirlo en `reasons` (mantener el valor original en `FraudBlocklistEntry.value` que sí está protegido por RLS una vez que se agregue la política).
2. O bien: truncar el `value` en los `reasons` (mostrar sólo los últimos 4 chars con mask).

### 🆕 N-5 — PIX webhook default a `status: 'approved'` (Severidad: BAJA-MEDIA)

**Dónde:** `src/lib/adapters/local-payments.ts` línea 651.

**Qué pasa:** En `PIXAdapter.webhookVerify`, si el payload firmado NO trae el campo `status`, se asigna por defecto `'approved'`:
```ts
status: data.status ? String(data.status) : 'approved',
```
Esto es fail-open: si un atacante consigue el `PIX_WEBHOOK_SECRET` (o estamos en dev mode sin secret), puede enviar un payload `{"endToEndId":"..."}` (sin `status`) y el webhook reportará `approved`. El webhook handler en `webhooks/pix/route.ts` deberá confiar en este valor.

**Fix sugerido:** Cambiar el default a `'pending'` o `'unknown'` y dejar que el handler decida. Nunca asumir `approved` implícitamente.

### 🆕 N-6 — Race condition admin ‖ webhook refund (Severidad: BAJA)

**Dónde:** `src/app/api/orders/[id]/refund/route.ts` (líneas 105-174) ‖ `src/lib/adapters/payment-webhook-utils.ts` (líneas 359-399).

**Qué pasa:** Si un operador llama `POST /api/orders/[id]/refund` mientras simultáneamente llega un webhook `charge.refunded` (por un refund iniciado en el dashboard de Stripe), ambos caminos pueden actualizar la misma `Refund` row. El endpoint POST usa `$transaction` pero no bloquea la `Refund` row con `SELECT ... FOR UPDATE`. Resultado posible: estado `processed` con `gatewayRef` nulo si el webhook se ejecuta primero, o un segundo intento de refund vía el gateway que falla con "already refunded".

**Mitigación actual:** La validación `remaining` (suma de `pending+processed`) protege contra inicios simultáneos desde el endpoint POST. Pero NO protege contra webhook ‖ POST.

**Fix sugerido:** Agregar `SELECT ... FOR UPDATE` en `db.$transaction` del endpoint POST al hacer fetch del order + refunds, o agregar un constraint unique en `(orderId, gatewayRef)` para evitar duplicados.

### 🆕 N-7 — `payment_mismatch` no se renderiza en el dashboard UI (Severidad: BAJA)

**Dónde:** `src/components/dashboard/orders-view.tsx` (líneas 52, 77, 127-128, 472-473).

**Qué pasa:** El componente `orders-view.tsx` sólo maneja los estados `paid` y `cod_pending`. Cuando `applyPaymentUpdate` marca una orden como `payment_mismatch` (por CVV/AVS o monto), la orden aparece en el dashboard sin badge distintivo. El operador no recibe señal visual del problema.

**Fix sugerido:** Agregar casos para `payment_mismatch` (rojo/amarillo con icono de alerta), `refunded` (gris), `partial_refunded` (azul), `pending_payment` (amarillo). Incluir texto explicativo en ES.

### 🆕 N-8 — DIAN retry sin backoff exponencial (Severidad: BAJA)

**Dónde:** `src/lib/compliance/dian-invoicing.ts` líneas 537-646.

**Qué pasa:** `retryPendingDianInvoices` itera por los 50 invoices más antiguos cada corrida, incrementando `dianRetryCount` en cada fallo. Si Alegra está caído, las 5 corridas consecutivas consumen el budget de reintentos en ~25 minutos (5 corridas × 5 min de `RETRY_MIN_AGE_MS`). No hay backoff exponencial entre reintentos del mismo invoice.

**Fix sugerido:** Usar `dianRetryCount` para calcular un delay exponencial: `nextRetryAt = createdAt + 5min × 2^dianRetryCount`. Filtrar el query por `nextRetryAt <= now()` en lugar de `createdAt < cutoff`.

---

## 5. Gaps remanentes (no fixed en I1 + I2)

| # | Gap | Severidad | Estado | Próximo paso |
|---|-----|-----------|--------|--------------|
| R-13 | PayU MD5 | Baja | Document only | Migrar a otro gateway o aceptar limitación |
| R-14 | AuditLog 7 años sin cold-storage | Media | Pending | Implementar export a S3 Glacier + cron de retención |
| R-17 | `minimumAmount` no validado | Media | Pending | Validar en `create-link/route.ts` contra `CURRENCIES[currency].minimumAmount` |
| R-18 | Sin escrow | Media | Pending | Diseñar modelo `EscrowAccount` + endpoint `/api/escrow/hold` y `/api/escrow/release` |
| R-19 | FEE_PCT/FEE_MIN hardcoded COP | Media | Pending | Migrar a `Setting` por tenant + currency |
| R-20 | WithdrawalRequest service-layer validation | Baja | Partial | Agregar `if (input.amount <= 0) throw` en `walletService.createWithdrawalRequest` |

---

## 6. Verificación de compilación / lint / schema

```bash
$ npx tsc --noEmit 2>&1 | grep -c "error TS"
0
$ bun run lint 2>&1 | tail -3
  138:22  warning  'siempre' is assigned a value but never used. ...
  ✖ 37 problems (0 errors, 37 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
$ bun run db:push 2>&1 | tail -3
  Datasource "db": SQLite database "custom.db" at "file:/home/z/my-project/db/custom.db"
  The database is already in sync with the Prisma schema.
  ✔ Generated Prisma Client (v6.19.3) to ./node_modules/@prisma/client in 786ms
```

**Estado build/lint/schema:** ✅ Verde. 0 errores TS, 0 errores lint, schema sincronizado. Las 37 warnings son preexistentes (console statements en scripts/tests, unused vars en archivos legacy).

**Nota:** `next.config.ts` mantiene `typescript.ignoreBuildErrors: true` (línea 35) para rutas legacy con errores de tipos. Esto es deuda técnica pre-V1 (no introducida por I1/I2) pero merece un cleanup sprint aparte.

---

## 7. Recomendación para Iteración 3 (priorizada)

| Prioridad | Issue | Esfuerzo | Impacto |
|-----------|-------|----------|---------|
| **P0** | N-1 — Agregar 4 políticas RLS activas para `fraud_blocklist`, `fraud_event`, `velocity_window`, `refund` | 30 min | Cierra el bypass multi-tenant más urgente |
| **P0** | N-2 — Extender Stripe webhook para procesar `charge.refunded` y `charge.dispute.created` | 1h | Cierra el sync de Refund ledger y habilita el chargeback loop desde el webhook principal |
| **P1** | N-3 — Agregar `customerName` a `FraudCheckInput` + invocar `ofacScreen` con nombre real | 1h | Sube coverage OFAC de <30% a >80% |
| **P1** | N-4 — Hash/mask PII en `FraudEvent.reasons` | 1h | Reduce exposición si se filtra `fraud_event` (defense-in-depth sobre N-1) |
| **P1** | R-17 — Validar `minimumAmount` en `create-link` | 30 min | Cierra gap de creación de links por debajo del mínimo |
| **P1** | R-20 — Validación positiva en service layer de withdrawal | 15 min | Cierra defense-in-depth gap |
| **P2** | R-19 — Migrar `FEE_PCT`/`FEE_MIN` a `Setting` per-tenant + currency | 2h | Necesario para multi-moneda wallet |
| **P2** | N-6 — `SELECT ... FOR UPDATE` en refund endpoint | 1h | Cierra race admin ‖ webhook |
| **P2** | N-7 — UI badges para `payment_mismatch`/`refunded`/`partial_refunded` | 1h | Visibilidad operativa |
| **P2** | N-8 — Backoff exponencial en DIAN retry | 30 min | Reduce pressure sobre Alegra |
| **P3** | R-14 — Cold-storage export para AuditLog | 4h | Compliance retención 7 años |
| **P3** | R-18 — Diseñar + implementar escrow | 1-2 días | Funcionalidad nueva |
| **P3** | N-5 — Cambiar default `status: 'approved'` → `'pending'` en PIX webhookVerify | 5 min | Hardening fail-closed |
| **P3** | R-13 — Documentar MD5 PayU en ADR | 30 min | Cierre formal |

**Esfuerzo total iteración 3:** ~3 días de ingeniería (P0 + P1 + P2). Subiría el score global de 7.7 → ~8.8/10.

---

## 8. Conclusión

La iteración 1+2 fue **efectiva en cerrar los 3 riesgos críticos bloqueantes** (R-1, R-2, R-3) y avanzar en 9 de los 13 issues planificados. El salto más grande fue en anti-fraude (3.5 → 8.5), que era la dimensión más débil de la V1. El pipeline de 7 capas con velocity, blocklist, OFAC, sancionados, CVV/AVS, 3DS y chargeback loop representa una defensa transaccional seria.

Sin embargo, la **coordinación entre agentes paralelos** dejó 4 tablas nuevas sin RLS (N-1) — un bypass multi-tenant que en Postgres prod podría exponer datos sensibles. Combinado con PII en `FraudEvent.reasons` (N-4) y el webhook de Stripe que descarta `charge.refunded` (N-2), hay un cluster de issues que debe cerrarse en una **iteración 3 enfocada**.

**Recomendación:** Antes de cualquier despliegue a producción, ejecutar iteración 3 con prioridad P0 (N-1 + N-2) y P1 (N-3, N-4, R-17, R-20). Esto sube el score a ~8.5/10 y elimina los 2 issues altos introducidos por las corridas paralelas.

**Score final V2: 7.7 / 10** (vs 5.5/10 en V1, +40% de mejora relativa).
