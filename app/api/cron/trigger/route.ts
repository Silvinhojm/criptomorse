import { NextRequest, NextResponse } from "next/server"
import { isValidCronRequest } from "@/lib/security/cron-auth"
import { createProductionCronTradingService } from "@/lib/cron-trading-runtime"

// RI-BANK-34 — authenticated, one-plan-per-invocation cron entry point.
// The GitHub workflow remains manual-only. All durable gates, the lease and
// the terminal audit are delegated to CronTradingService; this route has no
// loop and no autonomous retry.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isValidCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const result = await createProductionCronTradingService().runOnce()
    return NextResponse.json(result, { status: result.reason.startsWith("cron_fail_closed:cron_redis_unavailable") ? 503 : 200 })
  } catch (error) {
    return NextResponse.json({
      executed: false,
      mode: "mode_2",
      reason: `cron_fail_closed:${error instanceof Error ? error.message : String(error)}`,
    }, { status: 503 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}
