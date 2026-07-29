'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type PerformancePoint = {
  date: string // ISO
  label: string // short label e.g. "Lun 14"
  ventas: number // number of sales
  gmv: number // revenue COP
}

type Props = {
  data: PerformancePoint[]
  currency?: string
}

const fmtCurrency = (n: number, currency = 'COP') => {
  if (currency === 'COP') return `$${Math.round(n).toLocaleString('es-CO')}`
  return `${currency} ${n.toFixed(2)}`
}

export function PerformanceChart({ data, currency = 'COP' }: Props) {
  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            width={48}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
              color: 'hsl(var(--popover-foreground))',
            }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
            formatter={(value: number, name: string) => {
              if (name === 'GMV') return [fmtCurrency(value, currency), name]
              return [`${value} ventas`, name]
            }}
          />
          <Area
            type="monotone"
            dataKey="gmv"
            name="GMV"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#perfGrad)"
            dot={false}
            activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
