import type { AgentProposal } from "../../agent-framework/IAgent"
import type { IExecutor, ExecutionResult } from "../../agent-framework/IExecutor"
import type { PolicyEngine } from "../../agent-framework/policy-engine"
import { evaluateMissionAction, isActionAffordable } from "./core/mission-engine"
import { applyMissionOutcome } from "./core/simulated-wallet"
import type { MissionScenario, PlayerAction, SimulatedWalletState } from "./core/types"
import { NO_REAL_ASSET_POLICY, SIMULATED_WALLET_ONLY_POLICY } from "./education-policy"

/**
 * Field names that would indicate a proposal is trying to reach real
 * trading machinery. This is a STRUCTURAL guard, independent of the
 * NO_REAL_ASSET_POLICY flag below -- it rejects the proposal regardless of
 * whether that flag happens to be enabled, so disabling the flag can never
 * open this specific hole. See Stage 3 report, bypass-attempt tests.
 */
const FORBIDDEN_PROPOSAL_PARAM_KEYS = [
  "fromToken", "toToken", "pregueiro", "rede", "poolAddress", "dex", "direcao", "amountUsd",
] as const

export type EducationProposalParams = {
  readonly scenario: MissionScenario
  readonly wallet: SimulatedWalletState
  readonly playerAction: PlayerAction
  readonly resolvedAt: number
}

function readEducationParams(proposal: AgentProposal): EducationProposalParams | null {
  const params = proposal.params as unknown as Partial<EducationProposalParams>
  if (!params.scenario || !params.wallet || !params.playerAction || typeof params.resolvedAt !== "number") return null
  return params as EducationProposalParams
}

/**
 * IExecutor for the education domain. Calls the pure core engine
 * (lib/adapters/education/core/) implemented in Stage 2 -- never
 * reimplements mission evaluation logic here. Never imports
 * TradingAdapter, Pregão, or anything outside lib/agent-framework and
 * lib/adapters/education/.
 */
export class EducationAdapter implements IExecutor {
  readonly name = "EducationAdapter"
  private readonly policyEngine: PolicyEngine

  constructor(policyEngine: PolicyEngine) {
    this.policyEngine = policyEngine
  }

  canExecute(proposal: AgentProposal): { allowed: boolean; reason: string } {
    if (!this.policyEngine.isAllowed(NO_REAL_ASSET_POLICY)) {
      return { allowed: false, reason: "NO_REAL_ASSET_POLICY is disabled -- refusing to execute any education proposal while this protection is off" }
    }
    if (!this.policyEngine.isAllowed(SIMULATED_WALLET_ONLY_POLICY)) {
      return { allowed: false, reason: "SIMULATED_WALLET_ONLY_POLICY is disabled -- refusing to execute any education proposal while this protection is off" }
    }
    for (const key of FORBIDDEN_PROPOSAL_PARAM_KEYS) {
      if (key in (proposal.params ?? {})) {
        return { allowed: false, reason: `Proposal contains forbidden real-asset field "${key}" -- the education domain never touches real trading params` }
      }
    }
    const params = readEducationParams(proposal)
    if (!params) {
      return { allowed: false, reason: "Missing scenario/wallet/playerAction/resolvedAt in proposal params" }
    }
    const affordable = isActionAffordable(params.wallet, params.playerAction)
    if (!affordable.affordable) {
      return { allowed: false, reason: affordable.reason }
    }
    return { allowed: true, reason: "" }
  }

  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    try {
      const params = readEducationParams(proposal)
      if (!params) {
        return { success: false, action: proposal.action, errorMsg: "Missing scenario/wallet/playerAction/resolvedAt in proposal params" }
      }
      const outcome = evaluateMissionAction(params.scenario, params.wallet, params.playerAction, params.resolvedAt)
      const updatedWallet = applyMissionOutcome(params.wallet, outcome)
      return {
        success: true,
        action: params.playerAction.kind,
        // Fictional currency units (cents -> display units). Never real money.
        profit: outcome.financialResultCents / 100,
        gasCost: 0,
        // No dispatchStatus/settlementStatus/isProvisional set: this is a
        // complete, non-provisional, instantaneous simulated outcome, not a
        // dispatched transaction awaiting settlement.
        details: {
          fictional: true,
          domain: "education",
          scenarioId: String(params.scenario.scenarioId),
          outcome,
          updatedWallet,
        },
      }
    } catch (e) {
      return {
        success: false,
        action: proposal.action,
        errorMsg: e instanceof Error ? e.message : String(e),
      }
    }
  }

  estimateCost(_proposal: AgentProposal): number {
    return 0
  }
}
