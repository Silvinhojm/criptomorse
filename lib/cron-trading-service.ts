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
  // RI-BANK-81 — fecha o elo diagnosticado no RI-BANK-80: resultado real
  // (USD, câmbio externo, não o preço interno do pool) de uma execução
  // bandit-decision, calculado por signAndExecute() e só presente quando
  // a estratégia do plano era "bandit-decision" e o lucro pôde ser
  // calculado (par suportado, câmbio externo disponível). Ausente em
  // qualquer outro caso -- nunca um valor fabricado/zero por omissão.
  banditProfitUsd?: number
  banditPriceSource?: string
  banditEnvironment?: "testnet" | "mainnet"
}

export interface CronTradingDependencies {
  store: CronTradingStateStore
  isMainnet(network: string): boolean
  blockIfPanickedFresh(): Promise<boolean>
  refreshBudget(): Promise<void>
  isBudgetExceeded(amountUsd: number): boolean
  authorizeRiskBox(box: CronRiskBox, amountUsd: number): Promise<{ allowed: boolean; reason: string }>
  signAndExecute(plan: CronTradingPlan): Promise<CronExecutionResult>
  // RI-BANK-81 — opcional de propósito: testes existentes (RI-BANK-34) que
  // não fornecem essa dependência continuam válidos: sem ela, o resultado
  // de uma execução bandit-decision simplesmente não é registrado de volta
  // no estado do Bandit, exatamente como já acontecia antes deste ticket.
  recordBanditResult?(pairLabel: string, profitUsd: number): Promise<void>
  // RI-BANK-102 — cofre de lucros: callback opcional disparado com o MESMO
  // lucro confirmado que alimenta recordBanditResult (câmbio externo real,
  // RI-BANK-81). Quando presente, o serviço move 50% para a Caixa B e
  // reinveste 50% na Caixa A. Ausente → comportamento RI-BANK-12 antigo
  // (lucro integral na B, nada na A) preservado para testes legados.
  registrarLucroCofre?(lucroUsd: number, origemOperacao: string): Promise<void>
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

      // RI-BANK-81 — fecha o elo diagnosticado no RI-BANK-80: só realimenta
      // o aprendizado do Bandit quando a execução foi real (executed=true,
      // não synthetic), a estratégia do plano é explicitamente
      // "bandit-decision" (nunca para planos manuais), e signAndExecute()
      // conseguiu calcular um lucro real (câmbio externo disponível, par
      // suportado) -- ausência de qualquer uma dessas condições
      // simplesmente não registra nada, nunca fabrica um valor.
      if (executed && claimed.strategy === "bandit-decision" && execution.banditProfitUsd !== undefined && this.dependencies.recordBanditResult) {
        try {
          await this.dependencies.recordBanditResult(`${claimed.fromToken}→${claimed.toToken}`, execution.banditProfitUsd)
        } catch (error) {
          // O swap já aconteceu e já foi liquidado on-chain (transitionPlan
          // acima já persistiu "completed") -- uma falha aqui não desfaz
          // isso nem deve fazer a resposta do cron parecer que a execução
          // falhou. Só o aprendizado do Bandit fica pendente até a próxima
          // execução bem-sucedida.
          console.error("[RI-BANK-81] recordBanditResult failed after a completed execution", error)
        }
      }

      // RI-BANK-102 — cofre de lucros: disparo automático A→B. Mesmo critério
      // e mesmo valor do RI-BANK-81 (câmbio externo real confirmado). Só
      // ocorre com lucro POSITIVO confirmado (perda nunca move; quem decide
      // devolver do cofre é o operador humano, rota ADMIN_PANIC_KEY).
      if (
        executed &&
        claimed.strategy === "bandit-decision" &&
        execution.banditProfitUsd !== undefined &&
        execution.banditProfitUsd > 0 &&
        this.dependencies.registrarLucroCofre
      ) {
        try {
          await this.dependencies.registrarLucroCofre(execution.banditProfitUsd, `cron:${claimed.id}`)
        } catch (error) {
          // Mesma filosofia defética: a execução já liquidou on-chain; um
          // erro de contabilidade de cofre não deve reverter nem parecer
          // falha do cron — segue log, fica visível.
console.error("[RI-BANK-102] registrarLucroCofre failed after a completed execution", error)
        }
      }

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
