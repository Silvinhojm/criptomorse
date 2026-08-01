import { loadPositionsState, savePositionsState } from "@/lib/persistence"
import { isValidPositionsSyncRequest } from "@/lib/security/cron-auth"

// RI-BANK-5 Stage 2B — server-side mirror of open positions (Redis Hash,
// field = position.id). Same pattern as
// app/api/circuit-breaker/state/route.ts: GET is unauthenticated
// (read-only, no ability to affect trading), POST requires a dedicated
// Bearer secret (isValidPositionsSyncRequest) since it can create/overwrite
// position records the trading engine may act on. Unlike the circuit
// breaker's Stage-2 history, this route is authenticated from its very
// first version — no residual-risk window this time.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await loadPositionsState())
}

export async function POST(req: Request) {
  if (!isValidPositionsSyncRequest(req.headers.get("authorization"))) {
    return Response.json({ error: "Não autorizado" }, { status: 401 })
  }
  const body = await req.json()
  const positions = body?.positions ?? {}
  const deleteIds: string[] = Array.isArray(body?.deleteIds) ? body.deleteIds : []
  const ok = await savePositionsState(positions, deleteIds)
  if (!ok) return Response.json({ error: "Falha ao persistir" }, { status: 502 })
  return Response.json(await loadPositionsState())
}
