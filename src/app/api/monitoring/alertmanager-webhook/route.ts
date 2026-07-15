import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// SPRINT-MONITORING-FIX-001 · #4 — Alertmanager webhook receiver.
//
// Alertmanager POSTs to this endpoint (configured as the `default`
// receiver's `webhook_configs.url` in monitoring/alertmanager.yml)
// whenever an alert starts firing or resolves. Each firing alert is
// auto-converted into a `StatusIncident` row so the public `/status`
// page stays in sync with the monitoring stack without manual ops
// intervention. Resolved alerts mark the matching incident as
// `resolved` + set `endTime`.
//
// Auth: a shared Bearer secret (`ALERTMANAGER_WEBHOOK_SECRET`) — set in
// `.env` and passed through to the Alertmanager container via the
// `environment:` block in docker-compose.yml. The middleware bypasses
// NextAuth for this route (PUBLIC_PATTERNS in src/middleware.ts), so
// the secret check below is the ONLY auth gate.
//
// Request body shape (Alertmanager v0.25+):
//   {
//     "version": "4", "groupKey": "...", "status": "firing",
//     "alerts": [
//       {
//         "status": "firing",
//         "labels": { "alertname": "HighErrorRate", "severity": "critical" },
//         "annotations": { "summary": "...", "description": "..." },
//         "startsAt": "2024-01-01T00:00:00Z",
//         "endsAt": "0001-01-01T00:00:00Z"
//       }
//     ]
//   }

// POST /api/monitoring/alertmanager-webhook
// Receives alerts from Alertmanager and auto-creates StatusIncident rows.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.ALERTMANAGER_WEBHOOK_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const alerts = body.alerts || []

  const incidents = []

  for (const alert of alerts) {
    const status = alert.status // 'firing' or 'resolved'
    const labels = alert.labels || {}
    const annotations = alert.annotations || {}
    const severity = labels.severity || 'warning'

    if (status === 'firing') {
      // Create incident
      const incident = await db.statusIncident.create({
        data: {
          title: annotations.summary || labels.alertname || 'Alerta del sistema',
          description: annotations.description || 'Alerta automática de monitoreo',
          severity: severity === 'critical' ? 'critical' : severity === 'warning' ? 'major' : 'minor',
          status: 'investigating',
          startTime: new Date(alert.startsAt),
          updates: JSON.stringify([{
            time: new Date().toISOString(),
            message: `Alerta recibida: ${annotations.summary}`,
            status: 'investigating',
          }]),
        },
      })
      incidents.push(incident)
    } else if (status === 'resolved') {
      // Resolve matching incidents
      await db.statusIncident.updateMany({
        where: {
          title: annotations.summary || labels.alertname,
          status: { not: 'resolved' },
        },
        data: {
          status: 'resolved',
          endTime: new Date(),
        },
      })
    }
  }

  return NextResponse.json({ received: true, incidentsCreated: incidents.length })
})
