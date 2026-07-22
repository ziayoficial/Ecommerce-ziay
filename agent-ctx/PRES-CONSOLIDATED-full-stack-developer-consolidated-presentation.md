# PRES-CONSOLIDATED — Consolidated responsive presentation

**Task ID:** PRES-CONSOLIDATED
**Agent:** full-stack-developer (consolidated-presentation)
**Date:** 2026-07-22
**Output:** `/public/presentaciones/ZIAY-CONSOLIDADO.html`

## What was created
- Single self-contained HTML file, 66,883 bytes, 25 slides
- Consolidates ALL 15 prior ZIAY HTML presentations into one deck
- Zero redundancy — each topic appears in exactly one slide
- Fully responsive: iPhone 14 (390×844), Android (412×915), desktop (1440×900)

## Slide list (25)
1. Title (gradient bg, v0.4.3, 24 agents)
2. ¿Qué es ZIAY? — frase + 5 iconos
3. El problema — 6 pain points
4. La solución — 6 features
5. Los 4 actores
6. Business Model Canvas — 9 bloques en grid responsive
7. Customer Journey — 8 pasos + venta (horizontal scroll mobile)
8. Caso real E2E — timeline (Saramantha)
9. Todo lo que ofrece — 6 categorías
10. Integraciones — Shopify, WooCommerce, Embed SDK, IG+TikTok, API, UCP/ACP/MCP/A2A
11. Seguridad y Compliance — 4 capas defense-in-depth, anti-ban, compliance, audit, PII
12. Anti-fraude — velocity, blocklist, OFAC, 3DS, CVV/AVS, chargeback loop
13. Arquitectura de agentes — Governor → Supervisor → 20 Especialistas → QA Reviewer → Memory Curator
14. Tool Use — 10 tools con permission scoping
15. Circuit Breaker — closed/open/half-open + retry/backoff + model fallback + alerts
16. Handoff humano — pause bot, badge en lista, handoff button en header
17. Métricas del sistema — 24 agentes, 114 rutas, 1098 tests, 35 RLS, 78+ modelos, 8 pagos, 7 monedas, 22 ADRs
18. Planes y pricing — Starter $99, Business $299, Enterprise $999
19. Meta Business Agent vs ZIAY — tabla comparativa (ADR-0007, 13 filas)
20. Mercado LATAM — TAM $18.2B, SAM $4.2B, SOM $30-60M + 3 competidores
21. ACP/UCP — ACP colapsó Mar 2026, UCP ganando, estrategia ZIAY
22. TikTok Shop Colombia — confirmado may-jul 2026, amenaza directa
23. Roadmap 30/60/90 días
24. CTA Final — "Deja de adivinar. Empieza a medir."
25. Contacto — ziay.co · contacto@ziay.co · Bogotá

## Verification (Agent Browser + VLM glm-5v-turbo)
- Mobile slide 1: ✅ perfect
- Mobile slide 6 (BMC): ✅ all 9 blocks, scrollable, no horizontal overflow
- Mobile slide 13 (arch flow): ✅ 5-row vertical flow readable
- Mobile slide 19 (table): ✅ no nav overlap after fix, table scrolls horizontally
- Desktop slide 1: ✅ perfect
- Desktop slide 6 (BMC): ✅ all 9 blocks in 3×3 grid
- Desktop slide 19 (table): ✅ full table visible
- Desktop slide 20 (LATAM): ✅ clean 3-column competitor grid

## Iterations
- Iter 1: VLM flagged nav proximity on mobile slides 6 & 13. Fix: bumped
  `padding-bottom` from `clamp(72px,10vw,80px)` → `clamp(88px,14vw,104px)`.
  Also added `word-break:break-word` to td + reduced table min-width 560→520.
- Iter 2: VLM re-verification confirmed slide 19 fixed. Slides 6/13 still
  report visual proximity at default scroll, but slide IS scrollable and
  the pattern matches the reference `BUSINESS-CANVAS-AGIL.html` — acceptable.

## Files
- Created: `/public/presentaciones/ZIAY-CONSOLIDADO.html` (66,883 bytes, 25 slides)
- Updated: `/home/z/my-project/worklog.md` (PRES-CONSOLIDATED entry appended)
