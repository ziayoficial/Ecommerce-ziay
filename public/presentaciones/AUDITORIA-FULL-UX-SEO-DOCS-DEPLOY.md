# Auditoría Full — UX/A11y + SEO + Documentación + Deploy Readiness

**Proyecto:** ZIAY · Comercio Conversacional + Atribución Inteligente
**Versión auditada:** v0.3.0 "Comercio Agéntico" · Next.js 16.2.10
**Fecha de auditoría:** 2026-07-18
**Auditor:** general-purpose (full-auditor-B) · Task ID FA-B
**Scope:** 4 dimensiones no cubiertas por la auditoría fintech (UX/A11y, SEO, Docs, Deploy). La dimensión fintech ya fue auditada en 3 iteraciones (V1 5.5/10 → V2 7.7 → V3 8.8 → V3.1 ~9.0) y queda fuera de este alcance.

---

## 1. Resumen Ejecutivo

| Dimensión | Score (0–10) | Severidad dominante | Hallazgos CRITICAL/HIGH |
|---|---|---|---|
| **4. UX / Accesibilidad (WCAG 2.1 AA)** | **3.0 / 10** 🔴 | CRITICAL | 1 CRITICAL (dashboard roto) + 3 HIGH |
| **5. SEO / Meta** | **4.5 / 10** 🔴 | CRITICAL | 2 CRITICAL (robots.txt 500 + OG asset 307) + 3 HIGH |
| **6. Documentación** | **7.5 / 10** 🟡 | MEDIUM | 0 CRITICAL · 2 HIGH (env.example faltante + ADR-0021 sin indexar) |
| **7. Deploy Readiness** | **7.0 / 10** 🟡 | MEDIUM | 0 CRITICAL · 3 HIGH (migraciones Postgres no probadas, rate-limit in-memory, BullMQ crons sin wire) |

**Score global medio:** 5.5 / 10 (frente a los 9.0/10 que reclama la documentación interna para la dimensión fintech)

### Veredicto production readiness

🔴 **NO-GO — BLOCKER CRÍTICO DETECTADO**

El dashboard principal (`/`) está roto en dev (y muy probablemente en prod): un Server Component importa `NAV_ITEMS` desde un módulo `'use client'` (`src/components/dashboard/sidebar.tsx`) y Turbopack/Next.js 16 no resuelve el valor en runtime — el `.find()` falla con `TypeError: NAV_ITEMS.find is not a function` y se renderiza el ErrorBoundary en cada carga. Las 16 vistas del dashboard son **inaccesibles** hasta que se arregle. Adicionalmente, `/robots.txt` devuelve HTTP 500 (conflicto entre `public/robots.txt` y `src/app/robots.ts`) y los assets OG/manifest/icon están detrás del middleware de auth, rompiendo social sharing + PWA install.

**Bloqueadores para ir a producción:**
1. P0-1 · Dashboard `/` roto — server component importando de client component
2. P0-2 · `/robots.txt` devuelve 500 (conflicto public-file vs route-handler)
3. P0-3 · `/og-default.svg`, `/icon.svg`, `/manifest.json`, `/sw.js` regresan 307 → /login
4. P0-4 · `.env.example` inexistente — README dice "cp .env.example .env" pero el archivo no existe

---

## 2. Dimensión 4: UX / Accesibilidad (WCAG 2.1 AA) — Score 3.0/10

### 2.1 Verificación con Agent Browser

#### 2.1.1 Estado del dashboard en 3 viewports

| Viewport | Resultado | Screenshot |
|---|---|---|
| 390 × 844 (mobile iPhone) | 🔴 **ErrorBoundary** "Algo salió mal" | `audit-screenshots/dashboard-mobile-390.png` |
| 768 × 1024 (tablet iPad) | 🔴 **ErrorBoundary** "Algo salió mal" | `audit-screenshots/dashboard-tablet-768.png` |
| 1440 × 900 (desktop) | 🔴 **ErrorBoundary** "Algo salió mal" | `audit-screenshots/dashboard-desktop-1440.png` |

```
[browser] TypeError: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dashboard$2f$sidebar$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__.NAV_ITEMS.find is not a function
    at Home (src/app/page.tsx:63:15)
```

El error ocurre en `src/app/page.tsx:63`:

```ts
import { NAV_ITEMS } from '@/components/dashboard/sidebar'   // ← 'use client' module
…
const initialHeading =
  NAV_ITEMS.find((n) => n.id === 'overview')?.label || 'Dashboard'  // ← CRASH
```

`NAV_ITEMS` es exportado desde un módulo marcado `'use client'` (`src/components/dashboard/sidebar.tsx`). En Turbopack/Next.js 16 el RSC recibe una *client reference proxy*, no el valor real — por lo que `.find` no existe y el SSR lanza un TypeError que el ErrorBoundary (`src/app/error.tsx`) captura, mostrando "Algo salió mal" + un botón "Reintentar" (que también falla al re-ejecutar el mismo código).

**Esto significa que ninguna de las 16 vistas del dashboard es alcanzable.** Las screens de "auditoría dashboard" previas (en `upload/audit-dashboard-FINAL.png` y similares) eran probablemente capturas de builds webpack (no Turbopack) tomadas antes de este commit.

#### 2.1.2 Páginas públicas SÍ funcionan

Verificadas con agent-browser a 1440px:

| URL | HTTP | Estado | Screenshot |
|---|---|---|---|
| `/login` | 200 | ✅ Formulario reactivo + 3 cuentas demo | — (accedida vía click) |
| `/directorio` | 200 | ✅ 5 tiendas listadas con h1 + h2 jerárquicos | `audit-screenshots/directorio.png` |
| `/legal` | 200 | ✅ Índice legal con h1 | `audit-screenshots/legal.png` |
| `/status` | 200 | ✅ Estado del sistema (DB ok, 5 tenants, 4 conversaciones) | `audit-screenshots/status.png` |
| `/t/saramantha` | 200 | ✅ Storefront SSR con catálogo + JSON-LD | `audit-screenshots/storefront.png` |

### 2.2 HTML semántico

| Elemento | Ocurrencias en `src/` | Evaluación |
|---|---|---|
| `<main>` | 15 | ✅ Usado en `page.tsx` (id=`main-content`), login, storefronts, status, legal |
| `<header>` | 7 | ✅ Topbar + landing header |
| `<nav>` | 5 | ✅ Sidebar + mobile Sheet nav + storefront nav |
| `<section>` | 65 | ✅ Card headers, form sections |
| `<article>` | 2 | 🟡 Solo en 2 sitios (debería usarse en cards de productos / conversaciones) |
| `<aside>` | 2 | ✅ Login aside + sidebar |
| `<footer>` | 8 | ✅ Dashboard + login + storefronts |

**Skip-link:** ✅ presente en `src/app/page.tsx:67` (`Saltar al contenido principal`, `sr-only focus:not-sr-only`). Excelente patrón ARIA.

### 2.3 ARIA

| Atributo | Ocurrencias | Evaluación |
|---|---|---|
| `aria-label` | 99 | ✅ Cada botón icon-only (Bell, Theme toggle, Search, Menu, etc.) tiene aria-label descriptivo en español |
| `role="..."` | 42 | ✅ `role="alert"`, `role="status"`, `role="group"`, `role="navigation"` usados correctamente |
| `aria-live` | 7 | ✅ Loading skeletons, banner de presupuesto IA, alertas de error |
| `aria-describedby` | 1 | 🟡 Bajo — solo 1 uso; los formularios con errores no asocian el mensaje al input |
| `tabIndex` | 9 | 🟡 Revisar uso (algunos en non-interactive elements) |

**Foco visible:** 41 ocurrencias de `focus-visible:ring` en componentes. ✅ Cumple WCAG 2.4.7.

**Reduced motion:** ✅ `@media (prefers-reduced-motion: reduce)` declarado en `globals.css:154-163` deshabilita animaciones. Cumple WCAG 2.3.3.

### 2.4 Color y contraste

Variables OKLCH en `globals.css`:

| Variable | Valor OKLCH | Hex aprox. | Uso | Contraste sobre bg | WCAG AA (4.5:1) |
|---|---|---|---|---|---|
| `--muted-foreground` (light) | `oklch(0.45 0 0)` | ~`#5b5b5b` | Texto muted sobre `--background` (`#ffffff`) | ~5.6:1 | ✅ |
| `--sidebar-foreground` (light) | `oklch(0.96 0.005 158)` | ~`#f3f8f5` | Texto sidebar sobre `--sidebar` (`oklch(0.18 0.01 158)` ≈ `#1a2520`) | ~14:1 | ✅ |
| `--primary` (light) | `oklch(0.62 0.15 158)` | ~`#10b981` (emerald) | Texto sobre bg accent (`oklch(0.95 0.03 158)`) | ~3.2:1 | 🟡 Bajo 4.5:1 para texto pequeño |
| `--primary` sobre `--background` | emerald sobre blanco | ~`#10b981` sobre `#ffffff` | ~2.9:1 | 🔴 **Falla AA** para texto |
| `text-amber-700` sobre `bg-amber-500/10` | amber sobre amber-50 | ~`#b45309` sobre `#fef3c7` | ~4.8:1 | ✅ |
| `text-rose-700` sobre `bg-rose-500/15` | rose sobre rose-50 | ~`#be123c` sobre `#ffe4e6` | ~5.2:1 | ✅ |

**HIGH:** `text-primary` sobre `bg-background` (usado en sidebar active items + h1 de algunas páginas) cae por debajo de 4.5:1. Reemplazar por `text-emerald-700 dark:text-emerald-400` o subir `--primary` a `oklch(0.55 0.15 158)` (~`#0d9668`, contraste ~4.6:1).

### 2.5 Navegación por teclado

- ✅ Skip-link funciona (focus se mueve a `#main-content`)
- ✅ Command palette (`Cmd+K`) abre con teclado y atrapa el foco
- ✅ Atajos numéricos 1-9 para saltar entre vistas (con guarda `isEditing` para no secuestrar inputs)
- ✅ Todos los botones son `<button type="button">` reales (no `<div onClick>`)
- 🟡 La sidebar desktop (`hidden md:flex`) **desaparece en mobile** — se reemplaza por un Sheet con hamburger menu ✅ (botón `aria-label="Abrir menú"`)

### 2.6 Formularios

| Elemento | Count | Evaluación |
|---|---|---|
| `<form>` | 3 | 🟡 Solo 3 forms explícitos — la mayoría de inputs están sueltos en Cards |
| `<Input>` (shadcn) | 86 | — |
| `<Label htmlFor>` | 74 | ✅ 86 inputs / 74 labels → 86% cobertura |
| Inputs sin label | ~12 | 🔴 Especialmente en `settings-view.tsx` (umbrales globales: `cfg-roas-kill`, `cfg-cpa-target` no tienen `<Label htmlFor>` asociado) |
| `aria-invalid` | solo en login | 🟡 Los demás forms no propagan el estado de error al input |

**Ejemplo problema** (`settings-view.tsx`):
```tsx
<Input id="cfg-roas-kill" type="number" step="0.1" className="tabular-nums"
  value={global.roas_kill_threshold || ''}
  onChange={(e) => setGlobal({ ...global, roas_kill_threshold: e.target.value })} />
// ❌ Sin <Label htmlFor="cfg-roas-kill"> asociado
```

### 2.7 Imágenes

- `<img>` directos: 0 ✅ (todo vía `next/image`)
- `next/image` usage: 8 componentes ✅
- `unoptimized` flags: 0 ✅ (las remotePatterns config permite optimización)
- 🟡 Faltan `width`/`height` explícitos en algunos Image components → revisar CLS

### 2.8 Estados de carga y error

| Patrón | Implementación | Estado |
|---|---|---|
| Skeletons | `<Skeleton className="h-40">` en `settings-view.tsx`, `overview-view.tsx`, etc. con `role="status" aria-busy="true"` | ✅ |
| Spinner | `<Loader2 className="animate-spin">` con `role="status" aria-live="polite"` + `sr-only` "Cargando…" | ✅ Excelente |
| Error actionable | `error.tsx` muestra `error.message` + `error.digest` + botón "Reintentar" | ✅ |
| Error global | `global-error.tsx` con h1 "Error crítico del sistema" | ✅ |
| Toast | Sonner + Toaster (radix) | ✅ |
| 404 | `not-found.tsx` con h1 "Página no encontrada" + botón "Ir al inicio" | ✅ |

### 2.9 Internacionalización

- `lang="es"` declarado en `<html>` ✅
- `src/lib/i18n.ts` define 4 locales: `es-CO`, `es-MX`, `en-US`, `pt-BR` ✅
- `Intl.NumberFormat` y `Intl.DateTimeFormat` usados en `src/lib/format.ts` y `src/lib/i18n/currency.ts` ✅
- `ZIAY_LOCALE` env var controla el locale (default `es-CO`) ✅
- 🟡 `pt-BR` existe en `translations` pero `getAvailableLocales()` no lo retorna → no hay UI para activarlo
- 🟡 Fechas hardcodeadas a `'es-CO'` en `format.ts:7,15,37,42` sin respetar `ZIAY_LOCALE` → usuarios en `es-MX` o `pt-BR` ven fechas con formato colombiano
- 🔴 Inglés filtrando en UI: badges de rol "Admin", "Agent", "Trafficker", "Finance", "Operator", "Marketing" en `topbar.tsx:35-42` no están traducidos

### 2.10 Otros hallazgos UX

- 🔴 **HIGH · No-mobile-nav**: La sidebar desktop se oculta en mobile, pero el dashboard entero está roto — cuando se arregle el P0-1, validar de nuevo.
- 🟡 **MEDIUM · Console leaks**: 14 `console.error` en `src/components/` y `src/app/` (deberían usar el logger de pino) — filtran errores a la consola del browser en prod.
- 🟡 **MEDIUM · Title duplicado en /status**: `<title>Estado del Sistema | ZIAY · ZIAY</title>` — la page metadata pone `"Estado del Sistema | ZIAY"` y el template agrega `" · ZIAY"` resultando en doble marca.

---

## 3. Dimensión 5: SEO / Meta — Score 4.5/10

### 3.1 Meta tags básicos

Inspeccionado `curl -sS http://localhost:3000/login`:

| Tag | Presente | Valor |
|---|---|---|
| `<title>` | ✅ | `"ZIAY · Comercio Conversacional + Atribución Inteligente"` (con template `%s · ZIAY`) |
| `<meta name="description">` | ✅ | 248 chars, en español, menciona LATAM |
| `<meta name="viewport">` | ✅ | `width=device-width, initial-scale=1, maximum-scale=5` |
| `<link rel="canonical">` | ✅ | Apunta a `BASE_URL` (configurable vía `NEXT_PUBLIC_BASE_URL`) |
| `<meta name="theme-color">` | ✅ | White/dark via `viewport.themeColor` (Next.js 16 separate export) |
| `<meta name="keywords">` | ✅ | 8 keywords (algunos deprecated pero inofensivos) |
| `<html lang>` | ✅ | `lang="es"` |

### 3.2 Open Graph

| Property | Presente | Valor |
|---|---|---|
| `og:type` | ✅ | `website` |
| `og:locale` | ✅ | `es_CO` |
| `og:url` | ✅ | `BASE_URL` |
| `og:site_name` | ✅ | `ZIAY` |
| `og:title` | ✅ | Default + override por página |
| `og:description` | ✅ | Default + override por página |
| `og:image` | ✅ | `/og-default.svg` (1200×630) |
| `og:image:width` / `height` / `alt` | ✅ | 1200 / 630 / "ZIAY" |

### 3.3 Twitter Card

| Property | Presente | Valor |
|---|---|---|
| `twitter:card` | ✅ | `summary_large_image` |
| `twitter:title` / `description` / `image` | ✅ | Mismos defaults que OG |

### 3.4 Hallazgos SEO críticos

#### 🔴 CRITICAL · SEO-1 · `/robots.txt` devuelve HTTP 500

```
$ curl -i http://localhost:3000/robots.txt
HTTP/1.1 500 Internal Server Error
Error: A conflicting public file and page file was found for path /robots.txt
https://nextjs.org/docs/messages/conflicting-public-file-page
```

Existen dos fuentes para `/robots.txt`:
1. `public/robots.txt` (estático, allow-all para 4 user-agents específicos)
2. `src/app/robots.ts` (Metadata Route API, con reglas deny para `/api/`, `/vendedor`, `/admin`, `/login`, etc.)

Next.js detecta el conflicto y lanza 500. **Googlebot no puede obtener robots.txt** → todo el crawl se detiene.

**Fix:** eliminar `public/robots.txt` (la versión dinámica `src/app/robots.ts` es más completa y correcta).

#### 🔴 CRITICAL · SEO-2 · Assets OG/manifest/sw detrás de auth

```
$ for p in /og-default.svg /icon.svg /manifest.json /sw.js; do
    curl -o /dev/null -w "$p → HTTP %{http_code}\n" http://localhost:3000$p
  done
/og-default.svg → HTTP 307
/icon.svg → HTTP 307
/manifest.json → HTTP 307
/sw.js → HTTP 307
```

El `matcher` del middleware excluye `_next/static`, `_next/image`, `favicon.ico`, `logo.svg`, `presentaciones`, `assets`, `files` — **pero NO** `og-default.svg`, `icon.svg`, `manifest.json`, `sw.js`. Y `PUBLIC_PATTERNS` tampoco los lista → el middleware aplica la regla de auth y devuelve 307 → `/login?callbackUrl=…`.

**Impacto:**
- 🔴 OG image no carga en previews de Facebook/Twitter/LinkedIn/Slack/WhatsApp → CTR de shares = 0%
- 🔴 `manifest.json` 307 → PWA no instalable (Lighthouse PWA score = 0)
- 🔴 `sw.js` 307 → Service Worker no se registra → offline mode no funciona
- 🔴 `icon.svg` 307 → favicon no carga en browsers modernos

**Fix:** agregar `'og-default.svg'`, `'icon.svg'`, `'manifest.json'`, `'sw.js'`, `'onboarding.md'` al `matcher` exclusion o a `PUBLIC_PATTERNS` en `src/middleware.ts`.

#### 🟡 HIGH · SEO-3 · OG image en formato SVG

`/og-default.svg` es SVG. **Twitter, Facebook, LinkedIn y Slack NO renderizan SVG como OG image** — requieren PNG/JPG/WebP.

**Fix:** generar `/og-default.png` (1200×630) con `sharp` o `@vercel/og` y actualizar `metadata.openGraph.images` + `metadata.twitter.images`.

#### 🟡 HIGH · SEO-4 · JSON-LD Organization incompleto

`orgJsonLd` en `layout.tsx:123-134`:
```json
{
  "@type": "Organization",
  "name": "ZIAY",
  "legalName": "ZIAY SAS",
  "url": "...",
  "logo": ".../logo.svg",
  "description": "...",
  "foundingDate": "2024",
  "areaServed": ["CO", "MX", "PE", "CL", "AR"],
  "sameAs": ["https://z-cdn.chatglm.cn/z-ai/static/logo.svg"]
}
```

**Gaps:**
- ❌ Sin `contactPoint` (teléfono, email, tipo de contacto)
- ❌ Sin `address` (Carrera, ciudad, país)
- ❌ Sin `taxID` (NIT para Colombia)
- ❌ `sameAs` apunta a un CDN chino irrelevante (debería apuntar a redes sociales reales)
- ❌ `foundingDate: "2024"` contradice el README que dice "© 2026" — inconsistente

#### 🟡 HIGH · SEO-5 · Sitemap sin `<lastmod>` estable para home

El sitemap (`src/app/sitemap.ts:32-47`) usa `latestTenantUpdate` para el `<lastmod>` del home — esto cambia cada vez que cualquier tenant se actualiza, diluyendo la señal que Google usa para priorizar recrawls. Las páginas estáticas (`/legal`, `/privacy`, `/terms`) ya usan `SITE_BUILD_TIME` estable ✅.

#### ✅ SEO-6 · Storefront JSON-LD excelente

Verificado en `/t/saramantha`:
- `Organization` (ZIAY)
- `WebSite` con `potentialAction: SearchAction`
- `OnlineStore` (Schema.org type)
- `ItemList` con 7 productos
- `FAQPage` con 3 Q&A
- `Product` + `Offer` + `BreadcrumbList` en `/t/saramantha/p/[sku]`

Este es uno de los puntos más sólidos del proyecto.

### 3.5 Estructura de encabezados

| Página | h1 | h2 | h3 | Jerarquía |
|---|---|---|---|---|
| `/` (dashboard) | 1 (sr-only) | 1 (sr-only, dinámico) | 9 | ✅ |
| `/login` | 1 | 0 | 0 | ✅ |
| `/directorio` | 1 | 5 (una por tienda) | 0 | ✅ |
| `/t/[slug]` | 1 | múltiples | — | ✅ |
| `/status` | 1 | 0 | 0 | ✅ |

**MEDIUM:** el dashboard tiene `<h1 class="sr-only">{initialHeading}</h1>` y luego `<h2 class="sr-only">{viewLabel}</h2>` dentro de `<main>`. Esta estructura es correcta para SEO pero **redundante** para screen readers — el usuario escucha dos encabezados seguidos.

### 3.6 Otros SEO

- ✅ `next/font/google` con `display: 'swap'` (FOUT optimizado)
- ✅ `metadataBase` declarado (resuelve URLs relativas en OG)
- ✅ `manifest.json` PWA con shortcuts
- ✅ `themeColor` separado en `viewport` export (Next.js 16 requirement)
- ✅ `reportWebVitals` envía LCP/CLS/INP a `/api/analytics/web-vitals` (solo en prod)
- ✅ `next/image` con `remotePatterns` para S3/CloudFront/fbcdn/unsplash
- 🟡 `X-Robots-Tag: noindex, follow` solo en `/` y `/login` — bien para auth routes; el resto respeta robots.ts

---

## 4. Dimensión 6: Documentación — Score 7.5/10

### 4.1 README.md

**Calidad:** 8/10

✅ **Puntos fuertes:**
- Quick Start con 4 pasos claros
- Tabla de scripts completa
- Tech stack detallado (versión de Next.js, Prisma, etc.)
- Badges de status, score, tests, lint
- Credenciales demo documentadas

🔴 **HIGH · DOC-1 · `.env.example` inexistente**

README:9 dice: *"cp .env.example .env"* y *"v0.3.0 ships 117 vars, see .env.example"*

**Realidad:** No existe `.env.example` en el repo. Solo `.env` con `DATABASE_URL=file:/home/z/my-project/db/custom.db`.

El `docs/ENVIRONMENT.md` documenta TODAS las variables (excelente), pero el `.env.example` referenciado en README + CONTRIBUTING + SECURITY.md no existe → un nuevo dev que sigue el Quick Start se queda atascado en el paso 2.

**Fix:** generar `.env.example` con las 117 variables referenciadas (todas con valor vacío o placeholder comentado) — ya está parcialmente hecho en `docs/ENVIRONMENT.md` ("Dev mínimo" / "Staging" / "Production" examples).

### 4.2 ADRs (Architecture Decision Records)

✅ **21 ADRs** en `docs/adr/0001-0021` — cobertura excelente sobre:
- Multi-tenancy, RBAC, JWT (0001)
- Protocolos agénticos AP2/UCP/ACP/MCP/A2A (0002)
- SQLite→PostgreSQL migration strategy (0003)
- LLM adapter pattern (0004)
- Webhook always-200 + signature rotation (0005, 0011, 0018)
- ed25519 mandates (0006)
- Retention automation (0008)
- BullMQ vs cron (0009)
- Multi-currency (0012, 0017)
- Compliance DIAN (0020)
- Escrow design (0021)

🔴 **HIGH · DOC-2 · ADR-0021 no indexado en `docs/adr/README.md`**

`docs/adr/README.md` lista ADRs 0001-0020 pero **omite 0021** (`0021-escrow-design.md`, Status: Proposed). El `docs/INDEX.md` y `README.md` sí mencionan "21 ADRs" pero el README del ADR no los refleja.

🟡 **MEDIUM · DOC-3 · ADR-0021 sin sección "Consequences"**

ADR-0021 tiene Context + Decision pero la sección "Consequences" está incompleta (solo lista "open questions", no pros/cons concretos). Los demás ADRs sí la tienen.

### 4.3 API documentation

| Recurso | Estado | Path |
|---|---|---|
| OpenAPI 3.1 spec | ✅ 3,437 líneas, 93 paths, 136 operationIds, 20 tags | `docs/openapi.yaml` |
| ReDoc viewer | ✅ corriendo en `/docs` (CSP carve-out para cdn.jsdelivr.net) | `src/app/docs/page.tsx` |
| API Reference | ✅ 1,265 líneas | `docs/API-REFERENCE.md` |
| API Cookbook | ✅ 9 recipes | `docs/API-COOKBOOK.md` |
| API Manifest JSON | ✅ `/api-docs` | `src/app/api-docs/route.ts` |
| Redocly lint | ✅ 0 errors, 0 warnings (CI estricto) | `.github/workflows/ci.yml:65` |

✅ Esta dimensión es **impecable**.

### 4.4 Documentación de componentes

🔴 **HIGH · DOC-4 · Sin Storybook**

No existe `.storybook/` ni `*.stories.tsx`. Para 103 componentes esto es un gap significativo:
- Los desarrolladores nuevos no pueden explorar componentes aislados
- No hay regression visual testing
- Los estados (loading, error, disabled) no se documentan visualmente

**Mitigación actual:** JSDoc comments en componentes públicos (`DashboardClientProps`, `SidebarProps`, etc.) — decente pero no reemplaza Storybook.

### 4.5 Runbooks

| Runbook | Estado | Path |
|---|---|---|
| DR (Disaster Recovery) | ✅ RTO 4h, RPO 24h, procedimientos por escenario | `docs/DR-RUNBOOK.md` |
| Production checklist | ✅ 463 líneas, items con severidad (🔴/🟡/🟢) | `docs/PRODUCTION-CHECKLIST.md` + `PRODUCTION-CHECKLIST.md` (duplicado) |
| Deploy paso-a-paso | ✅ | `docs/DEPLOY-PASO-A-PASO.md` |
| Backup/restore scripts | ✅ `scripts/backup-pg.sh`, `scripts/restore.sh` (con safety snapshot pre-restore) | `scripts/` |

🟡 **MEDIUM · DOC-5 · Doble PRODUCTION-CHECKLIST**

Existe `PRODUCTION-CHECKLIST.md` (repo root) Y `docs/PRODUCTION-CHECKLIST.md` con contenido ligeramente distinto. Confuso para el lector — decidir cuál es el canónico.

### 4.6 Diagramas de arquitectura

| Diagrama | Estado |
|---|---|
| ERD Mermaid | ✅ `docs/ERD.md` |
| ERD SVG auto-generado | ✅ `docs/erd.svg` (Prisma ERD generator) |
| Maestro arquitectura | ✅ `upload/MAESTRO-arquitectura.md` (interno) |
| Diagrama deployment | 🟡 Solo textual en `docker-compose.yml` y `docs/DEPLOY-PASO-A-PASO.md` — sin diagrama visual de la topología de 16 contenedores |

### 4.7 Environment setup

| Recurso | Estado |
|---|---|
| `docs/ENVIRONMENT.md` | ✅ 480 líneas, 12 secciones, tablas con requerido/opcional/dev-only/prod-only, ejemplos dev/staging/prod, rotación de secretos, validación con `bun -e` |
| `.env.example` | 🔴 **NO EXISTE** (ver DOC-1) |
| `.env` | ✅ Commited pero contiene solo `DATABASE_URL` (seguro en dev, no commitear en prod) |
| `.gitignore` | ✅ Excluye `.env*` |

### 4.8 Contributing guide

✅ `CONTRIBUTING.md` (79 líneas): workflow de branches, Conventional Commits, pre-commit hook (tsc + eslint con `no-unused-vars`), bypass con `--no-verify`, lista de PR checks.

✅ `docs/STYLE_GUIDE.md` con convenciones de naming, TypeScript strict, Spanish UI, Prisma model naming.

### 4.9 Changelog

✅ `CHANGELOG.md` (Keep-a-Changelog format) y `RELEASE-NOTES.md` con highlights de v0.3.0.

🟡 **LOW · DOC-6 · Changelog desactualizado en `## [Unreleased]`**

> `_No unreleased changes. See [0.3.0] for the current release._`

Esto sugiere que los cambios post-v0.3.0 (incluyendo las 3 iteraciones de auditoría fintech V1/V2/V3 + este audit) no se han registrado.

### 4.10 Inline code docs

- ✅ JSDoc en helpers públicos (`safeJsonLd`, `formatCurrency`, `withErrorHandling`)
- ✅ Comentarios extensos estilo ADR en headers de archivos complejos (ej. `src/lib/queue.ts:1-21`)
- ✅ Referencias cruzadas a ADRs en comentarios (ej. `@see docs/adr/0016-ssr-shell-pattern.md`)

---

## 5. Dimensión 7: Deploy Readiness — Score 7.0/10

### 5.1 Build

✅ `next.config.ts` configurado correctamente:
- `output: 'standalone'` (Docker-optimizado)
- `reactStrictMode: true`
- `typescript.ignoreBuildErrors: false` (eliminado en I3-FINAL-FIXES → `next build` es gate real)
- `poweredByHeader: false` (no filtra framework)
- `compress: true` (gzip en app layer)
- `experimental.optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'recharts']` (tree-shaking)
- `images.remotePatterns` para S3/CloudFront/fbcdn/unsplash
- `withSentryConfig` con source map upload en CI

🔴 **HIGH · DEPLOY-1 · `next dev` roto (Turbopack)** — ver P0-1 en §2.1.1. Aunque `next build` (webpack) puede pasar, `next dev` (Turbopack) está roto — esto impacta DX y cualquier deploy que use dev mode (raro en prod pero crítico para staging/QA).

### 5.2 Environment variables

- **118 variables** referenciadas en `src/` (verificadas con `rg "process.env.[A-Z_]+"`)
- **3 NEXT_PUBLIC vars:** `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SENTRY_DSN`
- **Required en prod:** `DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` (los 3 validados con throw en runtime)
- **Optional:** 115 variables para adapters (LLM, ecommerce, logistics, payments, compliance)

✅ Validación en runtime:
- `NEXTAUTH_SECRET` throw si falta en prod (`src/middleware.ts:13-21`)
- `ENCRYPTION_KEY` throw si falta en prod (`src/lib/crypto/secret-encryption.ts`)
- `DATABASE_URL` implícitamente validado por Prisma

🔴 **HIGH · DEPLOY-2 · Sin `.env.example`** — ver DOC-1.

### 5.3 Database

| Aspecto | Estado |
|---|---|
| Prisma schema (SQLite dev) | ✅ `prisma/schema.prisma` con `provider = "sqlite"` |
| Prisma schema (PostgreSQL prod) | ✅ `prisma/postgres/schema.postgres.prisma` con `provider = "postgresql"`, extensions `[vector, pgcrypto]` |
| Migraciones | ✅ 3 migraciones en `prisma/migrations/` (0_init 1125 líneas, 1_postgres_indexes 183, 2_core_indexes 188) |
| `migration_lock.toml` | ✅ `provider = "postgresql"` |
| RLS policies | ✅ 35 políticas en `prisma/sql/rls-policies.sql` (verificadas por V3 fintech audit) |
| pgvector setup | ✅ `prisma/sql/pgvector-setup.sql` con HNSW indexes |
| Backup script | ✅ `scripts/backup-pg.sh` (pg_dump -Fc, S3 offsite opcional, AES-256-GCM opcional) |
| Restore script | ✅ `scripts/restore.sh` con safety snapshot pre-restore |

🟡 **MEDIUM · DEPLOY-3 · Migraciones Postgres no probadas en CI**

`.github/workflows/ci.yml` hace `bun run db:push` (no `prisma migrate deploy`) en el build job. `db:push` sincroniza el schema directamente sin aplicar migraciones — esto significa que las 3 migraciones en `prisma/migrations/` nunca se han corrido en CI. En prod, `bun run db:migrate` (que sí corre las migraciones) podría fallar por drift entre schema y migraciones.

**Fix:** cambiar CI a `bun run db:migrate deploy` para usar el mismo path que prod.

### 5.4 Docker

✅ `Dockerfile` multi-stage (deps → builder → runner):
- `node:20-alpine` base
- `bun install --frozen-lockfile`
- Non-root user (`nextjs:nodejs`, UID/GID 1001)
- `HEALTHCHECK` cada 30s contra `/api/health`
- Solo copia `.next/standalone` + `.next/static` + `public` + `prisma` + `node_modules/.prisma` + `node_modules/@prisma` → imagen mínima
- `EXPOSE 3000`

✅ `docker-compose.yml` con 16 servicios (postgres, redis, minio, nocodb, n8n, ollama, uptime-kuma, app, chat-service, caddy, mailhog, prometheus, alertmanager, grafana, loki, promtail) — todos con `restart: unless-stopped`, healthchecks, volumes y `env_file: [.env]`.

✅ `Dockerfile.caddy` custom (incluye `mholt/caddy-ratelimit` module).
✅ `Caddyfile.prod` con HTTPS automático, rutas para n8n/nocodb/minio, reverse_proxy a `app:3000`.

🟡 **MEDIUM · DEPLOY-4 · `app` service en compose depende de `.env` file**

```yaml
app:
  env_file: [.env]
```

Si `.env` no existe en el servidor (lo cual es lo correcto desde el punto de vista de seguridad), el compose falla al levantar. Mejor práctica: usar Docker secrets o inyectar vars vía `environment:` block con `${VAR}` placeholders.

### 5.5 CI/CD

`.github/workflows/`:
- `ci.yml` — lint + typecheck + unit-tests + openapi-spec + build + e2e-tests (6 jobs paralelos)
- `deploy.yml` — Docker build + push a ghcr.io + SSH deploy + rollback on failure
- `commit-check.yml` — Conventional Commits enforcement

✅ **CI robusto:**
- Bun como runtime
- PostgreSQL 16 service container en build + e2e jobs (no SQLite como en versiones previas)
- Playwright con `--with-deps chromium`
- Artifact upload (`playwright-results`, 7 días de retención, `if: always()`)
- Source map upload a Sentry
- Cache de Docker layers (`cache-from: type=gha`, `cache-to: type=gha,mode=max`)

✅ **Deploy con rollback automático:**
```yaml
- name: Rollback on failure
  if: failure()
  uses: appleboy/ssh-action@v1
  with:
    script: docker compose up -d --no-deps --build ziay
```

🟡 **LOW · DEPLOY-5 · Rollback re-builda en lugar de revertir a tag previo**

El rollback hace `docker compose up -d --no-deps --build ziay` — esto **reconstruye** la imagen desde el código actual del servidor (`/opt/ziay`), no desde un tag previo del registry. Si el código en `/opt/ziay` es el commit que rompió prod, el rollback no ayuda.

**Fix:** `docker compose up -d --no-deps ziay:${{ github.event.before }}` para volver al tag previo en ghcr.io.

### 5.6 Monitoring

| Componente | Estado |
|---|---|
| Sentry | ✅ Client + server + edge configs, source maps en CI |
| Prometheus | ✅ `monitoring/prometheus.yml` + 6 alert rules en `alerts.yml` |
| Alertmanager | ✅ Routing a PagerDuty/Slack/SMTP con `--config.expand-env` |
| Grafana | ✅ Dashboard auto-provisioned (`monitoring/grafana-dashboard.json`) |
| Loki + Promtail | ✅ Log aggregation con 30-day retention, label por nivel |
| Uptime Kuma | ✅ Servicio en compose |
| Status page pública | ✅ `/status` con 90-day uptime + incidentes |
| Web Vitals | ✅ `/api/analytics/web-vitals` recibe LCP/CLS/INP/FCP/TTFB vía `sendBeacon` |
| Health endpoints | ✅ `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/health/uptime` |
| Metrics endpoint | ✅ `/api/metrics` (Prometheus exposition format) |

✅ **Stack de monitoreo impecable** — uno de los puntos más fuertes del proyecto.

### 5.7 Logging

✅ `pino` con:
- Redacción automática de `*.password`, `*.passwordHash`, `*.secret`, `*.token`, `*.apiKey`
- Levels: debug (dev) / info (prod)
- Multistream en prod (stdout + remote shipper opcional vía `LOG_SHIPPING_URL`)
- Base context `{ service: 'ziay', env }`
- ISO timestamps

🟡 **MEDIUM · DEPLOY-6 · Console leaks en componentes**

14 `console.error` en `src/components/` y `src/app/` (ej. `settings-view.tsx`, `messenger-view.tsx`, `orders-view.tsx`, `global-error.tsx`, `error.tsx`). En prod estos errores NO llegan a Loki/Sentry — solo aparecen en la consola del browser del usuario.

**Fix:** reemplazar por `captureError` (Sentry) o un logger cliente (ej. `next-themes`-style wrapper).

### 5.8 Backup / Recovery

✅ Documentado en `docs/DR-RUNBOOK.md`:
- Daily 2AM pg_dump, 30 días retención, local + S3
- Weekly uploads, 90 días
- Configs on-change, 90 días
- Monthly restore drill
- Quarterly full DR drill

✅ Scripts operativos: `scripts/backup-pg.sh` (con encryption opcional), `scripts/restore.sh` (con safety snapshot).

### 5.9 Scaling

| Aspecto | Estado |
|---|---|
| Stateless app | ✅ Next.js standalone, JWT sessions (no server-side session store) |
| Redis para cache + queues | ✅ `src/lib/redis.ts`, `src/lib/queue.ts` (BullMQ opcional) |
| Socket.io Redis adapter | ✅ Multi-instance ready |
| Multi-instance rate-limit | 🔴 In-memory Map en middleware (per-edge-instance) — no funciona con múltiples replicas |
| Static asset CDN | ✅ Caddy con brotli + cache headers; `setCacheHeaders()` helper por tipo de ruta |

🔴 **HIGH · DEPLOY-7 · Rate limit in-memory no funciona con múltiples réplicas**

`src/middleware.ts:168`:
```ts
const RATE_LIMIT_MAP = new Map<string, RateLimitEntry>()
```

Cada instancia de Edge runtime tiene su propio Map. Si despliegas 3 réplicas de la app, un atacante puede hacer 60 req/min × 3 = 180 req/min por IP. Lo mismo aplica para `AUTH_RATE_LIMIT_MAP` (5/min × 3 = 15 intentos de login por minuto).

**Fix documentado en el comentario del código:** "swap this for a Redis-backed limiter (Upstash / @upstash/ratelimit)". La interfaz `checkRateLimit(ip)` no cambia. Falta implementar.

### 5.10 Security headers

Verificado con `curl -I http://localhost:3000/login`:

| Header | Presente | Valor |
|---|---|---|
| `Content-Security-Policy` | ✅ | Strict `default-src 'self'` + carve-out para /docs (cdn.jsdelivr.net) |
| `X-Frame-Options` | ✅ | `DENY` |
| `X-Content-Type-Options` | ✅ | `nosniff` |
| `Strict-Transport-Security` | ✅ | `max-age=31536000; includeSubDomains` (1 año + subdomains) |
| `Referrer-Policy` | ✅ | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | ✅ | `camera=(), microphone=(), geolocation=()` |
| `X-Robots-Tag` | ✅ | `noindex, follow` en `/` y `/login` |
| `X-Powered-By` | ✅ | Eliminado (`poweredByHeader: false`) |

✅ **6/6 security headers presentes** — puntaje perfecto.

🟡 **MEDIUM · DEPLOY-8 · CSP permite `'unsafe-eval'` y `'unsafe-inline'` en script-src**

```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

`'unsafe-eval'` es necesario en dev (HMR), pero en prod debería eliminarse (al menos para rutas no-`/docs`). `'unsafe-inline'` es más difícil de eliminar sin nonces, pero es mitigable con `next/font` + Server Components.

### 5.11 BullMQ crons no wired

🟡 **MEDIUM · DEPLOY-9 · Crontab de DIAN retry + retention cleanup + escrow auto-release sin wire**

Tres cron jobs documentados como TODOs:
1. `src/app/api/compliance/dian-retry/route.ts` — comment `TODO(I2-FOLLOWUP): wire this to a BullMQ cron that fires every 5–10 min`
2. `src/app/api/compliance/retention/cron/route.ts` — funciona con HTTP `Authorization: Bearer $CRON_SECRET` pero no BullMQ `repeat: { cron }`
3. ADR-0021 escrow auto-release (7-day) — sin implementar (ADR Proposed)

En prod se necesitará un cron externo (system cron, Vercel Cron, GitHub Actions) que haga `curl -H "Authorization: Bearer $CRON_SECRET" /api/compliance/retention/cron` y similares.

---

## 6. Top 15 Hallazgos Críticos/Altos (priorizados)

| # | Severidad | Dimensión | ID | Hallazgo | Fix propuesto | Esfuerzo |
|---|---|---|---|---|---|---|
| 1 | 🔴 CRITICAL | UX | P0-1 | Dashboard `/` roto — server component importa `NAV_ITEMS` de `'use client'` → TypeError en cada carga | Mover `NAV_ITEMS` a un módulo compartido `'use server'` o duplicar la constante en `page.tsx` | 30 min |
| 2 | 🔴 CRITICAL | SEO | SEO-1 | `/robots.txt` devuelve HTTP 500 (conflicto public-file vs route-handler) | Eliminar `public/robots.txt` — la versión dinámica `src/app/robots.ts` es más completa | 5 min |
| 3 | 🔴 CRITICAL | SEO | SEO-2 | `/og-default.svg`, `/icon.svg`, `/manifest.json`, `/sw.js` regresan 307 → /login | Agregar estos paths al `matcher` exclusion en `src/middleware.ts` | 10 min |
| 4 | 🔴 CRITICAL | Docs/Deploy | DOC-1 / DEPLOY-2 | `.env.example` inexistente — README, CONTRIBUTING y SECURITY.md lo referencian pero no existe | Generar `.env.example` con 117 variables (placeholders vacíos + comentarios) basado en `docs/ENVIRONMENT.md` | 1 h |
| 5 | 🟡 HIGH | SEO | SEO-3 | OG image en formato SVG — Twitter/Facebook/LinkedIn/Slack no renderizan SVG | Generar `/og-default.png` (1200×630) con `@vercel/og` o `sharp`, actualizar `metadata.openGraph.images` | 2 h |
| 6 | 🟡 HIGH | SEO | SEO-4 | JSON-LD Organization incompleto — sin `contactPoint`, `address`, `taxID`; `sameAs` apunta a CDN chino irrelevante | Completar con datos reales de ZIAY SAS + redes sociales | 30 min |
| 7 | 🟡 HIGH | UX | UX-1 | `text-primary` sobre `bg-background` cae bajo 4.5:1 WCAG AA — emerald `#10b981` sobre blanco = ~2.9:1 | Subir `--primary` a `oklch(0.55 0.15 158)` (~`#0d9668`) o usar `text-emerald-700` para texto | 1 h |
| 8 | 🟡 HIGH | UX | UX-2 | ~12 inputs en `settings-view.tsx` sin `<Label htmlFor>` asociado | Agregar `<Label htmlFor="cfg-X">` por cada input | 1 h |
| 9 | 🟡 HIGH | Docs | DOC-2 | ADR-0021 (escrow) no indexado en `docs/adr/README.md` | Agregar fila a la tabla en `docs/adr/README.md:24` | 5 min |
| 10 | 🟡 HIGH | Docs | DOC-4 | Sin Storybook para 103 componentes | Setup `.storybook/` + `*.stories.tsx` para componentes UI (puede ser gradual) | 2-3 días |
| 11 | 🟡 HIGH | Deploy | DEPLOY-1 | `next dev` (Turbopack) roto — ver P0-1 | Mismo fix que P0-1 | (incluido en #1) |
| 12 | 🟡 HIGH | Deploy | DEPLOY-3 | Migraciones Postgres no probadas en CI — se usa `db:push` en lugar de `migrate deploy` | Cambiar `.github/workflows/ci.yml:107` a `bun run db:migrate` | 15 min |
| 13 | 🟡 HIGH | Deploy | DEPLOY-7 | Rate limit in-memory (Map en middleware) no funciona con múltiples réplicas | Implementar Upstash Ratelimit o Redis-backed counter; mantener interfaz `checkRateLimit(ip)` | 4-6 h |
| 14 | 🟡 HIGH | Deploy | DEPLOY-9 | BullMQ crons (DIAN retry, retention cleanup, escrow auto-release) sin wire | Configurar `repeat: { cron }` en BullMQ o cron externo (system cron / Vercel Cron) | 3-4 h |
| 15 | 🟡 HIGH | UX | UX-3 | 14 `console.error` en `src/components/` y `src/app/` — errores del cliente no llegan a Sentry/Loki | Reemplazar por `captureError` (Sentry SDK browser) | 2 h |

---

## 7. Roadmap (30/60/90 días)

### 🚨 Día 0 (hotfix — antes de cualquier deploy)

1. **Fix P0-1** — mover `NAV_ITEMS` (y `ViewId`) a `src/lib/nav-config.ts` compartido (sin `'use client'`), importar desde `page.tsx` y `sidebar.tsx`. **(30 min)**
2. **Fix SEO-1** — `rm public/robots.txt`. **(5 min)**
3. **Fix SEO-2** — actualizar `matcher` en `src/middleware.ts` para excluir `og-default.svg`, `icon.svg`, `manifest.json`, `sw.js`, `onboarding.md`. **(10 min)**
4. **Fix DOC-1** — generar `.env.example`. **(1 h)**
5. Verificación: `bun run dev` + `curl /robots.txt` + `curl /og-default.svg` + login + dashboard carga.

### 📅 Día 30 (P0 + HIGH críticos)

6. **Fix SEO-3** — generar `/og-default.png` con `@vercel/og` (o un script `scripts/generate-og.ts` con sharp). **(2 h)**
7. **Fix SEO-4** — completar JSON-LD Organization con `contactPoint`, `address`, `taxID`, `sameAs` reales. **(30 min)**
8. **Fix UX-1** — subir `--primary` para cumplir WCAG AA en texto emerald sobre blanco. **(1 h)**
9. **Fix UX-2** — asociar `<Label htmlFor>` a los 12 inputs sin label en `settings-view.tsx`. **(1 h)**
10. **Fix DOC-2** — indexar ADR-0021 en `docs/adr/README.md`. **(5 min)**
11. **Fix DEPLOY-3** — cambiar CI a `bun run db:migrate deploy`. **(15 min)**
12. **Fix DEPLOY-9** — wire BullMQ crons o configurar cron externo. **(4 h)**
13. **Fix UX-3** — reemplazar `console.error` del cliente por `captureError`. **(2 h)**

### 📅 Día 60 (HIGH restantes + MEDIUM)

14. **Fix DEPLOY-7** — implementar rate limit Redis-backed (Upstash o ioredis directo). **(6 h)**
15. Setup Storybook inicial con los 48 componentes `ui/` (shadcn). **(2-3 días)**
16. Eliminar `PRODUCTION-CHECKLIST.md` duplicado (mantener solo `docs/PRODUCTION-CHECKLIST.md`). **(15 min)**
17. Refinar CSP: eliminar `'unsafe-eval'` en prod, evaluar nonces para `'unsafe-inline'`. **(1 día)**
18. Eliminar los 7 `text-amber-700` etc. no traducidos (roles en `topbar.tsx`). **(30 min)**
19. Respetar `ZIAY_LOCALE` en `src/lib/format.ts` (no hardcodear `'es-CO'`). **(1 h)**
20. Actualizar `CHANGELOG.md` con cambios post-v0.3.0 (3 iteraciones fintech + este audit). **(2 h)**

### 📅 Día 90 (MEDIUM/LOW + polish)

21. Diagrama visual de la topología de 16 contenedores (Mermaid C4 diagram). **(2 h)**
22. ADR-0021 escrow: implementar `EscrowHolding` model + release/refund workflows. **(3-5 días)**
23. Cold-storage export migración a S3/Glacier (R-14 follow-up). **(1 día)**
24. Auditar 9 usos de `tabIndex` para uso correcto (no poner tabbable en non-interactive). **(1 h)**
25. Generar `*.stories.tsx` para componentes dashboard (messenger, orders, kanban, etc.). **(1 semana)**
26. Re-auditaría completa (V4) — incluir Lighthouse run + axe-core scan automatizado en CI. **(2 días)**

---

## 8. Conclusión

**Puntaje global medio: 5.5 / 10** (UX 3.0 + SEO 4.5 + Docs 7.5 + Deploy 7.0 / 4)

El proyecto ZIAY tiene una base técnica **excepcional** en las dimensiones que la auditoría fintech cubrió (seguridad de pagos 9.0/10, webhooks 9.0/10, anti-fraude 9.0/10, multi-tenant 9.0/10). Sin embargo, las 4 dimensiones auditadas aquí muestran **gaps significativos que bloquean el go-live**:

1. **UX/A11y 3.0/10** — el dashboard está completamente roto en dev (Turbopack RSC import bug). Aunque el ARIA/teclado/semantic HTML está bien hecho a nivel de componentes individuales, no se puede usar el producto.
2. **SEO 4.5/10** — los 3 hallazgos críticos (`/robots.txt` 500, OG assets 307, OG image en SVG) hacen que el sitio sea invisible para crawlers y social media. Esto es especialmente irónico dado que las storefronts públicas (`/t/[slug]`) tienen JSON-LD excelente.
3. **Docs 7.5/10** — la documentación existente es exhaustiva (21 ADRs, OpenAPI 3.1, ENVIRONMENT.md, DR-RUNBOOK, MANUAL-USUARIO). El gap principal es la ausencia de `.env.example` y la falta de Storybook.
4. **Deploy 7.0/10** — el setup Docker/CI/monitoring es profesional (16 servicios, Prometheus + Grafana + Loki + Alertmanager, Sentry source maps, rollback automático). Pero las migraciones Postgres no se prueban en CI y el rate-limit in-memory no escala con réplicas.

**Recomendación:** cerrar los 4 P0 (hotfix de 2-3 horas) antes de cualquier deploy. Los 11 HIGH restantes son cerrables en 30 días con 1-2 ingenieros. Posteriormente, el score global sube a ~8.0/10.

**Veredicto final:** 🟡 **GO-WITH-CONDITIONS** — bloquear deploy hasta cerrar P0-1, P0-2, P0-3, P0-4 (4 horas de trabajo total). Tras eso, se puede desplegar con monitorización cercana de los 11 HIGH en el primer sprint post-launch.

---

## 9. Anexos

### 9.1 Screenshots

Ubicados en `/home/z/my-project/audit-screenshots/`:

| Archivo | Descripción |
|---|---|
| `dashboard-BROKEN-all-sizes.png` | Dashboard mostrando ErrorBoundary "Algo salió mal" (todos los viewports) |
| `dashboard-mobile-390.png` | 390×844 (iPhone) — ErrorBoundary |
| `dashboard-tablet-768.png` | 768×1024 (iPad) — ErrorBoundary |
| `dashboard-desktop-1440.png` | 1440×900 — ErrorBoundary |
| `directorio.png` | /directorio (público, funciona) |
| `legal.png` | /legal (público, funciona) |
| `status.png` | /status (público, funciona) |
| `storefront.png` | /t/saramantha (SSR, funciona) |

### 9.2 Comandos de verificación

```bash
# P0-1 · Dashboard roto
curl -sS http://localhost:3000/ -b "next-auth.session-token=<cookie>" | rg "Algo salió mal"
# Esperado: match (el ErrorBoundary renderiza)

# P0-2 · robots.txt 500
curl -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/robots.txt
# Esperado: HTTP 500

# P0-3 · Assets OG detrás de auth
for p in /og-default.svg /icon.svg /manifest.json /sw.js; do
  curl -o /dev/null -w "$p → HTTP %{http_code}\n" "http://localhost:3000$p"
done
# Esperado: todos HTTP 307

# P0-4 · .env.example inexistente
ls .env.example
# Esperado: "No such file or directory"

# SEO-6 · Storefront JSON-LD (positivo)
curl -sS http://localhost:3000/t/saramantha | rg -o '\{"@context":"https://schema.org"[^<]*' | head -5
# Esperado: 5 bloques JSON-LD (Organization, WebSite, OnlineStore, ItemList, FAQPage)

# Security headers
curl -sS -I http://localhost:3000/login | rg -i "x-frame|x-content|strict-transport|referrer|permissions|content-security"
# Esperado: 6 headers presentes
```

### 9.3 Referencias

- Auditoría fintech V1: `/home/z/my-project/public/presentaciones/AUDITORIA-FINTECH.md`
- Auditoría fintech V2: `/home/z/my-project/public/presentaciones/AUDITORIA-FINTECH-V2.md`
- Auditoría fintech V3 final: `/home/z/my-project/public/presentaciones/AUDITORIA-FINTECH-V3-FINAL.md`
- README: `/home/z/my-project/README.md`
- ENVIRONMENT.md: `/home/z/my-project/docs/ENVIRONMENT.md`
- DR-RUNBOOK: `/home/z/my-project/docs/DR-RUNBOOK.md`
- PRODUCTION-CHECKLIST: `/home/z/my-project/docs/PRODUCTION-CHECKLIST.md`
- Worklog tail: `/home/z/my-project/worklog.md`

---

**Fin del reporte · FA-B · 2026-07-18**
