import { JsonRpcProvider } from "ethers"
import { NextRequest } from "next/server"

import {
  ARC_BANDIT_PAIRS,
  BANDIT_TRADE_AMOUNT,
  decideBanditPair,
} from "@/lib/bandit-state-redis"
import { RedisCronTradingStateStore, type CronTradingPlanInput } from "@/lib/cron-trading-state"
import { getRedis, isKvConfigured, banditStateKvKey } from "@/lib/kv"
import { NETWORKS } from "@/lib/real-swap-executor"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-79 — o Bandit decide de verdade (par por peso, elegibilidade real
// contra liquidez) e ESCREVE um cron-plan, mas nunca dispara execução. Não
// aceita corpo nenhum na requisição -- toda a decisão vem do estado
// server-side já persistido (RI-BANK-76) e da checagem de liquidez ao vivo
// (RI-BANK-70/72/74/78); não há input externo nenhum para sanitizar. Depois
// de escrito, o plano ainda precisa de `route.authorize` manual (como
// sempre) antes que um disparo real (POST /api/cron/trigger, sempre humano)
// possa executá-lo -- essa rota não chama nem se aproxima de
// executeCronPlanWithKms.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BANDIT_DECISION_STRATEGY = "bandit-decision"
const BANDIT_RISK_BOX = "A"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }
  if (!isKvConfigured()) {
    return json({ ok: false, error: "redis_not_configured" }, 503)
  }

  try {
    const redis = getRedis()
    const provider = new JsonRpcProvider(NETWORKS.arc.rpcUrl, NETWORKS.arc.chainId, { staticNetwork: true })

    const decision = await decideBanditPair(provider, redis, banditStateKvKey(), BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS)

    const evaluatedSummary = decision.evaluated.map(e => ({
      pair: e.pair.pair,
      eligible: e.eligible,
      kind: e.check.kind,
      reason: e.check.reason,
      stableReserveUsd: e.check.stableReserveUsd,
    }))

    if (!decision.decided || !decision.pair) {
      return json({
        ok: true,
        decided: false,
        reason: decision.reason ?? "no_eligible_pair",
        evaluated: evaluatedSummary,
        timestamp: Date.now(),
      })
    }

    const chosen = decision.pair
    const planInput: CronTradingPlanInput = {
      id: `cron-plan-arc-bandit-${chosen.fromToken.toLowerCase()}-${chosen.toToken.toLowerCase()}`,
      network: "arc",
      fromToken: chosen.fromToken.toUpperCase(),
      toToken: chosen.toToken.toUpperCase(),
      strategy: BANDIT_DECISION_STRATEGY,
      riskBox: BANDIT_RISK_BOX,
      amountUsd: BANDIT_TRADE_AMOUNT,
    }

    const store = new RedisCronTradingStateStore(redis)
    const savedPlan = await store.savePlan(planInput)

    return json({
      ok: true,
      decided: true,
      chosenPair: chosen.pair,
      plan: savedPlan,
      evaluated: evaluatedSummary,
      timestamp: Date.now(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    if (message === "cron_plan_processing") {
      return json({ ok: false, error: "cron_plan_processing" }, 409)
    }
    console.error("[RI-BANK-79] bandit decision failed", error)
    return json({ ok: false, error: "bandit_decision_failed", detail: message }, 500)
  }
}

export async function GET(): Promise<Response> {
  return json({ error: "method_not_allowed" }, 405)
}
