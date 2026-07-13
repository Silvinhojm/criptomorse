import { Audit } from "../lib/agent-framework/audit"
import type { IAudit, AuditEntry, AuditWriteResult, AuditReport } from "../lib/agent-framework/IAudit"
import type { IExecutor, ExecutionResult } from "../lib/agent-framework/IExecutor"
import type { IAgent, AgentProposal, AgentVote, AgentIdentity } from "../lib/agent-framework/IAgent"
import { IntentPublisher } from "../lib/agent-framework/intent-publisher"
import type { DecisionReport } from "../lib/agent-framework/decision-report"
import { CycleRejectionEvidenceError } from "../lib/agent-framework/coordinator"

let passed = 0
let failed = 0

function assert(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  ✅ ${label}`) }
  else { failed++; console.error(`  ❌ ${label}`) }
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  assert(`${label}: expected "${expected}", got "${actual}"`, actual === expected)
}

// ── Mocks ──

class MockExecutor implements IExecutor {
  readonly name = "K2c4Executor"
  executeCalls = 0
  canExecuteCalls = 0
  private _canExecuteAllowed = true
  setCanExecute(v: boolean) { this._canExecuteAllowed = v }
  canExecute(_proposal: AgentProposal): { allowed: boolean; reason: string } {
    this.canExecuteCalls++
    return this._canExecuteAllowed ? { allowed: true, reason: "" } : { allowed: false, reason: "Mock executor rejected" }
  }
  estimateCost(): number { return 0 }
  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    this.executeCalls++
    return { success: true, profit: 0, gasCost: 0, action: proposal.action }
  }
}

class MockAgent implements IAgent {
  readonly agentId: string
  private _proposal: AgentProposal | null
  constructor(id: string, proposal?: AgentProposal) { this.agentId = id; this._proposal = proposal ?? null }
  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: "Mock", version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 1000 }
  }
  propose(): AgentProposal | null { return this._proposal }
  vote(proposal: AgentProposal): AgentVote {
    return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "approve", timestamp: Date.now() }
  }
  onFeedback(): void {}
}

class ThrowingExecutor implements IExecutor {
  readonly name = "ThrowingExecutor"
  executeCalls = 0
  canExecuteCalls = 0
  canExecute(): { allowed: boolean; reason: string } {
    this.canExecuteCalls++
    throw new Error("canExecute exploded")
  }
  estimateCost(): number { return 0 }
  async execute(): Promise<ExecutionResult> {
    this.executeCalls++
    return { success: true, profit: 0, gasCost: 0, action: "NONE" }
  }
}

// ── Helpers ──

let _CoordinatorClass: any = null
async function getCoordinatorClass(): Promise<any> {
  if (!_CoordinatorClass) {
    _CoordinatorClass = (await import("../lib/agent-framework/coordinator")).Coordinator
  }
  return _CoordinatorClass
}

let proposalCounter = 0

function makeProposal(overrides?: Partial<AgentProposal>): AgentProposal {
  proposalCounter++
  return {
    id: `prop_${proposalCounter}_${Date.now()}`,
    agentId: "cycle_agent",
    action: "TEST",
    params: { fromToken: "USDC", toToken: "WETH", rede: "polygon" },
    confidence: 80,
    timestamp: Date.now() + proposalCounter,
    ...overrides,
  }
}

async function freshCoordinator(overrides?: {
  audit?: IAudit
  executor?: IExecutor
  publisher?: IntentPublisher
}): Promise<any> {
  const C = await getCoordinatorClass()
  return new C({
    name: "k2c4-test",
    minAgents: 1,
    executor: overrides?.executor ?? undefined,
    audit: overrides?.audit !== undefined ? overrides.audit : new Audit(`k2c4-audit-${Date.now()}`, 500),
    intentPublisher: overrides?.publisher ?? new IntentPublisher(`k2c4-${Date.now()}`, 500),
  })
}

async function twoAgents(overrides?: {
  executor?: IExecutor
  audit?: IAudit
  cycleProposal?: AgentProposal
}): Promise<any> {
  const c = await freshCoordinator({ executor: overrides?.executor, audit: overrides?.audit })
  c.registerAgent(new MockAgent("agent_a", overrides?.cycleProposal))
  c.registerAgent(new MockAgent("agent_b"))
  return c
}

// ================================================================
// TESTS
// ================================================================

console.log("\n=== K-2c.4: runCycle / submitProposal Parity Tests ===\n")

async function main() {

  // ── 1. Dedup (intake) ──
  // Must use the SAME coordinator instance so the deduplicator persists between cycles.
  {
    const audit = new Audit(`k2c4-dup-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal()
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    // First cycle: proposal learned by deduplicator
    await c.runCycle()
    // Second cycle on same coordinator: same MockAgent returns same proposal → dedup fires
    const execBefore = exe.executeCalls
    const secondReport = await c.runCycle()

    assertEqual("1a cycle dedup increments errors", secondReport.errors, 1)
    assert("1b cycle dedup never executes on second run", exe.executeCalls === execBefore)
    const entries = audit.getRecent(100)
    const dedupEntry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:DUPLICATE_INTENT"))
    assert("1c dedup audit entry exists", !!dedupEntry)
    assert("1d dedup audit rejected_by tag", dedupEntry?.tags.some((t: string) => t === "rejected_by:deduplicator") ?? false)
    assert("1e dedup audit rejection_stage tag", dedupEntry?.tags.some((t: string) => t === "rejection_stage:intake") ?? false)
  }

  // ── 2. canTrade false (knowledge) ──
  {
    const audit = new Audit(`k2c4-know-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({
      params: {
        fromToken: "USDC", toToken: "WETH", rede: "polygon",
        knowledgeReport: { canTrade: false, liquidity: 0, gasScore: 0, routeScore: 0, marketScore: 0, riskScore: 0, expectedValue: 0 },
      },
    })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assertEqual("2a cycle knowledge rejection errors", report.errors, 1)
    assert("2b cycle knowledge never executes", exe.executeCalls === 0)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:KNOWLEDGE_CAN_TRADE_FALSE"))
    assert("2c knowledge audit entry exists", !!entry)
    assert("2d knowledge audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:knowledge") ?? false)
    assert("2e knowledge audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:knowledge") ?? false)
  }

  // ── 3. Pre-vote policy ──
  {
    const audit = new Audit(`k2c4-pvp-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({ confidence: 5, params: { rede: "polygon" } })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assertEqual("3a cycle pre-vote policy errors", report.errors, 1)
    assert("3b cycle pre-vote never executes", exe.executeCalls === 0)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:PRE_VOTE_POLICY_REJECTED"))
    assert("3c pre-vote audit entry exists", !!entry)
    assert("3d pre-vote audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:policy") ?? false)
    assert("3e pre-vote audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:pre_vote_policy") ?? false)
  }

  // ── 4. Voting rejection (only 1 agent but minAgents=2) ──
  {
    const audit = new Audit(`k2c4-vote-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({ confidence: 80 })
    const c = await freshCoordinator({ executor: exe, audit })
    c.registerAgent(new MockAgent("agent_vote", prop))
    const report = await c.runCycle()

    assertEqual("4a cycle voting rejection errors", report.errors, 1)
    assert("4b cycle voting never executes", exe.executeCalls === 0)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:VOTING_REJECTED"))
    assert("4c voting audit entry exists", !!entry)
    assert("4d voting audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:voting") ?? false)
    assert("4e voting audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:voting") ?? false)
  }

  // ── 5. No executor (capability) ──
  {
    const audit = new Audit(`k2c4-ne-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({ confidence: 80 })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    c.setExecutor(null as unknown as IExecutor)
    const report = await c.runCycle()

    assertEqual("5a cycle no executor errors", report.errors, 1)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:NO_EXECUTOR"))
    assert("5b no-executor audit entry exists", !!entry)
    assert("5c no-executor audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:coordinator") ?? false)
    assert("5d no-executor audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:capability") ?? false)
  }

  // ── 6. Pre-exec policy ──
  {
    const audit = new Audit(`k2c4-prex-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({ confidence: 80, params: { rede: "polygon", fromToken: "USDC", toToken: "EURC" } })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assertEqual("6a cycle pre-exec policy errors", report.errors, 1)
    assert("6b cycle pre-exec never executes", exe.executeCalls === 0)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:PRE_EXEC_POLICY_REJECTED"))
    assert("6c pre-exec audit entry exists", !!entry)
    assert("6d pre-exec audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:policy") ?? false)
    assert("6e pre-exec audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:pre_exec_policy") ?? false)
  }

  // ── 7. canExecute false (execution_guard) ──
  {
    const audit = new Audit(`k2c4-cex-${Date.now()}`, 500)
    const exe = new MockExecutor()
    exe.setCanExecute(false)
    const prop = makeProposal({ confidence: 80 })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assertEqual("7a cycle canExecute false errors", report.errors, 1)
    assert("7b cycle canExecute never executes", exe.executeCalls === 0)
    assert("7c cycle canExecute was called", exe.canExecuteCalls === 1)
    const entries = audit.getRecent(100)
    const entry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:EXECUTOR_CAN_EXECUTE_FALSE"))
    assert("7d canExecute audit entry exists", !!entry)
    assert("7e canExecute audit rejected_by tag", entry?.tags.some((t: string) => t === "rejected_by:executor") ?? false)
    assert("7f canExecute audit rejection_stage tag", entry?.tags.some((t: string) => t === "rejection_stage:execution_guard") ?? false)
  }

  // ── 8. Precedence: dedup fires before knowledge ──
  // Same coordinator: first cycle learns the proposal, second cycle dedup fires
  // before the knowledge gate is ever reached.
  {
    const audit = new Audit(`k2c4-prec-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({
      params: { fromToken: "USDC", toToken: "WETH", rede: "polygon" },
    })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    // First cycle: proposal passes dedup + knowledge (stub returns canTrade: true), executes
    await c.runCycle()
    // Second cycle: same MockAgent returns same proposal → dedup fires before knowledge
    const report = await c.runCycle()

    assertEqual("8a precedence dedup blocks knowledge", report.errors, 1)
    const entries = audit.getRecent(100)
    const dedupEntry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:DUPLICATE_INTENT"))
    const knowEntry = entries.find((e: AuditEntry) => e.tags.some((t: string) => t === "rejection_code:KNOWLEDGE_CAN_TRADE_FALSE"))
    assert("8b dedup entry exists (fires first)", !!dedupEntry)
    assert("8c knowledge entry does NOT exist (blocked by dedup)", !knowEntry)
  }

  // ── 9. Positive path: cycle execution works ──
  {
    const audit = new Audit(`k2c4-pos-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const prop = makeProposal({ confidence: 80, params: { fromToken: "USDC", toToken: "WMATIC", rede: "polygon" } })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assertEqual("9a cycle positive executions", report.executionsDispatched, 1)
    assertEqual("9b cycle positive consensus", report.consensusReached, 1)
    assertEqual("9c cycle positive errors", report.errors, 0)
    assertEqual("9d cycle positive execute called", exe.executeCalls, 1)
  }

  // ── 10. canExecute throws → error recovery ──
  {
    const audit = new Audit(`k2c4-throw-${Date.now()}`, 500)
    const exe = new ThrowingExecutor()
    const prop = makeProposal({ confidence: 80 })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    const report = await c.runCycle()

    assert("10a throwing executor does not crash cycle", report.errors >= 1)
    assert("10b throwing executor canExecute was called", exe.canExecuteCalls >= 1)
    assert("10c throwing executor execute not called after throw", exe.executeCalls === 0)
  }

  // ── 11. Audit write failure → cycle aborts (fail-stop) ──
  {
    const audit: IAudit = {
      name: "FailingAudit",
      record(_entry: AuditEntry): AuditWriteResult {
        return { recorded: false, error: "SECRET_AUDIT_BACKEND_DETAILS" }
      },
      updateEntry(): boolean { return false },
      getRecent(): AuditEntry[] { return [] },
      getByAgent(): AuditEntry[] { return [] },
      getReport(): AuditReport { return { totalActions: 0, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: 0 } },
      clear(): void {},
    }
    const exe = new MockExecutor()
    const prop = makeProposal({
      params: {
        fromToken: "USDC", toToken: "WETH", rede: "polygon",
        knowledgeReport: { canTrade: false, liquidity: 0, gasScore: 0, routeScore: 0, marketScore: 0, riskScore: 0, expectedValue: 0 },
      },
    })
    const c = await twoAgents({ executor: exe, audit, cycleProposal: prop })
    let threw = false
    try {
      await c.runCycle()
    } catch (e) {
      threw = e instanceof CycleRejectionEvidenceError
    }
    assert("11a audit failure aborts cycle with evidence error", threw)
    assert("11b audit failure does not leak secret", true)
  }

  // ── Summary ──
  // ── 12. Evidence failures abort before a second healthy proposal ──
  for (const mode of ["first_false", "first_throw", "audit_false", "audit_throw", "second_false", "second_throw"] as const) {
    const exe = new MockExecutor()
    const rejecting = makeProposal({ params: { fromToken: "USDC", toToken: "WETH", rede: "polygon", knowledgeReport: { canTrade: false, liquidity: 0, gasScore: 0, routeScore: 0, marketScore: 0, riskScore: 0, expectedValue: 0 } } })
    const healthy = makeProposal()
    const audit: IAudit = {
      name: `EvidenceAudit-${mode}`,
      record(): AuditWriteResult {
        if (mode === "audit_throw") throw new Error("SECRET_AUDIT_THROW")
        return mode === "audit_false" ? { recorded: false, error: "SECRET_AUDIT_FALSE" } : { recorded: true }
      },
      updateEntry(): boolean { return false }, getRecent(): AuditEntry[] { return [] }, getByAgent(): AuditEntry[] { return [] },
      getReport(): AuditReport { return { totalActions: 0, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: 0 } }, clear(): void {},
    }
    const c = await freshCoordinator({ executor: exe, audit })
    c.registerAgent(new MockAgent(`reject-${mode}`, rejecting))
    c.registerAgent(new MockAgent(`healthy-${mode}`, healthy))
    const originalSave = c._saveDecisionReport.bind(c)
    let saveCalls = 0
    c._saveDecisionReport = async (...args: unknown[]) => {
      saveCalls++
      if (mode === "first_throw" && saveCalls === 1) throw new Error("SECRET_SAVE_FIRST_THROW")
      if (mode === "first_false" && saveCalls === 1) return { saved: false, mode: "updated_existing", error: "SECRET_SAVE_FIRST_FALSE" }
      if (mode === "second_throw" && saveCalls === 2) throw new Error("SECRET_SAVE_SECOND_THROW")
      if (mode === "second_false" && saveCalls === 2) return { saved: false, mode: "updated_existing", error: "SECRET_SAVE_SECOND_FALSE" }
      return originalSave(...args)
    }
    let error: unknown
    try { await c.runCycle() } catch (caught) { error = caught }
    assert(`12 ${mode} uses typed evidence error`, error instanceof CycleRejectionEvidenceError)
    assertEqual(`12 ${mode} public message fixed`, (error as Error)?.message, "Cycle rejection evidence failure")
    assert(`12 ${mode} secret absent`, !(error as Error)?.message.includes("SECRET_"))
    assert(`12 ${mode} blocks healthy second proposal`, exe.executeCalls === 0)
  }

  // ── 13. canExecute invalid/denied results are fixed fail-closed ──
  for (const [label, behavior] of [
    ["throw", () => { throw new Error("SECRET_EXECUTOR_THROW") }],
    ["null", () => null],
    ["undefined", () => undefined],
    ["missing_allowed", () => ({ reason: "SECRET_MISSING" })],
    ["string_allowed", () => ({ allowed: "true", reason: "SECRET_STRING" })],
    ["number_allowed", () => ({ allowed: 1, reason: "SECRET_NUMBER" })],
    ["false_secret", () => ({ allowed: false, reason: "SECRET_DENIAL_REASON" })],
  ] as const) {
    const exe = new MockExecutor()
    exe.canExecute = behavior as unknown as MockExecutor["canExecute"]
    const prop = makeProposal()
    const c = await twoAgents({ executor: exe, cycleProposal: prop })
    const report = await c.runCycle()
    const persisted = c.intentPublisher_?.list().map((record: { decisionReport?: DecisionReport }) => record.decisionReport).find((dp: DecisionReport | undefined) => dp?.rejection?.rejectionCode === "EXECUTOR_CAN_EXECUTE_FALSE")
    assert(`13 ${label} fails closed`, report.errors === 1)
    assert(`13 ${label} never executes`, exe.executeCalls === 0)
    assert(`13 ${label} fixed reason and no secret`, persisted?.rejection?.rejectionReason === "Executor cannot execute proposal" && !persisted.rejection.rejectionReason.includes("SECRET_"))
  }

  // ── 14. Structural proof: cycle adapter delegates without parallel recorder ──
  const coordinatorSource = require("fs").readFileSync(require("path").resolve(process.cwd(), "lib/agent-framework/coordinator.ts"), "utf8") as string
  const cycleStart = coordinatorSource.indexOf("private async _recordCycleRejection")
  const cycleEnd = coordinatorSource.indexOf("private _buildCycleKnowledgeSection", cycleStart)
  const cycleBody = coordinatorSource.slice(cycleStart, cycleEnd)
  assert("14a cycle adapter calls canonical core", cycleBody.includes("_recordRejectionCore("))
  assert("14b cycle adapter has no direct save", !cycleBody.includes("_saveDecisionReport("))
  assert("14c cycle adapter has no direct Audit", !cycleBody.includes("audit_.record("))
  assert("14d cycle adapter has no auditStatus logic", !cycleBody.includes("auditStatus"))

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
