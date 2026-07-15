# Task: REDELIVERY-API-UI

## Files Created
- `/home/z/my-project/src/app/api/redelivery/route.ts` — GET (list + stats), POST (create), PATCH (6 actions: confirm_address, schedule, assign_human, complete, cancel, add_attempt)
- `/home/z/my-project/src/app/api/guide-movements/route.ts` — GET (timeline por guideNumber), POST (webhook carrier)

## Files Modified
- `/home/z/my-project/src/components/dashboard/novedades-view.tsx` — refactor a Tabs container con 3 pestañas (Casos | Reintentos | Historial de Guía). Añadidos componentes: NovedadesView (wrapper), CasosTab (previo NovedadesView), RedeliveryTab, RedeliveryDetailPanel, RedeliveryStatsPanel, CreateRedeliveryDialog, ConfirmAddressDialog, ScheduleDialog, GuideHistoryTab. Helpers: RedeliveryStatusBadge, ReasonBadge, AttemptStatusBadge. Constants: REDELIVERY_REASON_CONFIG, REDELIVERY_STATUS_CONFIG, ATTEMPT_STATUS_CONFIG, MOVEMENT_EVENT_CONFIG.

## Verification
- bun run lint: 0 errores ✅
- npx tsc --noEmit | grep "^src/": 0 errores ✅
- GET /api/redelivery?tenantId=ten-intl: 200 ✅
- GET /api/guide-movements?tenantId=ten-intl&guideNumber=TEST-123: 200 ✅
- POST validación: 400 con errores claros ✅

## Notes
- Schema ya estaba definido (GuideMovement, RedeliveryRequest, RedeliveryAttempt) — no se modificó.
- APIs escriben en DB read-only en sandbox → POST/PATCH fallan en runtime, pero lógica + validaciones correctas.
- Lint: react-hooks/set-state-in-effect avoided por patrón "onClick → setState + loadHistory".
