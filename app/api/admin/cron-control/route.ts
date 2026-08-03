import { NextRequest, NextResponse } from "next/server"

import { RedisCronTradingStateStore, type CronTradingPlanInput } from "@/lib/cron-trading-state"
import { getRedis, isKvConfigured } from "@/lib/kv"
import { NETWORKS, type NetworkKey } from "@/lib/real-swap-executor"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  if (!isKvConfigured()) {
    return NextResponse.json({ error: "Redis indisponível; controle do cron bloqueado" }, { status: 503 })
  }

  try {
    const body = await request.json() as Record<string, unknown>
    const store = new RedisCronTradingStateStore(getRedis())

    if (body.action === "plan.upsert") {
      const input = validatePlan(body.plan)
      return NextResponse.json({ success: true, plan: await store.savePlan(input) })
    }
    if (body.action === "route.authorize") {
      if (typeof body.planId !== "string" || typeof body.manualDispatchRef !== "string") {
        return NextResponse.json({ error: "planId e manualDispatchRef são obrigatórios" }, { status: 400 })
      }
      const authorization = await store.authorizeCurrentRoute(body.planId, body.manualDispatchRef)
      return NextResponse.json({ success: true, authorization })
    }
    if (body.action === "mainnet.set") {
      if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled deve ser boolean" }, { status: 400 })
      await store.setMainnetConfirmed(body.enabled)
      return NextResponse.json({ success: true, mainnetConfirmed: body.enabled })
    }
    if (body.action === "kill-switch.set") {
      if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled deve ser boolean" }, { status: 400 })
      await store.setKillSwitch(body.enabled)
      return NextResponse.json({ success: true, killSwitch: body.enabled })
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno" }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}

function validatePlan(raw: unknown): CronTradingPlanInput {
  if (!raw || typeof raw !== "object") throw new Error("plan_required")
  const plan = raw as Record<string, unknown>
  const network = typeof plan.network === "string" ? plan.network : ""
  const config = NETWORKS[network as NetworkKey]
  if (!config) throw new Error("cron_plan_unknown_network")
  const fromToken = typeof plan.fromToken === "string" ? plan.fromToken.toUpperCase() : ""
  const toToken = typeof plan.toToken === "string" ? plan.toToken.toUpperCase() : ""
  if (!(config.tokens as Record<string, string>)[fromToken] || !(config.tokens as Record<string, string>)[toToken]) {
    throw new Error("cron_plan_token_not_configured")
  }
  return {
    id: typeof plan.id === "string" ? plan.id : "",
    network,
    fromToken,
    toToken,
    strategy: typeof plan.strategy === "string" ? plan.strategy : "",
    riskBox: plan.riskBox as "A" | "B",
    amountUsd: Number(plan.amountUsd),
  }
}
