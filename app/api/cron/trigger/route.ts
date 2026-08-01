import { NextRequest, NextResponse } from "next/server"
import { isValidCronRequest } from "@/lib/security/cron-auth"
import { getCircuitBreakerStateFresh } from "@/lib/circuit-breaker"

// RI-BANK-4 Stage 2 — authenticated entry point for the eventual scheduled
// automation (GitHub Actions workflow, currently created but not
// activated — see .github/workflows/cron-trigger.yml).
//
// SCOPE OF THIS STAGE: auth gate + circuit breaker gate only. This endpoint
// does NOT call any real trading function yet (executarCicloAgentes,
// executarPacotes, retryPendingProofs, etc.) — wiring it to real execution
// is Stage 1's "Camada 2" (D7), which depends on decisions 3, 4 and 5 from
// RI-BANK-4-STAGE-1-DESIGN-INVESTIGATION-CLAUDE-CODE.md that have not been
// answered yet (which functions to call, testnet-only vs mainnet scope, and
// the per-invocation operation cap). Calling real execution here without
// those answers would recreate the "second parallel trading cycle" risk
// D3 identified. Until Camada 2 is decided, this route only proves the
// safe entry path (no hardcoded secret fallback, timing-safe compare,
// circuit breaker checked fresh from disk before anything else runs).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isValidCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const cb = await getCircuitBreakerStateFresh()
  if (cb.isPanicActive) {
    return NextResponse.json({
      executed: false,
      reason: `circuit breaker ativo (pânico desde ${cb.panicTimestamp}): ${cb.panicReason}`,
    })
  }

  return NextResponse.json({
    executed: false,
    reason: "auth e circuit breaker OK — nenhuma ação de trading conectada ainda (Camada 2 pendente de decisão)",
  })
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}
