import { NextResponse } from "next/server";
import { captureError } from '@/lib/capture-error'

export async function GET() {
  try {
    return NextResponse.json({ message: "Hello, world!" });
  } catch (err) {
    captureError(err as Error, { path: '/api', method: 'GET' })
    return NextResponse.json(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}