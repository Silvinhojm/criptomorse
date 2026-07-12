import { Coordinator, type DecisionReportWriteResult } from "../lib/agent-framework/coordinator"
import { Audit } from "../lib/agent-framework/audit"
import type { IAudit, AuditEntry, AuditWriteResult, AuditReport } from "../lib/agent-framework/IAudit"
import type { IExecutor, ExecutionResult } from "../lib/agent-framework/IExecutor"
import type { ISafetyGuard, SafetyStatus } from "../lib/agent-framework/ISafetyGuard"
import type { IAgent, AgentProposal, AgentVote, AgentIdentity } from "../lib/agent-framework/IAgent"
import { IntentPublisher } from "../lib/agent-framework/intent-publisher"
import type { DecisionReport } from "../lib/agent-framework/decision-report"

let passed = 0
let failed = 0

function assert(label: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    console.error(`  ❌ ${label}`)
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  assert(`${label}: expected "${expected}", got "${actual}"`, actual === expected)
}

// ── Mocks ──

class MockSafetyGuard implements ISafetyGuard {
  readonly name = "MockSafetyGuard"
  private _open = false
  setOpen(v: boolean) { this._open = v }
  isOpen(): boolean { return this._open }
  recordSuccess(): void {}
  recordFailure(_reason?: string): void {}
  reset(): void { this._open = false }
  getStatus(): SafetyStatus {
    return {
      isOpen: this._open,
      reason: this._open ? "mock open" : "mock closed",
      triggeredAt: this._open ? new Date().toISOString() : null,
      consecutiveFailures: 0,
      maxFailures: 5,
      cooldownUntil: null,
    }
  }
}

class MockExecutor implements IExecutor {
  readonly name = "MockExecutor"
  canExecuteCalls = 0
  executeCalls = 0
  private _canExecuteAllowed = true

  setCanExecute(v: boolean) { this._canExecuteAllowed = v }

  canExecute(_proposal: AgentProposal): { allowed: boolean; reason: string } {
    this.canExecuteCalls++
    return this._canExecuteAllowed ? { allowed: true, reason: "" } : { allowed: false, reason: "Mock executor rejected" }
  }

  estimateCost(_proposal: AgentProposal): number {
    return 0
  }

  async execute(_proposal: AgentProposal): Promise<ExecutionResult> {
    this.executeCalls++
    return { success: true, profit: 0, gasCost: 0, action: _proposal.action }
  }
}

class MockAgent implements IAgent {
  readonly agentId: string
  constructor(id: string) { this.agentId = id }
  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: "Mock", version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 1000 }
  }
  propose(_ctx: Record<string, unknown>): AgentProposal | null { return null }
  vote(_proposal: AgentProposal): AgentVote {
    return { agentId: this.agentId, proposalId: _proposal.id, approved: true, confidence: 100, reason: "approve", timestamp: Date.now() }
  }
  onFeedback(_feedback: { success: boolean; profit: number; reason?: string }): void {}
}

class FailingPublisher extends IntentPublisher {
  async publish(_intent: import("../lib/agent-framework/intent-types").AgentIntent): Promise<string> {
    throw new Error("SECRET_DATABASE_DETAILS")
  }
}

class CloningPublisher extends IntentPublisher {
  readonly savedSnapshots: DecisionReport[] = []
  failOnSaveCall: number | undefined

  setDecisionReport(id: string, report: DecisionReport): boolean {
    const snapshot = structuredClone(report)
    this.savedSnapshots.push(snapshot)
    if (this.savedSnapshots.length === this.failOnSaveCall) return false
    return super.setDecisionReport(id, snapshot)
  }
}

class AuditReturnsFalse implements IAudit {
  readonly name = "MockAuditFails"
  record(_entry: AuditEntry): AuditWriteResult {
    return { recorded: false, error: "SECRET_AUDIT_BACKEND_DETAILS" }
  }
  updateEntry(): boolean { return false }
  getRecent(_count: number): AuditEntry[] { return [] }
  getByAgent(): AuditEntry[] { return [] }
  getReport(_since: number): AuditReport {
    return { totalActions: 0, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: 0 }
  }
  clear(): void {}
}

class AuditThrows implements IAudit {
  readonly name = "MockAuditThrows"
  record(_entry: AuditEntry): AuditWriteResult { throw new Error("SECRET_AUDIT_BACKEND_DETAILS") }
  updateEntry(): boolean { return false }
  getRecent(_count: number): AuditEntry[] { return [] }
  getByAgent(): AuditEntry[] { return [] }
  getReport(_since: number): AuditReport {
    return { totalActions: 0, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: 0 }
  }
  clear(): void {}
}

// ── Helpers ──

let proposalCounter = 0

function makeProposal(overrides?: Partial<AgentProposal>): AgentProposal {
  proposalCounter++
  return {
    id: `prop_${proposalCounter}_${Date.now()}`,
    agentId: "test_agent",
    action: "TEST",
    params: {},
    confidence: 80,
    timestamp: Date.now(),
    ...overrides,
  }
}

function intentIdFor(prop: AgentProposal): string {
  return `intent_${prop.agentId}_${prop.timestamp}`
}

function freshCoordinator(overrides?: {
  audit?: IAudit
  executor?: IExecutor
  safetyGuard?: ISafetyGuard
  publisher?: IntentPublisher
}): Coordinator {
  return new Coordinator({
    name: "k2c2-test",
    minAgents: 1,
    executor: overrides?.executor ?? undefined,
    safetyGuard: overrides?.safetyGuard ?? new MockSafetyGuard(),
    audit: overrides?.audit !== undefined ? overrides.audit : new Audit(`k2c2-audit-${Date.now()}`, 500),
    intentPublisher: overrides?.publisher ?? new IntentPublisher(`k2c2-${Date.now()}`, 500),
  })
}

function twoAgents(overrides?: {
  executor?: IExecutor
  audit?: IAudit
  safetyGuard?: ISafetyGuard
}): Coordinator {
  const c = freshCoordinator(overrides)
  c.registerAgent(new MockAgent("agent_a"))
  c.registerAgent(new MockAgent("agent_b"))
  return c
}

// ================================================================
// TESTS — sequential to avoid shared-state corruption
// ================================================================

console.log("\n=== K-2c.2: Centralized Rejection Tests ===\n")

async function main() {

  // ── 1. Safety guard ──
  {
    const sg = new MockSafetyGuard()
    sg.setOpen(true)
    const audit = new Audit(`audit-safety-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const c = freshCoordinator({ safetyGuard: sg, executor: exe, audit })
    const prop = makeProposal()

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("1a outcome is rejected", result.consensus.approved, false)
    assert("1b no execution result", !result.executionResult)
    assert("1c decision report exists", !!dp)
    assertEqual("1d outcome", dp?.outcome, "rejected")
    assertEqual("1e rejection code", dp?.rejection?.rejectionCode, "SAFETY_GUARD_OPEN")
    assertEqual("1f rejected by", dp?.rejection?.rejectedBy, "safety_guard")
    assertEqual("1g rejection stage", dp?.rejection?.rejectionStage, "intake")
    assertEqual("1h audit status", dp?.auditStatus, "recorded")
    assertEqual("1i intent status", c["intentPublisher_"]!.getRecord(id)?.status, "REJECTED")

    const auditEntries = audit.getRecent(100)
    const ae = auditEntries.find(e => e.proposal?.id === prop.id)
    assert("1j audit entry exists", !!ae)
    assert("1k audit tags contain rejection", ae?.tags.includes("rejection") ?? false)
    assert("1l audit tags contain code", ae?.tags.some(t => t.includes("SAFETY_GUARD_OPEN")) ?? false)
    assert("1m executor not called", exe.executeCalls === 0)
  }

  // ── 2. Duplicate ──
  {
    const audit = new Audit(`audit-dup-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = freshCoordinator({ audit, executor: exe, safetyGuard: sg })
    const prop = makeProposal()

    await c.submitProposal(prop) // first — passes through
    const dupResult = await c.submitProposal(prop) // second — dup

    assertEqual("2a outcome is rejected", dupResult.consensus.approved, false)

    const auditEntries = audit.getRecent(100)
    let found = false
    for (const entry of auditEntries) {
      if (entry.tags.includes("rejection_code:DUPLICATE_INTENT")) {
        assertEqual("2b rejection code", "DUPLICATE_INTENT", entry.tags.find(t => t.startsWith("rejection_code:"))?.split(":")[1])
        assertEqual("2c rejected by", entry.tags.find(t => t.startsWith("rejected_by:"))?.split(":")[1], "deduplicator")
        assertEqual("2d rejection stage", entry.tags.find(t => t.startsWith("rejection_stage:"))?.split(":")[1], "intake")
        assert("2e executor not called for dup", exe.executeCalls === 0)
        found = true
        break
      }
    }
    assert("2f audit entry with DUPLICATE_INTENT found", found)
  }

  // ── 3. Knowledge rejects canTrade=false ──
  {
    const audit = new Audit(`audit-know-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = twoAgents({ executor: exe })
    const prop = makeProposal({
      params: {
        knowledgeReport: {
          canTrade: false,
          liquidity: 0,
          gasScore: 0,
          routeScore: 0,
          marketScore: 0,
          riskScore: 0,
          expectedValue: 0,
        },
      },
    })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("3a outcome is rejected", result.consensus.approved, false)
    assertEqual("3b outcome", dp?.outcome, "rejected")
    assertEqual("3c rejection code", dp?.rejection?.rejectionCode, "KNOWLEDGE_CAN_TRADE_FALSE")
    assertEqual("3d rejected by", dp?.rejection?.rejectedBy, "knowledge")
    assertEqual("3e rejection stage", dp?.rejection?.rejectionStage, "knowledge")
    assertEqual("3f audit status", dp?.auditStatus, "recorded")
    assertEqual("3g intent status", c["intentPublisher_"]!.getRecord(id)?.status, "REJECTED")
    assert("3h executor not called", exe.executeCalls === 0)

  const auditEntries = c["audit_"]!.getRecent(100)
    const ae = auditEntries.find((e: AuditEntry) => e.tags.includes("rejection_code:KNOWLEDGE_CAN_TRADE_FALSE"))
    assert("3i audit entry with knowledge code exists", !!ae)
  }

  // ── 4. Pre-vote policy ──
  {
    const audit = new Audit(`audit-pvp-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = twoAgents({ executor: exe })
    const prop = makeProposal({ confidence: 5 })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("4a outcome is rejected", result.consensus.approved, false)
    assertEqual("4b rejection code", dp?.rejection?.rejectionCode, "PRE_VOTE_POLICY_REJECTED")
    assertEqual("4c rejected by", dp?.rejection?.rejectedBy, "policy")
    assertEqual("4d rejection stage", dp?.rejection?.rejectionStage, "pre_vote_policy")
    assertEqual("4e audit status recorded", dp?.auditStatus, "recorded")
    assert("4f executor not called", exe.executeCalls === 0)
  }

  // ── 5. Voting rejection (no agents) ──
  {
    const audit = new Audit(`audit-vote-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = freshCoordinator({ audit, executor: exe, safetyGuard: sg })
    const prop = makeProposal({ confidence: 80 })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("5a outcome is rejected", result.consensus.approved, false)
    assertEqual("5b rejection code", dp?.rejection?.rejectionCode, "VOTING_REJECTED")
    assertEqual("5c rejected by", dp?.rejection?.rejectedBy, "voting")
    assertEqual("5d rejection stage", dp?.rejection?.rejectionStage, "voting")
    assert("5e executor not called", exe.executeCalls === 0)
    assert("5f voting data present", !!dp?.voting)
    assertEqual("5g voting not approved", dp?.voting?.approved, false)
  }

  // ── 6. No executor ──
  {
    const audit = new Audit(`audit-ne-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = twoAgents({ executor: exe })
    c.setExecutor(undefined as unknown as IExecutor)
    const prop = makeProposal({ confidence: 80 })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("6a outcome is rejected", result.consensus.approved, false)
    assertEqual("6b rejection code", dp?.rejection?.rejectionCode, "NO_EXECUTOR")
    assertEqual("6c rejected by", dp?.rejection?.rejectedBy, "coordinator")
    assertEqual("6d rejection stage", dp?.rejection?.rejectionStage, "capability")
    assert("6e executor not called", exe.executeCalls === 0)
  }

  // ── 7. Pre-exec policy ──
  {
    const audit = new Audit(`audit-prex-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = new Coordinator({
      name: "k2c2-prex",
      minAgents: 1,
      executor: exe,
      safetyGuard: sg,
      audit,
      intentPublisher: new IntentPublisher(`k2c2-prex-${Date.now()}`, 500),
    })
    c.registerAgent(new MockAgent("agent_a"))
    c.registerAgent(new MockAgent("agent_b"))
    const prop = makeProposal({
      confidence: 80,
      params: { rede: "polygon", fromToken: "USDC", toToken: "EURC" },
    })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("7a outcome is rejected", result.consensus.approved, false)
    assertEqual("7b rejection code", dp?.rejection?.rejectionCode, "PRE_EXEC_POLICY_REJECTED")
    assertEqual("7c rejected by", dp?.rejection?.rejectedBy, "policy")
    assertEqual("7d rejection stage", dp?.rejection?.rejectionStage, "pre_exec_policy")
    assert("7e executor canExecute NOT called", exe.canExecuteCalls === 0)
    assert("7f executor execute not called", exe.executeCalls === 0)
  }

  // ── 8. canExecute returns false ──
  {
    const audit = new Audit(`audit-cex-${Date.now()}`, 500)
    const exe = new MockExecutor()
    exe.setCanExecute(false)
    const sg = new MockSafetyGuard()
    const c = new Coordinator({
      name: "k2c2-cex",
      minAgents: 1,
      executor: exe,
      safetyGuard: sg,
      audit,
      intentPublisher: new IntentPublisher(`k2c2-cex-${Date.now()}`, 500),
    })
    c.registerAgent(new MockAgent("agent_a"))
    c.registerAgent(new MockAgent("agent_b"))
    const prop = makeProposal({ confidence: 80, params: {} })

    const result = await c.submitProposal(prop)
    const id = intentIdFor(prop)
    const dp = c["intentPublisher_"]!.getRecord(id)?.decisionReport

    assertEqual("8a outcome is rejected", result.consensus.approved, false)
    assertEqual("8b rejection code", dp?.rejection?.rejectionCode, "EXECUTOR_CAN_EXECUTE_FALSE")
    assertEqual("8c rejected by", dp?.rejection?.rejectedBy, "executor")
    assertEqual("8d rejection stage", dp?.rejection?.rejectionStage, "execution_guard")
    assert("8e executor canExecute was called", exe.canExecuteCalls > 0)
    assert("8f executor execute not called", exe.executeCalls === 0)
  }

  // ── 9. DecisionReport save failure ──
  {
    const audit = new Audit(`audit-dsf-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const fb = new FailingPublisher(`failing-${Date.now()}`, 500)
    const c = new Coordinator({
      name: "k2c2-fail-save",
      minAgents: 1,
      executor: exe,
      safetyGuard: sg,
      audit,
      intentPublisher: fb,
    })
    c.registerAgent(new MockAgent("agent_a"))
    c.registerAgent(new MockAgent("agent_b"))
    const prop = makeProposal({ confidence: 80 })

    try {
      await c.submitProposal(prop)
      assert("9a submitProposal should reject on save failure", false)
    } catch (e) {
      const msg = (e as Error).message
      assertEqual("9a submitProposal rejects with sanitized save error", msg, "Failed to persist execution decision report")
      assert("9b publisher secret does not leak", !msg.includes("SECRET_DATABASE_DETAILS"))
      assert("9c executor was called", exe.executeCalls > 0)
    }
  }

  // ── 10. Audit returns false ──
  {
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const badAudit = new AuditReturnsFalse()
    const publisher = new CloningPublisher(`clone-false-${Date.now()}`, 500)
    const c = freshCoordinator({ audit: badAudit, executor: exe, safetyGuard: sg, publisher })
    const prop = makeProposal()

    try {
      await c.submitProposal(prop)
      assert("10a submitProposal should reject on audit failure", false)
    } catch (e) {
      const msg = (e as Error).message
      assertEqual("10a public audit error is sanitized", msg, "Failed to record rejection audit")
      assert("10b audit backend secret does not leak", !msg.includes("SECRET_AUDIT_BACKEND_DETAILS"))
      assert("10c executor not called", exe.executeCalls === 0)
      assertEqual("10d first cloned snapshot is not_attempted", publisher.savedSnapshots[0]?.auditStatus, "not_attempted")
      assertEqual("10e second cloned snapshot is write_failed", publisher.savedSnapshots[1]?.auditStatus, "write_failed")
      assertEqual("10f persisted snapshot is write_failed", publisher.getRecord(intentIdFor(prop))?.decisionReport?.auditStatus, "write_failed")
    }
  }

  // ── 11. Audit throws ──
  {
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const throwAudit = new AuditThrows()
    const publisher = new CloningPublisher(`clone-throw-${Date.now()}`, 500)
    const c = freshCoordinator({ audit: throwAudit, executor: exe, safetyGuard: sg, publisher })
    const prop = makeProposal()

    try {
      await c.submitProposal(prop)
      assert("11a submitProposal should reject when audit throws", false)
    } catch (e) {
      const msg = (e as Error).message
      assertEqual("11a thrown audit error is sanitized", msg, "Failed to record rejection audit")
      assert("11b thrown audit secret does not leak", !msg.includes("SECRET_AUDIT_BACKEND_DETAILS"))
      assert("11c executor not called", exe.executeCalls === 0)
      assertEqual("11d first cloned snapshot is not_attempted", publisher.savedSnapshots[0]?.auditStatus, "not_attempted")
      assertEqual("11e second cloned snapshot is write_failed", publisher.savedSnapshots[1]?.auditStatus, "write_failed")
      assertEqual("11f persisted snapshot is write_failed", publisher.getRecord(intentIdFor(prop))?.decisionReport?.auditStatus, "write_failed")
    }
  }

  // ── 12. Audit unavailable (null) ──
  {
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const publisher = new CloningPublisher(`clone-unavailable-${Date.now()}`, 500)
    const c = freshCoordinator({ audit: null as unknown as IAudit, executor: exe, safetyGuard: sg, publisher })
    const prop = makeProposal()

    try {
      await c.submitProposal(prop)
      assert("12a submitProposal should reject when audit is null", false)
    } catch (e) {
      const msg = (e as Error).message
      assertEqual("12a unavailable audit error is sanitized", msg, "Failed to record rejection audit")
      assert("12b executor not called", exe.executeCalls === 0)
      assertEqual("12c persisted snapshot is write_failed", publisher.getRecord(intentIdFor(prop))?.decisionReport?.auditStatus, "write_failed")
    }
  }

  // ── 13. Cloned success snapshots and second-save failure ──
  {
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    sg.setOpen(true)
    const publisher = new CloningPublisher(`clone-success-${Date.now()}`, 500)
    const c = freshCoordinator({ audit: new Audit(`clone-audit-${Date.now()}`, 20), executor: exe, safetyGuard: sg, publisher })
    const prop = makeProposal()
    const result = await c.submitProposal(prop)
    assertEqual("13a cloned success remains rejected", result.consensus.approved, false)
    assertEqual("13b first save is not_attempted", publisher.savedSnapshots[0]?.auditStatus, "not_attempted")
    assertEqual("13c second save is recorded", publisher.savedSnapshots[1]?.auditStatus, "recorded")
    assertEqual("13d persisted cloned report is recorded", publisher.getRecord(intentIdFor(prop))?.decisionReport?.auditStatus, "recorded")
    assert("13e rejected path never executes", exe.executeCalls === 0)
  }

  {
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    sg.setOpen(true)
    const publisher = new CloningPublisher(`clone-second-fail-${Date.now()}`, 500)
    publisher.failOnSaveCall = 2
    const c = freshCoordinator({ audit: new Audit(`second-fail-audit-${Date.now()}`, 20), executor: exe, safetyGuard: sg, publisher })
    const prop = makeProposal()
    try {
      await c.submitProposal(prop)
      assert("14a second save failure must reject", false)
    } catch (e) {
      assertEqual("14a second save failure is sanitized", (e as Error).message, "Failed to persist final rejection audit status")
      assert("14b no public approval returned", true)
      assert("14c executor not called", exe.executeCalls === 0)
      assertEqual("14d attempted final snapshot is recorded", publisher.savedSnapshots[1]?.auditStatus, "recorded")
      assertEqual("14e persisted snapshot remains not_attempted", publisher.getRecord(intentIdFor(prop))?.decisionReport?.auditStatus, "not_attempted")
    }
  }

  // ── 15. Success path still reaches execute ──
  {
    const audit = new Audit(`audit-ok-${Date.now()}`, 500)
    const exe = new MockExecutor()
    const sg = new MockSafetyGuard()
    const c = new Coordinator({
      name: "k2c2-ok",
      minAgents: 1,
      executor: exe,
      safetyGuard: sg,
      audit,
      intentPublisher: new IntentPublisher(`k2c2-ok-${Date.now()}`, 500),
    })
    c.registerAgent(new MockAgent("agent_a"))
    c.registerAgent(new MockAgent("agent_b"))
    const prop = makeProposal({ confidence: 80, params: {} })

    const result = await c.submitProposal(prop)

    assertEqual("13a success result approved", result.consensus.approved, true)
    assert("13b execution result present", !!result.executionResult)
    assertEqual("13c execution succeeded", result.executionResult!.success, true)
    assert("13d executor execute was called once", exe.executeCalls === 1)
  }

  // ── Summary ──
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`)
  if (failed > 0) process.exit(1)
}

main().catch(e => {
  console.error("Test harness failed:", e)
  process.exit(1)
})
