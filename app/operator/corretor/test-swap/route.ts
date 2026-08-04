import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import { blockIfPanicked, getCircuitBreakerStateFresh } from "@/lib/circuit-breaker"
import { executeCronPlanWithKms } from "@/lib/cron-trading-runtime"
import { RedisCronTradingStateStore, type CronTradingPlan } from "@/lib/cron-trading-state"
import { cronManualTestRateLimitKvKey, getRedis, isKvConfigured } from "@/lib/kv"
import { authorizeRiskBoxTradeFresh } from "@/lib/risk-boxes"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"
import { initializeTradingBudgetDailyLimit, isBudgetExceeded } from "@/lib/trading-budget"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Config lock: a mainnet build must fail while this test-only route exists.
// This is deliberately independent from the hard-coded request validation.
if (process.env.NETWORK_MODE?.trim().toLowerCase() === "mainnet") {
  throw new Error("manual_test_swap_route_forbidden_in_mainnet_build")
}

const RATE_LIMIT_SECONDS = 15 * 60
const EXACT_AMOUNT = "0.10"
const ALLOWED_FIELDS = new Set(["network", "pair", "amountIn", "direction", "confirm"])

type ManualTestPayload = {
  network: "arc-testnet"
  pair: "USDC/EURC"
  amountIn: "0.10"
  direction: "USDC_TO_EURC"
  confirm: true
}

export async function POST(request: NextRequest) {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  let payload: ManualTestPayload
  try {
    payload = validatePayload(await request.json())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payload inválido" }, { status: 400 })
  }

  if (!isKvConfigured()) {
    return NextResponse.json({ error: "Redis indisponível; teste manual bloqueado" }, { status: 503 })
  }

  const timestamp = Date.now()
  const invocationId = randomUUID()
  const manualDispatchRef = `manual-test:${timestamp}:${invocationId}`
  const actor = "admin-bearer"
  const redis = getRedis()
  const store = new RedisCronTradingStateStore(redis)

  try {
    // Global production rate limit. SET NX EX is atomic across instances.
    const acquired = await redis.set(cronManualTestRateLimitKvKey(), invocationId, {
      nx: true,
      ex: RATE_LIMIT_SECONDS,
    })
    if (!acquired) {
      return NextResponse.json({ error: "Rate limit: aguarde 15 minutos" }, { status: 429 })
    }

    // Same fresh financial gates used by the cron, except route authorization:
    // this dispatch is the evidence from which that authorization is created.
    if (await store.getKillSwitch()) throw new Error("cron_kill_switch_active")
    await getCircuitBreakerStateFresh()
    if (blockIfPanicked()) throw new Error("global_circuit_breaker_active")
    await initializeTradingBudgetDailyLimit()
    if (isBudgetExceeded(0.1)) throw new Error("trading_budget_exceeded")
    const risk = await authorizeRiskBoxTradeFresh("A", 0.1)
    if (!risk.allowed) throw new Error(`risk_box_blocked:${risk.reason}`)

    await store.appendAudit({
      timestamp,
      invocationId,
      planId: manualDispatchRef,
      mode: "mode_1",
      outcome: "manual_test_execution_started",
      reason: "all_manual_test_gates_passed",
      source: "manual-test",
      actor,
      manualDispatchRef,
      payload,
    })

    const plan: CronTradingPlan = {
      id: manualDispatchRef,
      network: "arc",
      fromToken: "USDC",
      toToken: "EURC",
      strategy: "manual-test",
      riskBox: "A",
      amountUsd: 0.1,
      status: "processing",
      materialFingerprint: "manual-test",
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: 1,
    }
    const execution = await executeCronPlanWithKms(plan)
    // RI-BANK-44: execução sintética NÃO é sucesso real — sem transação on-chain.
    // O critério de aceite do RI-BANK-39 exige transação confirmada; synthetic → 409.
    if (!execution.success || !execution.settled || execution.synthetic) {
      const reason = execution.synthetic
        ? `manual_test_execution_synthetic:${execution.reason ?? "synthetic_fallback_no_onchain_tx"}`
        : `manual_test_execution_failed:${execution.reason ?? "unknown"}`
      throw new Error(reason)
    }

    await store.appendAudit({
      timestamp: Date.now(),
      invocationId,
      planId: manualDispatchRef,
      mode: "mode_1",
      outcome: "manual_test_executed",
      reason: "execution_completed",
      txHash: execution.txHash ?? undefined,
      source: "manual-test",
      actor,
      manualDispatchRef,
      payload,
      synthetic: false,
    })

    return NextResponse.json({
      ok: true,
      success: true,
      settled: true,
      synthetic: false,
      canonicalSettlement: true,
      settlementStatus: "confirmed",
      txHash: execution.txHash ?? null,
      manualDispatchRef,
      timestamp,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    try {
      await store.appendAudit({
        timestamp: Date.now(), invocationId, planId: manualDispatchRef,
        mode: "mode_2", outcome: "manual_test_blocked_or_failed", reason,
        source: "manual-test", actor, manualDispatchRef, payload,
        synthetic: reason.includes("synthetic"),
      })
    } catch {
      // Never relax the failure merely because the audit sink also failed.
    }
    return NextResponse.json({
      ok: false,
      success: false,
      settled: false,
      synthetic: reason.includes("synthetic"),
      canonicalSettlement: false,
      settlementStatus: "failed",
      txHash: null,
      reason,
      manualDispatchRef,
      timestamp,
    }, { status: 409 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 })
}

function validatePayload(raw: unknown): ManualTestPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Payload inválido")
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !ALLOWED_FIELDS.has(key))) throw new Error("Campo não permitido")
  // Logic lock: these values are literal and cannot come from config/env.
  if (value.network !== "arc-testnet") throw new Error("network deve ser arc-testnet")
  if (value.pair !== "USDC/EURC") throw new Error("pair deve ser USDC/EURC")
  if (value.direction !== "USDC_TO_EURC") throw new Error("direction deve ser USDC_TO_EURC")
  if (value.amountIn !== EXACT_AMOUNT) throw new Error("amountIn deve ser exatamente 0.10")
  if (value.confirm !== true) throw new Error("confirm:true é obrigatório")
  return value as ManualTestPayload
}
