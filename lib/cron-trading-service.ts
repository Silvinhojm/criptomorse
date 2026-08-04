import { randomUUID } from "node:crypto"

import type { CronRiskBox, CronTradingPlan, CronTradingStateStore } from "@/lib/cron-trading-state"

export interface CronExecutionResult {
  success: boolean
  txHash?: string | null
  reason?: string
  // RI-BANK-44: marcadores de settlement propagados de ponta a ponta.
  // synthetic=true → NÃO há transação on-chain real; a execução não deve ser
  // reportada como sucesso (Greg Sti tratamento do cron e da teste) — success só
  // significa "processado", settled significa "confirmado on-chain".
  synthetic?: boolean
  settled?: boolean
  canonicalSettlement?: boolean
  settlementStatus?: "synthetic" | "confirmed" | "failed"
}

export interface CronTradingDependencies {
  store: CronTradingStateStore
  isMainnet(network: string): boolean
  blockIfPanickedFresh(): Promise<boolean>
  refreshBudget(): Promise<void>
  isBudgetExceeded(amountUsd: number): boolean
  authorizeRiskBox(box: CronRiskBox, amountUsd: number): Promise<{ allowed: boolean; reason: string }>
  signAndExecute(plan: CronTradingPlan): Promise<CronExecutionResult>
  now?: () => number
  invocationId?: () => string
}

export interface CronRunResult {
  executed: boolean
  mode: "mode_1" | "mode_2"
  reason: string
  planId?: string
  txHash?: string
  synthetic?: boolean
}

/**
 * Executes at most one persisted plan. There is deliberately no loop and no
 * retry: every invocation reaches one terminal response and returns.
 */
export class CronTradingService {
  constructor(private readonly dependencies: CronTradingDependencies) {}

  async runOnce(): Promise<CronRunResult> {
    const now = this.dependencies.now ?? Date.now
    const invocationId = (this.dependencies.invocationId ?? randomUUID)()
    const store = this.dependencies.store

    // Structural safety invariant: this is the first external state read.
    // Redis failure also fails closed through the surrounding catch.
    try {
      if (await store.getKillSwitch()) {
        return await this.block(invocationId, "cron_kill_switch_active", now())
      }

      if (await this.dependencies.blockIfPanickedFresh()) {
        return await this.block(invocationId, "global_circuit_breaker_active", now())
      }

      // Read the persistent confirmation before the plan. The target network
      // can only be evaluated after the single plan itself is loaded.
      const mainnetConfirmed = await store.getMainnetConfirmed()
      const plan = await store.getPlan()
      if (!plan) return await this.block(invocationId, "cron_plan_missing", now())
      if (plan.status !== "ready") {
        return await this.block(invocationId, `cron_plan_not_ready:${plan.status}`, now(), plan)
      }
      if (this.dependencies.isMainnet(plan.network) && !mainnetConfirmed) {
        return await this.block(invocationId, "cron_mainnet_not_confirmed", now(), plan)
      }
      if (!await store.isRouteAuthorized(plan)) {
        return await this.block(invocationId, "cron_route_not_authorized_or_materially_changed", now(), plan)
      }

      const claimed = await store.claimPlan(plan.id, invocationId, now())
      if (!claimed) return await this.block(invocationId, "cron_plan_already_claimed", now(), plan)
      if (claimed.materialFingerprint !== plan.materialFingerprint) {
        return await this.blockClaimed(invocationId, claimed, "cron_plan_changed_during_claim", now())
      }

      await this.dependencies.refreshBudget()
      if (this.dependencies.isBudgetExceeded(claimed.amountUsd)) {
        return await this.blockClaimed(invocationId, claimed, "trading_budget_exceeded", now())
      }

      const riskAuthorization = await this.dependencies.authorizeRiskBox(claimed.riskBox, claimed.amountUsd)
      if (!riskAuthorization.allowed) {
        return await this.blockClaimed(invocationId, claimed, `risk_box_blocked:${riskAuthorization.reason}`, now())
      }

      // A durable pre-execution audit entry is mandatory. If it cannot be
      // written, execution is blocked rather than becoming unaudited.
      await store.appendAudit({
        timestamp: now(), invocationId, planId: claimed.id, mode: "mode_1",
        outcome: "execution_started", reason: "all_preflight_gates_passed",
      })

      let execution: CronExecutionResult
      try {
        execution = await this.dependencies.signAndExecute(claimed)
      } catch (error) {
        execution = { success: false, reason: error instanceof Error ? error.message : String(error) }
      }

      // RI-BANK-44: synthetic não é execução real — nunca vira completed.
      // success = processado; settled/canonicalSettlement = confirmado on-chain.
      const synthetic = execution.synthetic === true
      const executed = execution.success && !synthetic
      const reason = !execution.success
        ? `execution_failed:${execution.reason ?? "unknown"}`
        : synthetic
          ? "execution_synthetic_no_onchain_tx"
          : "execution_completed"
      const transitioned = await store.transitionPlan(
        claimed.id,
        invocationId,
        executed ? "completed" : "failed",
        reason,
        execution.txHash ?? "",
        now(),
      )
      if (!transitioned) throw new Error("cron_plan_terminal_transition_rejected")

      await store.appendAudit({
        timestamp: now(), invocationId, planId: claimed.id, mode: executed ? "mode_1" : "mode_2",
        outcome: executed ? "executed" : synthetic ? "execution_synthetic" : "execution_failed",
        reason, txHash: execution.txHash ?? undefined,
        synthetic,
      })
      return {
        executed,
        mode: executed ? "mode_1" : "mode_2",
        reason,
        planId: claimed.id,
        txHash: execution.txHash ?? undefined,
        synthetic,
      }
    } catch (error) {
      const reason = `cron_fail_closed:${error instanceof Error ? error.message : String(error)}`
      try {
        await store.appendAudit({
          timestamp: now(), invocationId, mode: "mode_2", outcome: "fail_closed", reason,
        })
      } catch {
        // Redis may be the failing dependency. Never relax the block merely
        // because its audit sink is unavailable.
      }
      return { executed: false, mode: "mode_2", reason }
    }
  }

  private async block(
    invocationId: string,
    reason: string,
    timestamp: number,
    plan?: CronTradingPlan,
  ): Promise<CronRunResult> {
    await this.dependencies.store.appendAudit({
      timestamp, invocationId, planId: plan?.id, mode: "mode_2", outcome: "blocked", reason,
    })
    return { executed: false, mode: "mode_2", reason, planId: plan?.id }
  }

  private async blockClaimed(
    invocationId: string,
    plan: CronTradingPlan,
    reason: string,
    timestamp: number,
  ): Promise<CronRunResult> {
    const transitioned = await this.dependencies.store.transitionPlan(plan.id, invocationId, "blocked", reason, "", timestamp)
    if (!transitioned) throw new Error("cron_plan_block_transition_rejected")
    return this.block(invocationId, reason, timestamp, plan)
  }
}
