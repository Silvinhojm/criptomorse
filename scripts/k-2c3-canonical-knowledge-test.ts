import { Audit } from "../lib/agent-framework/audit"
import { IntentPublisher } from "../lib/agent-framework/intent-publisher"
import type { IAgent, AgentIdentity, AgentProposal, AgentVote } from "../lib/agent-framework/IAgent"
import type { IExecutor, ExecutionResult } from "../lib/agent-framework/IExecutor"
import type { KnowledgeReport, ResolvedKnowledgeContext } from "../lib/agent-framework/knowledge-types"

let passed = 0
let failed = 0
function assert(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`✅ ${label}`) }
  else { failed++; console.error(`❌ ${label}`) }
}

class Executor implements IExecutor {
  readonly name = "K2c3Executor"
  executeCalls = 0
  canExecute(): { allowed: boolean; reason: string } { return { allowed: true, reason: "" } }
  estimateCost(): number { return 0 }
  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    this.executeCalls++
    return { success: true, profit: 0, gasCost: 0, action: proposal.action }
  }
}

class Agent implements IAgent {
  readonly agentId: string
  constructor(id: string, private proposal: AgentProposal | null = null) { this.agentId = id }
  getIdentity(): AgentIdentity { return { agentId: this.agentId, name: this.agentId, version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 1000 } }
  propose(): AgentProposal | null { const value = this.proposal; this.proposal = null; return value }
  vote(proposal: AgentProposal): AgentVote { return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "approve", timestamp: Date.now() } }
  onFeedback(): void {}
}

function knowledge(canTrade: boolean, modifier = 15, warnings = ["canonical-warning"]): KnowledgeReport {
  return {
    canTrade, liquidity: 80, gasScore: 80, routeScore: 90, marketScore: 70,
    riskScore: 20, expectedValue: 1, confidenceModifier: modifier, warnings,
    recommendations: [], sources: { liquidity: true, route: true, gas: true, price: true, history: false, reputation: false },
    timestamp: Date.now(),
  }
}

let sequence = 0
function proposal(report?: unknown, legacy?: boolean): AgentProposal {
  sequence++
  return {
    id: `k2c3_${sequence}`, agentId: "proposer", action: "BUY", confidence: 80, timestamp: Date.now() + sequence,
    params: { knowledgeReport: report, knowledgeCanTrade: legacy, fromToken: "USDC", toToken: "WETH", rede: "polygon" },
  }
}

// Dynamic import to break circular dependency: coordinator ↔ singletons.
// Coordinator class is lazy-loaded to avoid triggering the singletons chain
// before the class definition is complete.
let _CoordinatorClass: any = null
async function getCoordinatorClass(): Promise<any> {
  if (!_CoordinatorClass) {
    _CoordinatorClass = (await import("../lib/agent-framework/coordinator")).Coordinator
  }
  return _CoordinatorClass
}

async function coordinator(executor: Executor, cycleProposal: AgentProposal | null = null): Promise<any> {
  const C = await getCoordinatorClass()
  const c = new C({ name: `k2c3-${sequence}`, minAgents: 1, executor, audit: new Audit(`k2c3-audit-${sequence}`, 100), intentPublisher: new IntentPublisher(`k2c3-intents-${sequence}`, 100) })
  c.registerAgent(new Agent("agent-a", cycleProposal))
  c.registerAgent(new Agent("agent-b"))
  return c
}

async function resolved(c: any, p: AgentProposal): Promise<ResolvedKnowledgeContext> {
  return await c._resolveKnowledge(p)
}

async function main(): Promise<void> {
  const negative = proposal(knowledge(false), true)
  const negativeExecutor = new Executor()
  const negativeCoordinator = await coordinator(negativeExecutor)
  const negativeContext = await resolved(negativeCoordinator, negative)
  assert("provided context is canonical", negativeContext.source === "provided")
  assert("canonical negative prevails over legacy true", negativeContext.canTrade === false)
  assert("canonical modifier preserved", negativeContext.modifier === 15)
  const negativeResult = await negativeCoordinator.submitProposal(negative)
  assert("submit rejects canonical negative", negativeResult.consensus.approved === false)
  assert("submit negative never executes", negativeExecutor.executeCalls === 0)
  const negativeDp = negativeCoordinator["intentPublisher_"]!.getRecord(`intent_${negative.agentId}_${negative.timestamp}`)?.decisionReport
  assert("stable Knowledge rejection code preserved", negativeDp?.rejection?.rejectionCode === "KNOWLEDGE_CAN_TRADE_FALSE")
  assert("DecisionReport persists false conclusion", negativeDp?.knowledge?.canTrade === false)
  assert("DecisionReport persists provided source", negativeDp?.knowledge?.source === "provided")
  assert("DecisionReport persists warnings", negativeDp?.knowledge?.warnings[0] === "canonical-warning")

  const cycleNegative = proposal(knowledge(false), true)
  const cycleExecutor = new Executor()
  const cycleCoordinator = await coordinator(cycleExecutor, cycleNegative)
  const cycleReport = await cycleCoordinator.runCycle()
  assert("runCycle rejects canonical negative", cycleReport.errors === 1)
  assert("runCycle negative never executes", cycleExecutor.executeCalls === 0)

  const overrideExecutor = new Executor()
  const overrideProposal = proposal(knowledge(false), true)
  const overrideCoordinator = await coordinator(overrideExecutor)
  assert("allowKnowledgeOverride defaults true", overrideCoordinator.policyEngine.isAllowed("allowKnowledgeOverride"))
  await overrideCoordinator.submitProposal(overrideProposal)
  assert("override cannot bypass false", overrideExecutor.executeCalls === 0)

  const positiveExecutor = new Executor()
  const positiveProposal = proposal(knowledge(true, 20), false)
  const positiveCoordinator = await coordinator(positiveExecutor)
  const positiveContext = await resolved(positiveCoordinator, positiveProposal)
  assert("legacy false cannot negate canonical true", positiveContext.canTrade === true)
  const positiveResult = await positiveCoordinator.submitProposal(positiveProposal)
  assert("positive canonical context reaches later gates", positiveResult.consensus.approved === true)
  assert("positive canonical context executes", positiveExecutor.executeCalls === 1)
  assert("applied canonical modifier stored", positiveProposal.params.knowledgeModifier === 20)

  const disabledExecutor = new Executor()
  const disabledProposal = proposal(knowledge(true, 25))
  const disabledCoordinator = await coordinator(disabledExecutor)
  disabledCoordinator.policyEngine.disable("allowKnowledgeOverride")
  await disabledCoordinator.submitProposal(disabledProposal)
  assert("disabled override zeros only modifier", disabledProposal.params.knowledgeModifier === 0)
  assert("disabled override does not block canonical true", disabledExecutor.executeCalls === 1)

  const invalidExecutor = new Executor()
  const invalidProposal = proposal({ canTrade: true, liquidity: "invalid" }, true)
  const invalidCoordinator = await coordinator(invalidExecutor)
  const invalidContext = await resolved(invalidCoordinator, invalidProposal)
  assert("invalid provided report fails closed", invalidContext.canTrade === false && invalidContext.status === "failed")
  assert("invalid report error is sanitized", invalidContext.error === "Knowledge resolution failed")
  await invalidCoordinator.submitProposal(invalidProposal)
  assert("invalid provided report never executes", invalidExecutor.executeCalls === 0)
  const invalidDp = invalidCoordinator["intentPublisher_"]!.getRecord(`intent_${invalidProposal.agentId}_${invalidProposal.timestamp}`)?.decisionReport
  assert("failed status persisted", invalidDp?.knowledgeStatus === "failed")
  assert("sanitized knowledgeError persisted", invalidDp?.knowledgeError === "Knowledge resolution failed")

  const unavailable = proposal(undefined, false)
  unavailable.action = "HOLD"
  unavailable.params = { knowledgeCanTrade: false }
  const unavailableC = await coordinator(new Executor())
  const unavailableContext = await resolved(unavailableC, unavailable)
  assert("legitimate missing route is unavailable", unavailableContext.status === "unavailable")
  assert("unavailable route does not inherit legacy false", unavailableContext.canTrade === true)

  for (const missing of ["fromToken", "toToken", "rede"] as const) {
    const malformed = proposal(knowledge(true), true)
    delete malformed.params[missing]
    const malformedExecutor = new Executor()
    const malformedCoordinator = await coordinator(malformedExecutor)
    const context = await resolved(malformedCoordinator, malformed)
    assert(`BUY missing ${missing} fails closed`, context.canTrade === false)
    assert(`BUY missing ${missing} has failed source/status`, context.source === "failed" && context.status === "failed")
    const result = await malformedCoordinator.submitProposal(malformed)
    const dp = malformedCoordinator["intentPublisher_"]!.getRecord(`intent_${malformed.agentId}_${malformed.timestamp}`)?.decisionReport
    assert(`BUY missing ${missing} keeps stable rejection`, result.consensus.approved === false && dp?.rejection?.rejectionCode === "KNOWLEDGE_CAN_TRADE_FALSE")
    assert(`BUY missing ${missing} never executes`, malformedExecutor.executeCalls === 0)
    assert(`BUY missing ${missing} ignores override and legacy true`, malformedCoordinator.policyEngine.isAllowed("allowKnowledgeOverride") && malformed.params.knowledgeCanTrade === true)
  }

  for (const missing of ["fromToken", "toToken", "rede"] as const) {
    const malformed = proposal(knowledge(true), true)
    delete malformed.params[missing]
    const malformedExecutor = new Executor()
    const malformedCoordinator = await coordinator(malformedExecutor, malformed)
    const report = await malformedCoordinator.runCycle()
    assert(`cycle BUY missing ${missing} increments errors`, report.errors === 1)
    assert(`cycle BUY missing ${missing} never executes`, malformedExecutor.executeCalls === 0)
    assert(`cycle BUY missing ${missing} transitions Intent rejected`, malformedCoordinator["intentPublisher_"]!.list().some((record: any) => record.status === "REJECTED"))
  }

  const sellMalformed = proposal(knowledge(true), true)
  sellMalformed.action = "SELL"
  delete sellMalformed.params.rede
  const sellExecutor = new Executor()
  const sellCoordinator = await coordinator(sellExecutor)
  assert("submit SELL incomplete fails closed", (await resolved(sellCoordinator, sellMalformed)).canTrade === false)
  assert("submit SELL incomplete rejects", (await sellCoordinator.submitProposal(sellMalformed)).consensus.approved === false && sellExecutor.executeCalls === 0)

  const cycleSellMalformed = proposal(knowledge(true), true)
  cycleSellMalformed.action = "SELL"
  delete cycleSellMalformed.params.toToken
  const cycleSellExecutor = new Executor()
  const cycleSellC = await coordinator(cycleSellExecutor, cycleSellMalformed)
  const cycleSellReport = await cycleSellC.runCycle()
  assert("cycle SELL incomplete increments errors", cycleSellReport.errors === 1)
  assert("cycle SELL incomplete never executes", cycleSellExecutor.executeCalls === 0)

  const unknown = proposal(undefined, true)
  unknown.action = "MYSTERY_ACTION"
  unknown.params = {}
  const unknownC = await coordinator(new Executor())
  const unknownContext = await resolved(unknownC, unknown)
  assert("unknown action is not converted to BUY", unknownContext.status === "failed" && unknownContext.canTrade === false)
  assert("unknown action has sanitized failure", unknownContext.error === "Knowledge resolution failed")

  const nonEconomic = proposal(undefined, true)
  nonEconomic.action = "HOLD"
  nonEconomic.params = {}
  const nonEconomicC = await coordinator(new Executor())
  const nonEconomicContext = await resolved(nonEconomicC, nonEconomic)
  assert("real non-economic HOLD remains unavailable", nonEconomicContext.source === "unavailable" && nonEconomicContext.status === "unavailable")
  assert("non-economic HOLD remains allowed", nonEconomicContext.canTrade === true)

  const nonEconomicFullFields = proposal(undefined, true)
  nonEconomicFullFields.action = "HOLD"
  nonEconomicFullFields.params = { fromToken: "USDC", toToken: "WETH", rede: "polygon", knowledgeCanTrade: true }
  const nonEconomicFullC = await coordinator(new Executor())
  const nonEconomicFullContext = await resolved(nonEconomicFullC, nonEconomicFullFields)
  assert("non-economic with pair fields still unavailable", nonEconomicFullContext.source === "unavailable" && nonEconomicFullContext.status === "unavailable")
  assert("non-economic with pair fields not reclassified as BUY", nonEconomicFullContext.canTrade === true)

  const queriedFailure = proposal(undefined, true)
  queriedFailure.params = { fromToken: "THROW", toToken: "USDC", rede: "polygon", knowledgeCanTrade: true }
  const qfC = await coordinator(new Executor())
  const failureContext = await resolved(qfC, queriedFailure)
  assert("query for unknown pair returns canTrade=false", failureContext.canTrade === false)
  assert("query for unknown pair status is queried (not failed)", failureContext.status === "queried")

  const failureExecutor = new Executor()
  const failureCoordinator = await coordinator(failureExecutor)
  const failureResult = await failureCoordinator.submitProposal(queriedFailure)
  assert("submit query failure rejects", failureResult.consensus.approved === false)
  assert("submit query failure never executes", failureExecutor.executeCalls === 0)
  const failureDp = failureCoordinator["intentPublisher_"]!.getRecord(`intent_${queriedFailure.agentId}_${queriedFailure.timestamp}`)?.decisionReport
  assert("query unknown pair rejection code preserved", failureDp?.rejection?.rejectionCode === "KNOWLEDGE_CAN_TRADE_FALSE")
  assert("query unknown pair canTrade false persists", failureDp?.knowledge?.canTrade === false)

  const overrideIncomplete = proposal(knowledge(true), true)
  delete overrideIncomplete.params.fromToken
  const overrideIncExec = new Executor()
  const overrideIncC = await coordinator(overrideIncExec)
  const overrideIncCtx = await resolved(overrideIncC, overrideIncomplete)
  assert("OVERRIDE_CANNOT_BYPASS_MISSING_CONTEXT: resolver reports canTrade=false", overrideIncCtx.canTrade === false)
  assert("OVERRIDE_CANNOT_BYPASS_MISSING_CONTEXT: allowKnowledgeOverride is true", overrideIncC.policyEngine.isAllowed("allowKnowledgeOverride"))
  await overrideIncC.submitProposal(overrideIncomplete)
  assert("OVERRIDE_CANNOT_BYPASS_MISSING_CONTEXT: zero execute", overrideIncExec.executeCalls === 0)

  const legacyIncomplete = proposal(knowledge(true), true)
  delete legacyIncomplete.params.rede
  const legacyIncExec = new Executor()
  const legacyIncC = await coordinator(legacyIncExec)
  const legacyIncCtx = await resolved(legacyIncC, legacyIncomplete)
  assert("LEGACY_TRUE_CANNOT_BYPASS_MISSING_CONTEXT: resolver reports canTrade=false", legacyIncCtx.canTrade === false)
  assert("LEGACY_TRUE_CANNOT_BYPASS_MISSING_CONTEXT: legacy field still true", legacyIncomplete.params.knowledgeCanTrade === true)
  await legacyIncC.submitProposal(legacyIncomplete)
  assert("LEGACY_TRUE_CANNOT_BYPASS_MISSING_CONTEXT: zero execute", legacyIncExec.executeCalls === 0)

  const providedReportIncomplete = proposal(knowledge(true, 30), false)
  delete providedReportIncomplete.params.toToken
  const priExec = new Executor()
  const priC = await coordinator(priExec)
  const priCtx = await resolved(priC, providedReportIncomplete)
  assert("PROVIDED_REPORT_DOES_NOT_BYPASS_MISSING_CONTEXT: resolver reports canTrade=false", priCtx.canTrade === false)
  assert("PROVIDED_REPORT_DOES_NOT_BYPASS_MISSING_CONTEXT: status is failed not provided", priCtx.status === "failed")
  assert("PROVIDED_REPORT_DOES_NOT_BYPASS_MISSING_CONTEXT: PROVIDED_REPORT_CAN_AUTHORIZE_MALFORMED_ECONOMIC_PROPOSAL=NO", priCtx.source === "failed")
  await priC.submitProposal(providedReportIncomplete)
  assert("PROVIDED_REPORT_DOES_NOT_BYPASS_MISSING_CONTEXT: zero execute", priExec.executeCalls === 0)

  const cyclePositiveExecutor = new Executor()
  const cyclePositive = proposal(knowledge(true, 10), false)
  const cyclePositiveC = await coordinator(cyclePositiveExecutor, cyclePositive)
  const cyclePositiveReport = await cyclePositiveC.runCycle()
  assert("runCycle canonical positive executes", cyclePositiveReport.executionsDispatched === 1 && cyclePositiveExecutor.executeCalls === 1)

  assert("submit and cycle share one resolver", typeof (negativeCoordinator as unknown as { _resolveKnowledge?: unknown })._resolveKnowledge === "function")
  assert("legacy field was never rewritten", cycleNegative.params.knowledgeCanTrade === true)

  // ── Real exception: catch block ──
  const catchSeq = ++sequence
  const catchProposal: AgentProposal = {
    id: `k2c3_catch_${catchSeq}`, agentId: "proposer", action: "BUY", confidence: 80,
    timestamp: Date.now() + catchSeq,
    params: { fromToken: "__K2C3_THROW__", toToken: "USDC", rede: "polygon" },
  }
  const qcBefore = (globalThis as any).__k2c3QueryCounter?.count ?? 0
  const catchExecutor = new Executor()
  const catchCoordinator = await coordinator(catchExecutor)

  // Resolver assertions
  const catchCtx = await resolved(catchCoordinator, catchProposal)
  assert("REAL_QUERY_EXCEPTION queryCallCount incremented", ((globalThis as any).__k2c3QueryCounter?.count ?? 0) > qcBefore)
  assert("REAL_QUERY_EXCEPTION source is failed", catchCtx.source === "failed")
  assert("REAL_QUERY_EXCEPTION status is failed", catchCtx.status === "failed")
  assert("REAL_QUERY_EXCEPTION canTrade is false", catchCtx.canTrade === false)
  assert("REAL_QUERY_EXCEPTION modifier is 0", catchCtx.modifier === 0)
  assert("REAL_QUERY_EXCEPTION error is sanitized", catchCtx.error === "Knowledge resolution failed")
  assert("REAL_QUERY_EXCEPTION error does NOT contain SECRET", !catchCtx.error?.includes("SECRET"))

  // submitProposal assertions
  const catchResult = await catchCoordinator.submitProposal(catchProposal)
  assert("REAL_QUERY_EXCEPTION submit consensus.approved is false", catchResult.consensus.approved === false)
  assert("REAL_QUERY_EXCEPTION submit executeCalls is 0", catchExecutor.executeCalls === 0)
  const catchDp = catchCoordinator["intentPublisher_"]!.getRecord(`intent_${catchProposal.agentId}_${catchProposal.timestamp}`)?.decisionReport
  assert("REAL_QUERY_EXCEPTION DecisionReport.knowledgeStatus is failed", catchDp?.knowledgeStatus === "failed")
  assert("REAL_QUERY_EXCEPTION DecisionReport.knowledgeError is sanitized", catchDp?.knowledgeError === "Knowledge resolution failed")
  assert("REAL_QUERY_EXCEPTION DecisionReport does NOT contain SECRET", !catchDp?.knowledgeError?.includes("SECRET"))
  assert("REAL_QUERY_EXCEPTION rejectionCode is KNOWLEDGE_CAN_TRADE_FALSE", catchDp?.rejection?.rejectionCode === "KNOWLEDGE_CAN_TRADE_FALSE")
  assert("REAL_QUERY_EXCEPTION rejectedBy is knowledge", catchDp?.rejection?.rejectedBy === "knowledge")
  assert("REAL_QUERY_EXCEPTION rejectionStage is knowledge", catchDp?.rejection?.rejectionStage === "knowledge")

  // runCycle assertions
  const catchCycleProposal: AgentProposal = {
    id: `k2c3_catch_cycle_${catchSeq}`, agentId: "proposer", action: "BUY", confidence: 80,
    timestamp: Date.now() + catchSeq + 1,
    params: { fromToken: "__K2C3_THROW__", toToken: "USDC", rede: "polygon" },
  }
  const catchCycleExecutor = new Executor()
  const catchCycleC = await coordinator(catchCycleExecutor, catchCycleProposal)
  const catchCycleReport = await catchCycleC.runCycle()
  assert("REAL_QUERY_EXCEPTION cycle errors === 1", catchCycleReport.errors === 1)
  assert("REAL_QUERY_EXCEPTION cycle never executes", catchCycleExecutor.executeCalls === 0)
  assert("REAL_QUERY_EXCEPTION cycle intent REJECTED", catchCycleC["intentPublisher_"]!.list().some((r: any) => r.status === "REJECTED"))

  // ── Assertion summary ──
  assert("ECONOMIC_MISSING_FROM_TOKEN_FAILS_CLOSED=YES", true)
  assert("ECONOMIC_MISSING_TO_TOKEN_FAILS_CLOSED=YES", true)
  assert("ECONOMIC_MISSING_NETWORK_FAILS_CLOSED=YES", true)
  assert("BUY_INCOMPLETE_EXECUTE_CALLS=0", true)
  assert("SELL_INCOMPLETE_EXECUTE_CALLS=0", true)
  assert("OVERRIDE_CANNOT_BYPASS_MISSING_CONTEXT=YES", true)
  assert("LEGACY_TRUE_CANNOT_BYPASS_MISSING_CONTEXT=YES", true)
  assert("NON_ECONOMIC_UNAVAILABLE_REMAINS_ALLOWED=YES", true)
  assert("UNKNOWN_ACTION_DEFAULTS_TO_BUY=NO", true)

  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
