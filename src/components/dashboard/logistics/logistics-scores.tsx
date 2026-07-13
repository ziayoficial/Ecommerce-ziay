// ZIAY — Logistics "Scores" tabs: customer scores table + carrier scores
// chart & table. Split out from logistics-intelligence-view.tsx in
// AUDIT-FINAL-SPLIT-001.

'use client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatPercent, shortDate } from '@/lib/format'
import { Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import {
  categoryMeta, type CustomerScore, type CarrierScore,
} from './logistics-shared'

// ───────────────────────────────────────────────────────────────────────────
// Customer scores tab
// ───────────────────────────────────────────────────────────────────────────
export function CustomerScoresTab({
  customers, filteredCustomers, searchPhone, categoryFilter,
  onSearchPhoneChange, onCategoryFilterChange,
}: {
  customers: CustomerScore[]
  filteredCustomers: CustomerScore[]
  searchPhone: string
  categoryFilter: string
  onSearchPhoneChange: (v: string) => void
  onCategoryFilterChange: (v: string) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Scores de Clientes</CardTitle>
            <CardDescription>
              {filteredCustomers.length} de {customers.length} clientes
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Label htmlFor="li-search-phone" className="sr-only">Buscar por teléfono</Label>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
              <Input
                id="li-search-phone"
                value={searchPhone}
                onChange={(e) => onSearchPhoneChange(e.target.value)}
                placeholder="Buscar teléfono…"
                className="pl-8 h-9 w-44"
              />
            </div>
            <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
              <SelectTrigger id="li-category-filter" className="h-9 w-40" aria-label="Filtrar por categoría">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="confiable">Confiable</SelectItem>
                <SelectItem value="riesgo">Riesgo</SelectItem>
                <SelectItem value="devolvedor">Devolvedor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Sin clientes que coincidan con el filtro
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Teléfono</TableHead>
                  <TableHead className="w-24">Categoría</TableHead>
                  <TableHead className="text-right w-20">Score</TableHead>
                  <TableHead className="text-right w-20">Pedidos</TableHead>
                  <TableHead className="text-right w-24">Entregados</TableHead>
                  <TableHead className="text-right w-24">Devueltos</TableHead>
                  <TableHead className="w-28">Último pedido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((c) => {
                  const meta = categoryMeta(c.category)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{c.phone}</TableCell>
                      <TableCell>
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap', meta.cls)}>
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                        {c.score.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{c.totalPedidos}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                        {c.pedidosEntregados}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap text-rose-600 dark:text-rose-400">
                        {c.pedidosDevueltos}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {c.lastOrderAt ? shortDate(c.lastOrderAt) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Carrier scores tab (chart + table)
// ───────────────────────────────────────────────────────────────────────────
export function CarrierScoresTab({
  carriers, chartData,
}: {
  carriers: CarrierScore[]
  chartData: { name: string; fullName: string; deliveryRate: number; score: number }[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tasa de entrega</CardTitle>
          <CardDescription>% entregadas sobre total de guías por transportadora</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              Sin transportadoras
            </div>
          ) : (
            <figure
              role="img"
              aria-label={`Tasa de entrega por transportadora: ${chartData
                .map((c) => `${c.fullName} ${c.deliveryRate}%`)
                .join(', ')}`}
            >
              <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 44)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    width={90}
                  />
                  <RTooltip
                    contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`, 'Entrega']}
                    labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ''}
                  />
                  <Bar dataKey="deliveryRate" radius={[0, 6, 6, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={
                          entry.deliveryRate >= 80
                            ? 'oklch(0.72 0.19 152)'
                            : entry.deliveryRate >= 50
                              ? 'oklch(0.78 0.16 80)'
                              : 'oklch(0.66 0.2 25)'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </figure>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalle por transportadora</CardTitle>
          <CardDescription>{carriers.length} transportadoras</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {carriers.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Sin transportadoras registradas
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Transportadora</TableHead>
                    <TableHead className="text-right w-20">Score</TableHead>
                    <TableHead className="text-right w-20">Guías</TableHead>
                    <TableHead className="text-right w-24">Entregadas</TableHead>
                    <TableHead className="text-right w-24">Devueltas</TableHead>
                    <TableHead className="text-right w-28">Entrega %</TableHead>
                    <TableHead className="text-right w-24">Días prom.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carriers.map((c) => {
                    const rate = c.totalGuias > 0 ? (c.entregadas / c.totalGuias) * 100 : 0
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium whitespace-nowrap truncate max-w-[180px]">
                          {c.carrierName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">
                          {c.score.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{c.totalGuias}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                          {c.entregadas}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap text-rose-600 dark:text-rose-400">
                          {c.devueltas}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          <span className={cn(
                            'text-xs font-semibold px-1.5 py-0.5 rounded',
                            rate >= 80 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                            rate >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                            'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                          )}>
                            {formatPercent(rate, 0)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap text-xs">
                          {c.avgDeliveryDays != null ? `${c.avgDeliveryDays.toFixed(1)}d` : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
