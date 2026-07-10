import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// WhatsApp Cloud API webhook (Meta).
// GET = verification, POST = inbound messages.
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.WA_VERIFY_TOKEN || 'commerceflow_verify'
  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge || '', { status: 200 })
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  // In production: parse entry[].changes[].value.messages, resolve customer by wa_id,
  // upsert conversation on the WhatsApp channel, store message, emit via socket.io.
  // We log to audit for the demo.
  await db.auditLog.create({
    data: { action: 'webhook.wa.inbound', entity: 'Webhook', meta: JSON.stringify(body).slice(0, 1000) },
  })
  return NextResponse.json({ received: true })
}
