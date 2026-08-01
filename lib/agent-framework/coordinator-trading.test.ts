// RI-BANK-2 Stage 2 — coordinator-trading.test.ts
//
// Zero network calls, zero real transactions: builds a self-contained
// Coordinator with fully-fake dependencies (mirrors the pattern already
// used by lib/adapters/education/education-coordinator.ts). This test
// NEVER imports real-swap-executor.ts, corretor.ts, pregão.ts, or the
// real OnChainIntentPublisher/IntentPublisher classes -- the IExecutor and
// IIntentPublisher injected here are hand-written fakes that only ever
// touch in-memory state.

import { Coordinator } from "./coordinator"
import { Audit } from "./audit"
import { PolicyEngine } from "./policy-engine"
import type { IAgent, AgentProposal, AgentVote, AgentIdentity } from "./IAgent"
import type { IExecutor, ExecutionResult } from "./IExecutor"
import type { IIntentPublisher } from "./intent-types"
import type { IntentRecord, IntentFilter, IntentStatus } from "./intent-types"
import type { DecisionReport } from "./decision-report"
import type { KnowledgeRequest, KnowledgeReport } from "./knowledge-types"
import type { SettlementRecord } from "./settlement-registry"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// ── Fakes ──────────────────────────────────────────────────────────────

class AlwaysApproveAgent implements IAgent {
  constructor(readonly agentId: string) {}
  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: this.agentId, version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 1000 }
  }
  propose(): AgentProposal | null { return null }
  vote(proposal: AgentProposal): AgentVote {
    return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 80, reason: "test-approve", timestamp: Date.now() }
  }
  onFeedback(): void {}
}

/** Fake IExecutor shaped exactly like TradingAdapter's real return contract. */
class FakeTradingExecutor implements IExecutor {
  readonly name = "TradingAdapter"
  constructor(private readonly result: Partial<ExecutionResult> & { success: boolean }) {}
  canExecute(): { allowed: boolean; reason: string } { return { allowed: true, reason: "" } }
  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    return { action: proposal.action, profit: 0, gasCost: 0, ...this.result }
  }
  estimateCost(): number { return 0 }
}

/** Fake IIntentPublisher with an anchorDecision SPY -- never the real
 *  OnChainIntentPublisher, which always attempts network I/O (ethers RPC
 *  call or an HTTP fetch) as soon as it's invoked. This fake's
 *  anchorDecision only counts calls and returns a canned value; it never
 *  touches ethers, fetch, or any network stack. */
class SpyIntentPublisher implements IIntentPublisher {
  private records = new Map<string, IntentRecord>()
  anchorCallCount = 0
  anchorCalls: Array<{ id: string; report: DecisionReport }> = []

  async publish(intent: { id?: string; agentId: string; action: string; params: Record<string, unknown>; confidence: number; timestamp: number }): Promise<string> {
    const id = intent.id || `test_intent_${Date.now()}_${Math.random()}`
    this.records.set(id, { intent: { ...intent, id }, status: "CREATED", votes: [], createdAt: Date.now(), statusHistory: [{ status: "CREATED", timestamp: Date.now() }] })
    return id
  }
  getRecord(id: string): IntentRecord | null { return this.records.get(id) ?? null }
  list(filter?: IntentFilter): IntentRecord[] {
    let all = Array.from(this.records.values()).sort((a, b) => b.createdAt - a.createdAt)
    if (filter?.agentId) all = all.filter((r) => r.intent.agentId === filter.agentId)
    return all
  }
  updateStatus(id: string, status: IntentStatus): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.status = status
    return true
  }
  recordVote(id: string, vote: { agentId: string; approved: boolean; confidence: number; reputationWeight?: number; knowledgeWeight?: number; reason: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.votes.push({ ...vote, reputationWeight: vote.reputationWeight ?? 1, knowledgeWeight: vote.knowledgeWeight ?? 1 })
    return true
  }
  recordResult(id: string, result: { success: boolean; profit: number; txHash?: string; errorMsg?: string }): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.result = result
    return true
  }
  setDecisionReport(id: string, report: DecisionReport): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.decisionReport = report
    return true
  }
  subscribe(): () => void { return () => {} }
  /** SPY -- never a real anchor. Records the call and returns a canned,
   *  entirely fabricated result. No ethers, no fetch, no RPC. */
  async anchorDecision(id: string, report: DecisionReport): Promise<{ txHash: string; blockNumber: number; hash: string } | null> {
    this.anchorCallCount++
    this.anchorCalls.push({ id, report })
    return { txHash: "0xFAKE_ANCHOR_TX_NEVER_BROADCAST", blockNumber: 1, hash: "0xFAKE_HASH_NEVER_BROADCAST" }
  }
}

class SpyKnowledgeResolver {
  lastRequest: KnowledgeRequest | null = null
  async query(request: KnowledgeRequest): Promise<KnowledgeReport> {
    this.lastRequest = request
    return {
      canTrade: true, liquidity: 100, gasScore: 100, routeScore: 100, marketScore: 100, riskScore: 100,
      expectedValue: 1, confidenceModifier: 0, warnings: [], recommendations: [],
      sources: { liquidity: true, route: true, gas: true, price: true, history: true, reputation: true },
      timestamp: Date.now(),
    }
  }
}

function buildTradingTestCoordinator(executor: IExecutor) {
  const audit = new Audit("trading-test")
  const policyEngine = new PolicyEngine()
  const intentPublisher = new SpyIntentPublisher()
  const knowledge = new SpyKnowledgeResolver()
  const settlementRegistryCalls: SettlementRecord[] = []

  const coordinator = new Coordinator(
    { name: "TradingTestCoordinator", audit, policyEngine, intentPublisher, executor },
    {
      reputation: { getScore: () => 100 },
      knowledge,
      settlementRegistry: {
        registerPending: (record: SettlementRecord) => {
          settlementRegistryCalls.push(record)
          return record
        },
      },
      settlementReplay: { replayForCorrelationId: () => {} },
    },
  )

  return { coordinator, audit, policyEngine, intentPublisher, knowledge, settlementRegistryCalls }
}

function makeTradingProposal(agentId: string, action: "BUY" | "SELL", timestamp: number, extraParams?: Record<string, unknown>): AgentProposal {
  const fromToken = action === "BUY" ? "USDC" : "WETH"
  const toToken = action === "BUY" ? "WETH" : "USDC"
  return {
    id: `prop_${agentId}_${timestamp}`,
    agentId,
    action,
    // fromToken/toToken deliberately not both stables -- avoids the
    // default-enabled allowSyntheticRoutes network override block for
    // real networks (see policy-engine.ts DEFAULT_RULES).
    params: { fromToken, toToken, rede: "polygon", amountUsd: 10, ...extraParams },
    confidence: 80,
    timestamp,
  }
}

export async function runCoordinatorTradingTests(): Promise<void> {
  // ================================================================
  // [CORRETUDE] BUY happy path
  // ================================================================
  {
    const { coordinator, knowledge } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: true, dispatchStatus: "dispatched", settlementStatus: "dispatched", ordemId: "ordem_buy" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-a1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-a2"))

    const proposal = makeTradingProposal("agent-buy", "BUY", 2_000_000)
    const result = await coordinator.submitProposal(proposal)

    expect(result.kind === "decision", `must be a clean decision: got kind=${result.kind}`)
    expect(result.consensus.approved === true, `consensus must approve: ${result.consensus.reason}`)
    expect(result.executionResult!.success === true, "execution must succeed")
    expect(result.executionResult!.dispatchStatus === "dispatched", "dispatchStatus must be 'dispatched'")
    expect(result.executionResult!.isProvisional === true, "isProvisional must be true")
    expect(knowledge.lastRequest?.action === "BUY", "_classifyKnowledgeAction must resolve BUY as an economic action and query knowledge with it")
  }

  // ================================================================
  // [CORRETUDE] SELL happy path
  // ================================================================
  {
    const { coordinator, knowledge } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: true, dispatchStatus: "dispatched", settlementStatus: "dispatched", ordemId: "ordem_sell" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-b1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-b2"))

    const proposal = makeTradingProposal("agent-sell", "SELL", 2_000_001)
    const result = await coordinator.submitProposal(proposal)

    expect(result.kind === "decision" && result.consensus.approved === true, "SELL must also resolve as a clean approved decision")
    expect(result.executionResult!.success === true, "SELL execution must succeed")
    expect(knowledge.lastRequest?.action === "SELL", "_classifyKnowledgeAction must resolve SELL as an economic action")
  }

  // ================================================================
  // [CORRETUDE] Voting minimum (MIN_AGREEING_AGENTS=2) also applies to BUY/SELL
  // ================================================================
  {
    const { coordinator } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: true, dispatchStatus: "dispatched", settlementStatus: "dispatched" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-c1")) // only one agent registered

    const proposal = makeTradingProposal("agent-solo", "BUY", 2_000_002)
    const result = await coordinator.submitProposal(proposal)

    expect(result.consensus.approved === false, "a single registered agent must NOT reach consensus for BUY/SELL either, confirming no economic-action-specific bypass of MIN_AGREEING_AGENTS=2")
  }

  // ================================================================
  // [CORRETUDE] Adapter dispatch failure: feedback loop skipped, execution marked failed
  // ================================================================
  {
    const { coordinator } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: false, dispatchStatus: "failed", settlementStatus: "failed", isProvisional: false, errorMsg: "Pregão rejected dispatch: duplicate active order" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-d1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-d2"))

    const proposal = makeTradingProposal("agent-fail", "BUY", 2_000_003)
    const result = await coordinator.submitProposal(proposal)

    expect(result.kind === "decision", "adapter dispatch failure must still be a clean decision result, not an operational failure")
    expect(result.consensus.approved === true, "voting must have approved -- the failure is at the adapter, not consensus")
    expect(result.executionResult!.success === false, "executionResult.success must be false")
    expect(result.executionResult!.dispatchStatus === "failed", "dispatchStatus must be 'failed'")
  }

  // ================================================================
  // [GAP CONHECIDO] Provisional dispatch = "success" -- documents the
  // current dispatch-vs-settlement decoupling from RI-BANK-1 B1-01/B1-04.
  // This is NOT the desired end state; it documents what exists today.
  // ================================================================
  {
    const { coordinator, settlementRegistryCalls, intentPublisher } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: true, dispatchStatus: "dispatched", settlementStatus: "dispatched", ordemId: "ordem_provisional" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-e1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-e2"))

    const proposal = makeTradingProposal("agent-provisional", "BUY", 2_000_004)
    const result = await coordinator.submitProposal(proposal)

    expect(result.executionResult!.success === true, "[GAP] dispatch-only success is reported as success:true")
    expect(settlementRegistryCalls.length === 1, "[GAP] a provisional successful dispatch registers a pending settlement -- this is the Coordinator's only settlement-side bookkeeping at this point in time, not proof of liquidation")

    const intentId = `intent_agent-provisional_2000004`
    const record = intentPublisher.getRecord(intentId)
    expect(record?.decisionReport?.onChainStatus === "skipped", "[GAP] onChainStatus is 'skipped' for a provisional dispatch -- documents current behavior, not a statement that on-chain proof is intentionally unnecessary")
  }

  // ================================================================
  // [GAP CONHECIDO] DecisionAnchor never fires for a provisional dispatch
  // -- the direct, executable proof of RI-BANK-1 B1-03.
  // ================================================================
  {
    const { coordinator, intentPublisher } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: true, dispatchStatus: "dispatched", settlementStatus: "dispatched" }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-f1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-f2"))

    const proposal = makeTradingProposal("agent-anchor-gap", "BUY", 2_000_005)
    const result = await coordinator.submitProposal(proposal)

    expect(result.executionResult!.success === true, "execution must have succeeded for this scenario to be meaningful")
    // The coordinator's post-execution anchor call is fire-and-forget
    // (.then()/.catch(), never awaited) -- give the microtask queue a
    // turn so we're not asserting before it would have fired.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(intentPublisher.anchorCallCount === 0, `[GAP] anchorDecision must NEVER be called when the executor reports isProvisional:true -- this is the exact condition documented in RI-BANK-1 B1-03 as the reason DecisionAnchor never fires for real trading (TradingAdapter always returns isProvisional:true). Got ${intentPublisher.anchorCallCount} call(s).`)
  }

  // ================================================================
  // [CORRETUDE] Contrast case: a NON-provisional successful executor DOES
  // trigger anchorDecision. Proves the coordinator's conditional logic
  // genuinely hinges on isProvisional, not some unrelated reason -- the
  // gap above is a property of TradingAdapter always being provisional,
  // not a bug in this condition itself.
  // ================================================================
  {
    const { coordinator, intentPublisher } = buildTradingTestCoordinator(
      new FakeTradingExecutor({ success: true, isProvisional: false, dispatchStatus: undefined, settlementStatus: undefined }),
    )
    coordinator.registerAgent(new AlwaysApproveAgent("agent-g1"))
    coordinator.registerAgent(new AlwaysApproveAgent("agent-g2"))

    const proposal = makeTradingProposal("agent-anchor-fires", "BUY", 2_000_006)
    const result = await coordinator.submitProposal(proposal)

    expect(result.executionResult!.success === true, "execution must have succeeded")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(intentPublisher.anchorCallCount === 1, `[CORRETUDE] anchorDecision MUST be called exactly once when the executor reports a non-provisional success -- confirms the trigger condition itself works as designed. Got ${intentPublisher.anchorCallCount} call(s).`)
  }

  console.log("ALL_COORDINATOR_TRADING_ASSERTIONS_PASSED=YES")
}

runCoordinatorTradingTests()
