// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API inbound webhook payload parser.
//
// Study §13.1 + §14.4 — extracts the customer's phone, the WA message ID,
// the message type (text/button/interactive/image/location/audio/document),
// the textual content (for the agent inbox + AI auto-reply) and the
// Click-to-WhatsApp-Ad (CTWA) `click_id` for closed-loop attribution.
//
// The parser is a pure function — no DB, no fetch. The webhook route
// (`src/app/api/webhooks/whatsapp/route.ts`) calls it AFTER HMAC + dedup
// checks pass, then uses the parsed fields to upsert Customer /
// Conversation / Message rows and emit a socket event.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001
// ─────────────────────────────────────────────────────────────────────────────

/** Parsed inbound message — normalized across all Meta message types. */
export interface ParsedWhatsAppInbound {
  /** Customer phone in E.164 (no `+`), e.g. `'573001112233'`. */
  from: string
  /** Customer display name when Meta echoes it (opt-in `name` field). */
  fromName?: string
  /** WA message ID (`wamid.…`). Used for `markMessageRead` + dedup. */
  messageId: string
  /** Unix seconds (Meta format). Converted to a JS Date in `timestampMs`. */
  timestamp: string
  timestampMs: number
  /** Normalized type — `text | button | interactive | image | audio | document | location | unknown`. */
  type: string
  /** Human-readable body for the agent inbox. For non-text types, falls
   *  back to a descriptive label (`[Imagen]`, `[Audio]`, `[Ubicación]`). */
  text: string
  /** Raw text body when `type === 'text'` (no prefix). Convenience for the
   *  AI auto-reply pipeline which only cares about textual content. */
  textBody?: string
  /** Media ID for image / audio / document — used to fetch the binary
   *  from Meta's media endpoint. NULL for text/button/interactive. */
  mediaId?: string
  /** Caption that accompanies an image / document. NULL when absent. */
  caption?: string
  /** Image URL when Meta echoes it (rare; usually only the media ID). */
  imageUrl?: string
  /** Location payload when `type === 'location'`. */
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  /** Interactive button reply (id + title) when `type === 'interactive'`. */
  buttonReply?: { id: string; title: string }
  /** CTWA click_id (`context.referral.ctwa_click_id`) — used to attribute
   *  the lead to a specific ad. NULL when the message is not from a
   *  Click-to-WhatsApp-Ad. */
  ctwClickId?: string
  /** Raw referral source URL when present — useful for `?ms_id=...` parsing. */
  referralSourceUrl?: string
  /** Phone number ID of the receiving WA Business number (used to resolve
   *  tenant). Pulled from `value.metadata.phone_number_id`. */
  phoneNumberId?: string
  /** Display phone number (e.g. `+57 300 111 2233`) — for audit logs. */
  displayPhoneNumber?: string
  /** Raw `value.contacts[0].wa_id` — same as `from` but kept for traces. */
  contactWaId?: string
}

/**
 * Parse a raw Meta webhook body. Returns `null` when the payload is not a
 * message event (e.g. status updates, template-approved callbacks).
 *
 * The shape per Meta's Cloud API docs:
 *   entry[]: { id, changes[]: { value: { messaging_product, metadata,
 *     contacts[]?, messages[]?, statuses[]? }, field } }
 *
 * We only care about the first message in `value.messages[]`. Meta
 * batches multiple messages in production but for our latency profile
 * (sub-second ACK) this is rare; if it happens, subsequent messages
 * arrive in the next webhook call (Meta retries).
 */
export function parseWhatsAppInbound(payload: unknown): ParsedWhatsAppInbound | null {
  if (!payload || typeof payload !== 'object') return null
  const entry = (payload as { entry?: unknown[] }).entry
  if (!Array.isArray(entry) || entry.length === 0) return null
  const firstEntry = entry[0] as { changes?: unknown[] } | undefined
  if (!firstEntry || !Array.isArray(firstEntry.changes) || firstEntry.changes.length === 0) {
    return null
  }
  const change = firstEntry.changes[0] as { value?: Record<string, unknown> } | undefined
  if (!change?.value) return null
  const value = change.value

  // Status webhook (delivery / read receipts) — we don't process these
  // for now (no `messages[]` array). Return null so the caller ACKs and
  // skips the customer / conversation / message persistence path.
  const messages = value.messages as unknown[] | undefined
  if (!Array.isArray(messages) || messages.length === 0) return null

  const msg = messages[0] as Record<string, unknown>
  const from = typeof msg.from === 'string' ? msg.from : ''
  const messageId = typeof msg.id === 'string' ? msg.id : ''
  const timestamp = typeof msg.timestamp === 'string' ? msg.timestamp : ''
  const timestampMs = timestamp ? parseInt(timestamp, 10) * 1000 : Date.now()
  const rawType = typeof msg.type === 'string' ? msg.type : 'unknown'

  // ── Contact display name (optional) ────────────────────────────────────
  const contacts = value.contacts as unknown[] | undefined
  const contact = contacts && contacts.length > 0
    ? (contacts[0] as Record<string, unknown>)
    : undefined
  const fromName =
    contact && typeof contact.name === 'string' ? contact.name : undefined
  const contactWaId =
    contact && typeof contact.wa_id === 'string' ? contact.wa_id : undefined

  // ── Metadata (phone_number_id for tenant resolution) ───────────────────
  const metadata = (value.metadata as Record<string, unknown> | undefined) ?? {}
  const phoneNumberId =
    typeof metadata.phone_number_id === 'string' ? metadata.phone_number_id : undefined
  const displayPhoneNumber =
    typeof metadata.display_phone_number === 'string' ? metadata.display_phone_number : undefined

  // ── Per-type extraction ────────────────────────────────────────────────
  let text = ''
  let textBody: string | undefined
  let mediaId: string | undefined
  let caption: string | undefined
  let imageUrl: string | undefined
  let location: ParsedWhatsAppInbound['location']
  let buttonReply: ParsedWhatsAppInbound['buttonReply']
  let type = rawType

  if (rawType === 'text') {
    const t = (msg.text as { body?: string } | undefined) ?? {}
    textBody = typeof t.body === 'string' ? t.body : ''
    text = textBody
  } else if (rawType === 'button') {
    const b = (msg.button as { text?: string; payload?: string } | undefined) ?? {}
    const label = typeof b.text === 'string' ? b.text : ''
    textBody = label
    text = label ? `[Botón] ${label}` : '[Botón]'
    if (b.payload) buttonReply = { id: b.payload, title: label }
  } else if (rawType === 'interactive') {
    const it = (msg.interactive as Record<string, unknown> | undefined) ?? {}
    const br = it.button_reply as { id?: string; title?: string } | undefined
    const lr = it.list_reply as { id?: string; title?: string } | undefined
    const reply = br ?? lr
    if (reply) {
      const title = typeof reply.title === 'string' ? reply.title : ''
      const id = typeof reply.id === 'string' ? reply.id : ''
      textBody = title
      text = title ? `[Interactivo] ${title}` : '[Interactivo]'
      buttonReply = { id, title }
      type = 'interactive'
    } else {
      text = '[Interactivo]'
    }
  } else if (rawType === 'image') {
    const img = (msg.image as { id?: string; caption?: string; link?: string; url?: string } | undefined) ?? {}
    mediaId = typeof img.id === 'string' ? img.id : undefined
    caption = typeof img.caption === 'string' ? img.caption : undefined
    imageUrl = typeof img.link === 'string'
      ? img.link
      : typeof img.url === 'string' ? img.url : undefined
    text = caption ? `[Imagen] ${caption}` : '[Imagen]'
  } else if (rawType === 'audio') {
    const a = (msg.audio as { id?: string; link?: string } | undefined) ?? {}
    mediaId = typeof a.id === 'string' ? a.id : undefined
    text = '[Audio]'
  } else if (rawType === 'document') {
    const d = (msg.document as { id?: string; caption?: string; filename?: string } | undefined) ?? {}
    mediaId = typeof d.id === 'string' ? d.id : undefined
    caption = typeof d.caption === 'string' ? d.caption : undefined
    const filename = typeof d.filename === 'string' ? d.filename : ''
    text = caption
      ? `[Documento] ${caption}`
      : filename ? `[Documento] ${filename}` : '[Documento]'
  } else if (rawType === 'location') {
    const loc = (msg.location as { latitude?: number; longitude?: number; name?: string; address?: string } | undefined) ?? {}
    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      location = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: typeof loc.name === 'string' ? loc.name : undefined,
        address: typeof loc.address === 'string' ? loc.address : undefined,
      }
      text = `[Ubicación] ${loc.latitude},${loc.longitude}`
    } else {
      text = '[Ubicación]'
    }
  } else {
    // Unknown type — record it for audit but don't crash the webhook.
    text = `[${rawType}]`
  }

  // ── CTWA click_id extraction ───────────────────────────────────────────
  // Meta attaches `context.referral` to inbound messages that originated
  // from a Click-to-WhatsApp-Ad. The referral object carries:
  //   - source_url      the ad's deep link (may include `?ms_id=...`)
  //   - source_type     `ad` | `post` | `ad_direct`
  //   - ctwa_click_id   the click id we want for attribution
  // Some payloads use `context.cta_url` instead — we parse both.
  const context = (msg.context as Record<string, unknown> | undefined) ?? {}
  const referral = (context.referral as Record<string, unknown> | undefined)
    ?? (msg.referral as Record<string, unknown> | undefined)

  let ctwClickId: string | undefined
  let referralSourceUrl: string | undefined

  if (referral) {
    if (typeof referral.ctwa_click_id === 'string' && referral.ctwa_click_id) {
      ctwClickId = referral.ctwa_click_id
    }
    if (typeof referral.source_url === 'string') {
      referralSourceUrl = referral.source_url
      if (!ctwClickId) {
        ctwClickId = extractClickIdFromUrl(referral.source_url)
      }
    }
  }

  // `context.cta_url` (older Click-to-Chat ads)
  if (!ctwClickId) {
    const ctaUrl = typeof context.cta_url === 'string' ? context.cta_url : undefined
    if (ctaUrl) {
      referralSourceUrl = ctaUrl
      ctwClickId = extractClickIdFromUrl(ctaUrl)
    }
  }

  return {
    from,
    fromName,
    messageId,
    timestamp,
    timestampMs,
    type,
    text,
    textBody,
    mediaId,
    caption,
    imageUrl,
    location,
    buttonReply,
    ctwClickId,
    referralSourceUrl,
    phoneNumberId,
    displayPhoneNumber,
    contactWaId,
  }
}

/**
 * Parse a Click-to-WhatsApp-Ad click id from a deep link URL.
 *
 * Meta uses two query parameter names depending on the ad format:
 *   - `?cta_id=<id>`   — Click-to-WhatsApp-Ad (CTWA) v2
 *   - `?ms_id=<id>`    — Messaging-Source ID (older CTWA v1 + some ad formats)
 *
 * Returns the first match (cta_id preferred) or `undefined` when neither
 * is present.
 */
export function extractClickIdFromUrl(url: string): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    const ctaId = parsed.searchParams.get('cta_id')
    if (ctaId) return ctaId
    const msId = parsed.searchParams.get('ms_id')
    if (msId) return msId
    return undefined
  } catch {
    // Not a valid URL — try a regex fallback in case Meta sends a
    // fragment-style link (`https://wa.me/...?ms_id=foo` without parseable
    // search params).
    const match = url.match(/[?&](?:cta_id|ms_id)=([^&]+)/)
    return match ? decodeURIComponent(match[1]) : undefined
  }
}
