import { getCircuitBreakerStateFresh, syncCircuitBreakerStateFromClient } from "@/lib/circuit-breaker"
import { isValidCircuitBreakerSyncRequest } from "@/lib/security/cron-auth"

// RI-BANK-4 Stage 2 — server-side mirror of the circuit breaker state.
// GET is intentionally left unauthenticated: it's read-only, and
// app/api/panic's own GET already exposes this same state without auth —
// no new risk. POST is authenticated (residual-risk fix, see
// lib/security/cron-auth.ts's isValidCircuitBreakerSyncRequest for the
// full threat-model writeup on why this secret is weaker than CRON_SECRET
// and why that's an accepted, documented tradeoff for this stage) — it can
// flip isPanicActive, so it is not treated as a harmless mirror route
// anymore.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await getCircuitBreakerStateFresh())
}

export async function POST(req: Request) {
  if (!isValidCircuitBreakerSyncRequest(req.headers.get("authorization"))) {
    return Response.json({ error: "Não autorizado" }, { status: 401 })
  }
  const body = await req.json()
  await syncCircuitBreakerStateFromClient(body)
  return Response.json(await getCircuitBreakerStateFresh())
}
