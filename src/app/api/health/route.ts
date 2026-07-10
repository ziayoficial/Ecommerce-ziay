import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/health — reports status of all integrations
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined
  const checks: { name: string; status: 'ok' | 'warning' | 'error' | 'not_configured'; detail: string }[] = []

  try {
    await db.$queryRaw`SELECT 1`
    checks.push({ name: 'database', status: 'ok', detail: 'Connected' })
  } catch (e) {
    checks.push({ name: 'database', status: 'error', detail: e instanceof Error ? e.message : 'unknown' })
  }

  try {
    const count = await db.tenant.count({ where: { activo: true } })
    checks.push({ name: 'tenants', status: count > 0 ? 'ok' : 'warning', detail: `${count} active tenants` })
  } catch { checks.push({ name: 'tenants', status: 'error', detail: 'cannot query' }) }

  const llmProviders = [
    { id: 'zai', env: null, alwaysOn: true },
    { id: 'chatgpt', env: 'OPENAI_API_KEY' },
    { id: 'xai', env: 'XAI_API_KEY' },
    { id: 'ollama', env: 'OLLAMA_BASE_URL' },
  ]
  for (const p of llmProviders) {
    if (p.alwaysOn) checks.push({ name: `llm_${p.id}`, status: 'ok', detail: 'Default provider' })
    else if (p.env && process.env[p.env]) checks.push({ name: `llm_${p.id}`, status: 'ok', detail: `Configured via ${p.env}` })
    else checks.push({ name: `llm_${p.id}`, status: 'not_configured', detail: `Set ${p.env} to enable` })
  }

  if (tenantId) {
    try {
      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (tenant) {
        checks.push({ name: 'tenant_llm', status: 'ok', detail: `proveedorIa='${tenant.proveedorIa}'` })
        checks.push({ name: 'tenant_catalog_adapter', status: 'ok', detail: `plataformaCatalogo='${tenant.plataformaCatalogo}'` })
        checks.push({ name: 'tenant_logistics_adapter', status: 'ok', detail: `proveedorLogistico='${tenant.proveedorLogistico}'` })
      }
    } catch { }
  }

  const adapterCreds = [
    { id: 'woocommerce', env: 'WOOCOMMERCE_CONSUMER_KEY' },
    { id: 'shopify', env: 'SHOPIFY_ACCESS_TOKEN' },
    { id: 'supabase', env: 'SUPABASE_URL' },
    { id: 'oracle', env: 'ORACLE_CONNECTION_STRING' },
  ]
  for (const a of adapterCreds) {
    checks.push({ name: `adapter_${a.id}`, status: process.env[a.env] ? 'ok' : 'not_configured', detail: process.env[a.env] ? 'Configured' : `Set ${a.env}` })
  }

  const logisticsCreds = [
    { id: 'dropi', env: 'DROPI_API_KEY' },
    { id: '99envios', env: 'ENVIOS99_API_KEY' },
    { id: 'aveonline', env: 'AVEONLINE_API_KEY' },
  ]
  for (const l of logisticsCreds) {
    checks.push({ name: `logistics_${l.id}`, status: process.env[l.env] ? 'ok' : 'not_configured', detail: process.env[l.env] ? 'Configured' : `Set ${l.env}` })
  }

  checks.push({ name: 'webhook_whatsapp', status: process.env.WA_VERIFY_TOKEN ? 'ok' : 'warning', detail: process.env.WA_VERIFY_TOKEN ? 'Token configured' : 'WA_VERIFY_TOKEN not set' })
  checks.push({ name: 'webhook_meta', status: process.env.META_VERIFY_TOKEN ? 'ok' : 'warning', detail: process.env.META_VERIFY_TOKEN ? 'Token configured' : 'META_VERIFY_TOKEN not set' })
  checks.push({ name: 'webhook_nocodb', status: process.env.NOCODB_WEBHOOK_URL ? 'ok' : 'not_configured', detail: process.env.NOCODB_WEBHOOK_URL ? 'Configured' : 'NocoDB sync disabled' })

  const summary = {
    ok: checks.filter(c => c.status === 'ok').length,
    warning: checks.filter(c => c.status === 'warning').length,
    error: checks.filter(c => c.status === 'error').length,
    not_configured: checks.filter(c => c.status === 'not_configured').length,
  }
  const overall = summary.error > 0 ? 'error' : summary.warning > 0 ? 'warning' : 'ok'

  return NextResponse.json({ status: overall, summary, checks, timestamp: new Date().toISOString() })
}
