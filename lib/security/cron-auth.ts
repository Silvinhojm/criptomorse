import type { NextRequest } from "next/server"
import { timingSafeStringEqual } from "./timing-safe-compare"

export function isValidCronRequest(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer ")) return false
  return timingSafeStringEqual(header.slice(7), expected)
}
