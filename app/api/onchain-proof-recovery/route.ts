import { NextRequest, NextResponse } from "next/server"
import { isValidCronRequest } from "@/lib/security/cron-auth"
import { getRedis, isKvConfigured } from "@/lib/kv"
import { RedisOnChainProofOutbox } from "@/lib/agent-framework/onchain-proof-outbox-redis"
import { DisabledOnChainProofBroadcaster, OnChainProofRecoveryService } from "@/lib/agent-framework/onchain-proof-recovery"
import { frameworkProofReconciler } from "@/lib/agent-framework/singletons"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isValidCronRequest(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (process.env.ONCHAIN_PROOF_RECOVERY_JOB_ENABLED !== "true") {
    return NextResponse.json({ status: "inactive", reason: "activation_not_authorized" }, { status: 503 })
  }
  if (!isKvConfigured()) return NextResponse.json({ error: "redis_not_configured" }, { status: 503 })

  const service = new OnChainProofRecoveryService(
    new RedisOnChainProofOutbox(getRedis()),
    frameworkProofReconciler,
    new DisabledOnChainProofBroadcaster(),
  )
  const result = await service.runOnce()
  return NextResponse.json(result)
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } })
}
