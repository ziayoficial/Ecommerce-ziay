# PRES-1 · Presentations Responsive Pass

**Task ID:** PRES-1
**Agent:** full-stack-developer (presentations-responsive)
**Date:** 2026-07-19
**Status:** ✅ Complete

## What was done

Made **all 14 non-responsive HTML presentations** in
`/home/z/my-project/public/presentaciones/` fully responsive
(iPhone 390×844 + Android 412×915 + web 1440×900), fixing overlaps and
horizontal overflow. `BUSINESS-CANVAS-AGIL.html` was already responsive from
a prior session and was left untouched.

## Approach

Built an idempotent transformer (`scripts/pres-responsive.py`) that:

1. **Detects already-processed files** via `data-pres-responsive="1"` marker
   on the injected `<style>` block — safe to re-run.
2. **Updates the viewport meta** to
   `width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5.0`
   and injects `<meta name="theme-color" content="#047857">`.
3. **Classifies each file into one of 4 CSS patterns** and injects a
   pattern-specific `<style id="pres-responsive">` block right before
   `</head>`.
4. **Injects touch-swipe JS** (only if the file lacks any existing
   `touchstart` handler and has slide elements).

### Why override-only (no destructive edits)

The existing desktop CSS is left **untouched**. All mobile rules activate via
`@media (max-width: 900px)` and a tablet breakpoint
`@media (min-width: 641px) and (max-width: 900px)`. This means:
- Desktop layout at 1440×900 is **exactly** what it was before.
- Mobile gets a fully redesigned layout that fits the viewport.
- Zero risk of breaking the existing desktop experience.

## 4 CSS patterns

| Pattern | Files | Original issue |
|---|---|---|
| **A · Scaler** (1280×720 fixed, `transform:scale`) | BUSINESS-CANVAS, ELEVATOR-SPEECH, PRESENTACION-CUSTOMER-JOURNEYS, PRESENTACION-E2E-TESTS, PRESENTACION-EQUIPO-DESARROLLO-V2, PRESENTACION-INVERSIONISTAS, PRESENTACION-NO-TECNICOS-V2 | On mobile, the scaler shrunk the entire stage to ~30% of viewport, making text unreadable. `.foot` was `position:absolute` and overlapped content. `.ghost` watermark was 360px and caused horizontal overflow. |
| **B · Fluid deck** (`.deck` 100vw × 100vh; `.slide` absolute) | PRESENTACION-CLIENTES-COMPLETA, PRESENTACION-NO-TECNICOS, PRESENTACION-STACK-COMPLETO | Used `100vh` (not `100dvh`), fixed `50px 70px 120px` padding caused cramping on phones, some grids didn't collapse to 1 col. |
| **C · Vertical scrolling** (`.slide min-height:100vh`) | MANUAL-USUARIO, PRESENTACION-DIFERENCIADORES | Fixed font sizes, `.back-to-top` didn't respect safe-area, tables overflowed horizontally. |
| **D · Static doc / nav** | GUIA-ONBOARDING-CLIENTES, index.html | Fixed font sizes, no safe-area-inset. |

## Responsive CSS injected (summary)

- **Safe area:** `--safe-top/bottom/left/right: env(safe-area-inset-*, 0px)`
- **Deck height:** `100vh; 100dvh;` (dynamic viewport — fixes iOS URL bar jump)
- **Slide padding:** `calc(clamp(...) + var(--safe-...))` so content doesn't
  hide under iPhone notch or home indicator
- **Slide overflow:** `overflow-y:auto; -webkit-overflow-scrolling:touch;`
- **Fluid typography:** `clamp(min, vw, max)` for h1/h2/h3/p/hero-title/
  hero-sub/big-quote/stat/stat-card/kpi-pill/badge/eyebrow/lede
- **Grids:** `1fr` on phone, `1fr 1fr` on tablet (641–900px), original
  multi-col on desktop (>900px)
- **Nav buttons:** 44×44px minimum, `border-radius:50%`, fixed to bottom
  with `calc(12px + var(--safe-bottom))`
- **Tables:** `display:block; overflow-x:auto; white-space:nowrap;` on mobile
- **`.foot`** (Pattern A): switched from `position:absolute` to
  `position:relative` on mobile — was overlapping scrollable content
- **`.ghost`** (Pattern A): `display:none` on mobile — was causing horizontal
  overflow
- **Print:** `@media print` rule for all patterns
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` honored

## Files updated (14)

```
public/presentaciones/BUSINESS-CANVAS.html
public/presentaciones/ELEVATOR-SPEECH.html
public/presentaciones/PRESENTACION-CUSTOMER-JOURNEYS.html
public/presentaciones/PRESENTACION-E2E-TESTS.html
public/presentaciones/PRESENTACION-EQUIPO-DESARROLLO-V2.html
public/presentaciones/PRESENTACION-INVERSIONISTAS.html
public/presentaciones/PRESENTACION-NO-TECNICOS-V2.html
public/presentaciones/PRESENTACION-CLIENTES-COMPLETA.html
public/presentaciones/PRESENTACION-NO-TECNICOS.html
public/presentaciones/PRESENTACION-STACK-COMPLETO.html
public/presentaciones/MANUAL-USUARIO.html
public/presentaciones/PRESENTACION-DIFERENCIADORES.html
public/presentaciones/GUIA-ONBOARDING-CLIENTES.html
public/presentaciones/index.html
```

## Verification (Agent Browser + VLM)

Used `agent-browser` to capture 20 screenshots across 3 viewports:

| Viewport | Screenshots |
|---|---|
| iPhone 14 (390×844) | 13 mobile screenshots — every presentation except AGIL |
| Android Pixel 7 (412×915) | 2 spot-checks (CLIENTES, INVERSIONISTAS) |
| Desktop (1440×900) | 5 desktop screenshots (CLIENTES, INVERSIONISTAS, ELEVATOR, CUSTOMER-JOURNEYS, BUSINESS-CANVAS) |

All screenshots analyzed via **VLM (glm-4.6v)** with 4-question prompt:
**(a) readable? (b) overflow? (c) overlap? (d) mobile-adapted / desktop preserved?**

**Result:** 20/20 screenshots pass all 4 checks. VLM confirms:
- Mobile: text readable, no horizontal overflow, no overlap, layout properly
  mobile-adapted (not a tiny scaled-down desktop version).
- Desktop: text readable, no overflow, no overlap, original desktop layout
  preserved (overrides only kick in ≤900px).

## Lint

`bun run lint` → **0 errors**, 54 pre-existing TypeScript warnings (none
introduced by this task — all changes are static HTML in `/public`).

## Re-running

```bash
python3 /home/z/my-project/scripts/pres-responsive.py
```

Idempotent — on second run reports `already processed (skip)` for all 14
files via the `data-pres-responsive="1"` marker.
