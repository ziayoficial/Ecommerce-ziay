import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

/**
 * GET /api
 *
 * Root API health/info endpoint.
 *
 * @security Requires authentication
 * @returns API status JSON
 */
export const GET = withErrorHandling(async () => {

  const { error } = await requireAuth()
  if (error) return error

    return NextResponse.json({ message: "ZIAY API", status: "ok" });
  

})
