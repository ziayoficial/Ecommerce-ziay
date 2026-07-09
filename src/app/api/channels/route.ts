import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// List channels
export async function GET() {
  const channels = await db.channel.findMany({ orderBy: { type: 'asc' } })
  return NextResponse.json({ channels })
}
