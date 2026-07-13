import { NextResponse } from "next/server";
import { captureError } from '@/lib/capture-error'
import { requireAuth } from '@/lib/auth-helpers'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  try {
    return NextResponse.json({ message: "ZIAY API", status: "ok" });
  } catch (err) {
    captureError(err as Error, { path: '/api', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
