import { createEducationCoordinator } from "./education-coordinator"
import { EducationPlayerAgent, EducationConfirmationAgent } from "./education-agent"
import { buildMissionProposal } from "./education-proposal"
import { createSimulatedWallet } from "./core/simulated-wallet"
import { FRIEND_TIP_SCENARIO } from "./core/scenario-catalog"
import { lastTrajectoryStepId } from "./core/mission-engine"
import type { SimulatedWalletId, PlayerAction } from "./core/types"
import { NO_REAL_ASSET_POLICY, SIMULATED_WALLET_ONLY_POLICY } from "./education-policy"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export async function runEducationFlowTests(): Promise<void> {
  const exitStepId = lastTrajectoryStepId(FRIEND_TIP_SCENARIO) as any

  // ================================================================
  // Full happy path: Coordinator -> Knowledge (simulated, provided) ->
  // Policy -> Voting (player + structural confirmation) -> EducationAdapter
  // -> Audit -> DecisionReport
  // ================================================================
  {
    const { coordinator, audit, intentPublisher } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-1"))
    coordinator.registerAgent(new EducationConfirmationAgent("confirmation-1"))

    const wallet = createSimulatedWallet("w1" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId }
    const proposal = buildMissionProposal("player-1", FRIEND_TIP_SCENARIO, wallet, action, 1_000_000)

    const result = await coordinator.submitProposal(proposal)

    expect(result.kind === "decision", `must be a clean decision, not operational-degraded: got kind=${result.kind}`)
    expect(result.consensus.approved === true, `consensus must approve: ${result.consensus.reason}`)
    expect(result.executionResult !== undefined, "executionResult must be present")
    expect(result.executionResult!.success === true, `execution must succeed: ${result.executionResult!.errorMsg}`)

    const details = result.executionResult!.details as any
    expect(details.fictional === true, "ExecutionResult.details.fictional must be true")
    expect(details.domain === "education", "ExecutionResult.details.domain must be education")
    expect(details.outcome.financialResultCents === 150_000 * (0.17 / 1.0 - 1), "financial result must match the deterministic formula")
    expect(details.updatedWallet.balanceCents === wallet.balanceCents + details.outcome.financialResultCents, "updated wallet balance must reflect the outcome")

    // --- Audit ---
    const recent = audit.getRecent(1)
    expect(recent.length === 1, "one audit entry must be recorded")
    expect(recent[0]!.result?.success === true, "audit entry must record success")

    // --- DecisionReport ---
    const intentId = `intent_player-1_${proposal.timestamp}`
    const record = intentPublisher.getRecord(intentId)
    expect(record !== null, "intent record must exist")
    const dp = record!.decisionReport
    expect(dp !== undefined, "DecisionReport must be saved")
    expect(dp!.outcome === "approved", "DecisionReport.outcome must be approved")
    expect(dp!.auditStatus === "recorded", "DecisionReport.auditStatus must be recorded")

    // --- Special-attention point: KnowledgeReport must be clearly marked simulated ---
    expect(dp!.knowledgeStatus === "provided", `knowledgeStatus must be "provided" (the education proposal supplies its own report): got ${dp!.knowledgeStatus}`)
    expect(dp!.knowledge !== undefined, "DecisionReport.knowledge must be populated")
    const warnings = dp!.knowledge!.warnings
    expect(warnings.some((w) => w.startsWith("SIMULATED_DATA")), `knowledge.warnings must contain an explicit SIMULATED_DATA marker, got: ${JSON.stringify(warnings)}`)

    // --- anchorStatus / onChainStatus: must never resolve to a real anchor ---
    expect(dp!.onChainStatus === undefined, `onChainStatus must stay unset (closest achievable "not_required" given the real schema) -- got ${dp!.onChainStatus}`)
    expect(dp!.onChainHash === undefined && dp!.onChainTx === undefined, "no on-chain hash/tx may ever be produced for an education decision")
  }

  // ================================================================
  // DECLINE path: zero financial impact, still a clean approved flow
  // ================================================================
  {
    const { coordinator } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-2"))
    coordinator.registerAgent(new EducationConfirmationAgent("confirmation-2"))

    const wallet = createSimulatedWallet("w2" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const proposal = buildMissionProposal("player-2", FRIEND_TIP_SCENARIO, wallet, { kind: "DECLINE" }, 1_000_001)
    const result = await coordinator.submitProposal(proposal)

    expect(result.kind === "decision" && result.consensus.approved === true, "DECLINE must also resolve as a clean approved decision")
    const details = result.executionResult!.details as any
    expect(details.outcome.financialResultCents === 0, "DECLINE must have zero financial impact")
  }

  // ================================================================
  // Bypass attempt 1: structural -- forbidden real-asset field present
  // ================================================================
  {
    const { coordinator } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-3"))
    coordinator.registerAgent(new EducationConfirmationAgent("confirmation-3"))

    const wallet = createSimulatedWallet("w3" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId }
    const proposal = buildMissionProposal("player-3", FRIEND_TIP_SCENARIO, wallet, action, 1_000_002)
    // Attempted bypass: smuggle a real-asset field into params.
    ;(proposal.params as any).fromToken = "USDC"

    const result = await coordinator.submitProposal(proposal)
    expect(result.kind === "decision", "must still be a clean decision result")
    expect(result.consensus.approved === false, "proposal carrying a forbidden real-asset field must be rejected")
    expect((result as any).executionResult === undefined || (result as any).executionResult?.success !== true, "must not execute")
  }

  // ================================================================
  // Bypass attempt 2: flag-based -- NO_REAL_ASSET_POLICY disabled
  // ================================================================
  {
    const { coordinator, policyEngine } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-4"))
    coordinator.registerAgent(new EducationConfirmationAgent("confirmation-4"))
    policyEngine.disable(NO_REAL_ASSET_POLICY)

    const wallet = createSimulatedWallet("w4" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId }
    const proposal = buildMissionProposal("player-4", FRIEND_TIP_SCENARIO, wallet, action, 1_000_003)
    const result = await coordinator.submitProposal(proposal)

    expect(result.consensus.approved === false, "disabling NO_REAL_ASSET_POLICY must block execution, not silently allow it")
  }

  // ================================================================
  // Bypass attempt 3: flag-based -- SIMULATED_WALLET_ONLY_POLICY disabled
  // ================================================================
  {
    const { coordinator, policyEngine } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-5"))
    coordinator.registerAgent(new EducationConfirmationAgent("confirmation-5"))
    policyEngine.disable(SIMULATED_WALLET_ONLY_POLICY)

    const wallet = createSimulatedWallet("w5" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId }
    const proposal = buildMissionProposal("player-5", FRIEND_TIP_SCENARIO, wallet, action, 1_000_004)
    const result = await coordinator.submitProposal(proposal)

    expect(result.consensus.approved === false, "disabling SIMULATED_WALLET_ONLY_POLICY must block execution, not silently allow it")
  }

  // ================================================================
  // Voting minimum: a single registered agent can never reach consensus
  // (Coordinator.MIN_AGREEING_AGENTS is hardcoded to 2) -- confirms the
  // Stage 3 finding empirically, not just by reading the source.
  // ================================================================
  {
    const { coordinator } = createEducationCoordinator()
    coordinator.registerAgent(new EducationPlayerAgent("player-6")) // only one agent registered

    const wallet = createSimulatedWallet("w6" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const proposal = buildMissionProposal("player-6", FRIEND_TIP_SCENARIO, wallet, { kind: "DECLINE" }, 1_000_005)
    const result = await coordinator.submitProposal(proposal)

    expect(result.consensus.approved === false, "a single registered agent must NOT reach consensus, confirming MIN_AGREEING_AGENTS=2 is enforced")
  }

  // ================================================================
  // Determinism of the full flow: same inputs -> same financial outcome
  // ================================================================
  {
    const { coordinator: c1 } = createEducationCoordinator()
    c1.registerAgent(new EducationPlayerAgent("player-7a"))
    c1.registerAgent(new EducationConfirmationAgent("confirmation-7a"))
    const { coordinator: c2 } = createEducationCoordinator()
    c2.registerAgent(new EducationPlayerAgent("player-7b"))
    c2.registerAgent(new EducationConfirmationAgent("confirmation-7b"))

    const wallet = createSimulatedWallet("w7" as SimulatedWalletId, FRIEND_TIP_SCENARIO.startingBalanceCents)
    const action: PlayerAction = { kind: "ACCEPT_TIP", amountCents: 150_000, leverageMultiplier: 1, exitStepId }
    const p1 = buildMissionProposal("player-7a", FRIEND_TIP_SCENARIO, wallet, action, 1_000_006)
    const p2 = buildMissionProposal("player-7b", FRIEND_TIP_SCENARIO, wallet, action, 1_000_006)

    const r1 = await c1.submitProposal(p1)
    const r2 = await c2.submitProposal(p2)

    const d1 = (r1.executionResult!.details as any).outcome.financialResultCents
    const d2 = (r2.executionResult!.details as any).outcome.financialResultCents
    expect(d1 === d2, "two independent Coordinator instances with identical inputs must produce identical financial outcomes")
  }
}

runEducationFlowTests()
