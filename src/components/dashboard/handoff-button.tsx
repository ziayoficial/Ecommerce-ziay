'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { Bot, User, Pause, Play, ChevronDown } from 'lucide-react'

/**
 * HandoffButton — toggle AI bot on/off for a conversation.
 *
 * GAP-FIX-1: Human takeover UI. Previously the handoff endpoint existed
 * but had no dashboard button — agents couldn't pause the bot from the UI.
 *
 * Usage:
 * <HandoffButton conversationId={conv.id} botEnabled={conv.botEnabled} />
 */
export function HandoffButton({
  conversationId,
  botEnabled,
  pausedReason,
  onToggle,
}: {
  conversationId: string
  botEnabled: boolean
  pausedReason?: string | null
  onToggle?: (newBotEnabled: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [currentBotEnabled, setCurrentBotEnabled] = useState(botEnabled)

  async function toggle(action: 'pause' | 'resume', reason?: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason || 'manual' }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setCurrentBotEnabled(data.botEnabled)
      onToggle?.(data.botEnabled)

      toast.success(
        action === 'pause'
          ? '🤖 Bot pausado — tienes el control manual'
          : '🤖 Bot reactivado — IA retoma el control',
      )
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setLoading(false)
    }
  }

  if (currentBotEnabled) {
    // Bot is active — show "pause" dropdown
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={loading} className="gap-1.5 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Pausar bot — opciones de handoff humano">
            <Bot className="size-3.5 text-emerald-600" />
            <span className="hidden sm:inline">Bot activo</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Pausar bot (tomar control)
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggle('pause', 'human_takeover')} aria-label="Tomar control manual del bot">
            <User className="size-3.5 mr-2" />
            Tomar control manual
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle('pause', 'customer_request')} aria-label="Pausar bot porque el cliente pidió hablar con humano">
            <Pause className="size-3.5 mr-2" />
            Cliente pidió hablar con humano
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle('pause', 'maintenance')} aria-label="Pausar bot por mantenimiento">
            <Pause className="size-3.5 mr-2" />
            Mantenimiento
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Bot is paused — show "resume" button + reason badge
  return (
    <div className="flex items-center gap-2">
      <Badge variant="destructive" className="gap-1 text-xs" aria-label={`Bot pausado: ${pausedReason || 'manual'}`}>
        <User className="size-3" />
        {pausedReason === 'human_takeover'
          ? 'Humano'
          : pausedReason === 'customer_request'
            ? 'Cliente pidió humano'
            : 'Bot pausado'}
      </Badge>
      <Button
        variant="default"
        size="sm"
        disabled={loading}
        onClick={() => toggle('resume')}
        className="gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Reactivar bot IA"
      >
        <Play className="size-3.5" />
        <span className="hidden sm:inline">Reactivar bot</span>
      </Button>
    </div>
  )
}
