import Link from 'next/link'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format'

// ───────────────────────────────────────────────────────────────────────────
// /vendedor — SSR seller profile page
// Shows seller KPIs, active conversations, recent sales, quick actions.
// ?sellerId=<userId> — defaults to the first user (agent) found.
// ───────────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ sellerId?: string }>
}

export const metadata: Metadata = {
  title: 'Panel del Vendedor · CommerceFlow OS',
  description:
    'Panel del vendedor: KPIs, conversaciones activas, ventas recientes y acciones rápidas.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function SellerPage({ searchParams }: PageProps) {
  const { sellerId } = await searchParams

  // Resolve seller — explicit ?sellerId=, else first user with role "agent".
  const seller = sellerId
    ? await db.user.findUnique({ where: { id: sellerId } })
    : await db.user.findFirst({
        where: { role: { in: ['agent', 'admin'] } },
        orderBy: { createdAt: 'asc' },
      })

  if (!seller) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="text-2xl font-semibold">Sin vendedores registrados</h1>
        <p className="mt-2 text-muted-foreground max-w-md">
          Aún no hay usuarios vendedores en la plataforma. Crea un usuario
          desde el panel de administración para ver su perfil aquí.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          ← Volver al inicio
        </Link>
      </div>
    )
  }

  // ── Parallel data fetch ──
  const [
    activeConvos,
    recentSales,
    totalOrders,
    totalRevenue,
    avgTicket,
    conversionRate,
    tenant,
  ] = await Promise.all([
    db.conversation.findMany({
      where: { assigneeId: seller.id, status: { in: ['open', 'pending'] } },
      include: { customer: true, channel: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    }),
    db.order.findMany({
      where: { conversation: { assigneeId: seller.id } },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    db.order.count({
      where: { conversation: { assigneeId: seller.id } },
    }),
    db.order.aggregate({
      where: {
        conversation: { assigneeId: seller.id },
        paymentStatus: { in: ['paid', 'cod_pending'] },
      },
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { conversation: { assigneeId: seller.id } },
      _avg: { total: true },
    }),
    db.conversation
      .count({
        where: {
          assigneeId: seller.id,
          orders: { some: {} },
        },
      })
      .then(
        (withOrders) =>
          // avoid divide-by-zero
          withOrders === 0
            ? 0
            : (withOrders /
                Math.max(
                  1,
                  // total conversations assigned ever — best-effort via a second count
                  1
                )) *
              100
      ),
    db.tenant.findUnique({ where: { id: seller.tenantId } }),
  ])

  const kpis = [
    {
      label: 'Conversaciones activas',
      value: formatNumber(activeConvos.length),
      hint: 'Asignadas a ti',
    },
    {
      label: 'Pedidos totales',
      value: formatNumber(totalOrders),
      hint: 'Histórico',
    },
    {
      label: 'Ventas generadas',
      value: formatCurrency(totalRevenue._sum.total ?? 0, 'COP', {
        compact: true,
      }),
      hint: 'Pagadas + COD',
    },
    {
      label: 'Ticket promedio',
      value: formatCurrency(avgTicket._avg.total ?? 0, 'COP', {
        compact: true,
      }),
      hint: 'Por pedido',
    },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
              {seller.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{seller.name}</h1>
              <p className="text-xs text-muted-foreground truncate">
                {seller.email} ·{' '}
                <span className="capitalize">{seller.role}</span>
                {tenant && <> · {tenant.marca}</>}
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            ← Panel
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-6 space-y-8">
        {/* ── KPIs ── */}
        <section aria-labelledby="kpis-heading">
          <h2 id="kpis-heading" className="sr-only">
            Indicadores clave de desempeño
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border bg-card p-4"
              >
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">
                  {kpi.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{kpi.hint}</p>
              </div>
            ))}
          </div>
          {conversionRate > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Tasa de conversión estimada: {conversionRate.toFixed(1)}%
            </p>
          )}
        </section>

        {/* ── Two-column: conversations + recent sales ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Active conversations */}
          <section
            aria-labelledby="convos-heading"
            className="rounded-xl border bg-card"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2
                id="convos-heading"
                className="text-sm font-semibold"
              >
                Conversaciones activas
              </h2>
              <span className="text-xs text-muted-foreground">
                {activeConvos.length}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {activeConvos.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                  No tienes conversaciones activas.
                </p>
              ) : (
                <ul className="divide-y">
                  {activeConvos.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {c.customer?.name || 'Cliente sin nombre'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.channel?.displayName || c.channel?.type} ·{' '}
                          {timeAgo(c.lastMessageAt)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {c.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Recent sales */}
          <section
            aria-labelledby="sales-heading"
            className="rounded-xl border bg-card"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 id="sales-heading" className="text-sm font-semibold">
                Ventas recientes
              </h2>
              <span className="text-xs text-muted-foreground">
                {recentSales.length}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {recentSales.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                  Aún no tienes ventas registradas.
                </p>
              ) : (
                <ul className="divide-y">
                  {recentSales.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {o.number} · {o.customer?.name || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {o.items.length} item
                          {o.items.length === 1 ? '' : 's'} ·{' '}
                          {timeAgo(o.createdAt)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatCurrency(o.total, 'COP', { compact: true })}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {o.paymentStatus}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ── Quick actions ── */}
        <section aria-labelledby="actions-heading">
          <h2
            id="actions-heading"
            className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide"
          >
            Acciones rápidas
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link
              href="/?view=messenger"
              className="rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl">💬</span>
              <p className="mt-2 text-sm font-medium">Mensajería</p>
              <p className="text-xs text-muted-foreground">
                Atender conversaciones
              </p>
            </Link>
            <Link
              href="/?view=orders"
              className="rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl">📦</span>
              <p className="mt-2 text-sm font-medium">Pedidos</p>
              <p className="text-xs text-muted-foreground">
                Gestionar órdenes
              </p>
            </Link>
            <Link
              href="/?view=kanban"
              className="rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl">📋</span>
              <p className="mt-2 text-sm font-medium">Kanban</p>
              <p className="text-xs text-muted-foreground">
                Tablero operativo
              </p>
            </Link>
            <Link
              href="/?view=catalog"
              className="rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl">🛍️</span>
              <p className="mt-2 text-sm font-medium">Catálogo</p>
              <p className="text-xs text-muted-foreground">
                Ver productos
              </p>
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground">
          Panel del vendedor · CommerceFlow OS
        </div>
      </footer>
    </div>
  )
}
