import { readFileSync } from "fs"
import { resolve } from "path"
import { Coordinator, CycleRejectionEvidenceError } from "../lib/agent-framework/coordinator"
import { Audit } from "../lib/agent-framework/audit"
import { IntentPublisher } from "../lib/agent-framework/intent-publisher"
import type { IAudit, AuditEntry, AuditReport, AuditWriteResult } from "../lib/agent-framework/IAudit"
import type { IExecutor, ExecutionResult } from "../lib/agent-framework/IExecutor"
import type { IAgent, AgentIdentity, AgentProposal, AgentVote } from "../lib/agent-framework/IAgent"
import type { ISafetyGuard, SafetyStatus } from "../lib/agent-framework/ISafetyGuard"
import type { IOperationalRecoveryAuthorizer } from "../lib/agent-framework/ICoordinator"
import type { CoordinatorDecisionDependencies } from "../lib/agent-framework/coordinator-dependencies"
import type { KnowledgeReport } from "../lib/agent-framework/knowledge-types"

let passed = 0
let failed = 0
function assert(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  ✅ ${label}`) }
  else { failed++; console.error(`  ❌ ${label}`) }
}
function equal(label: string, actual: unknown, expected: unknown): void {
  assert(`${label}: expected ${String(expected)}, got ${String(actual)}`, actual === expected)
}

function decisionDependencies(): CoordinatorDecisionDependencies {
  const report: KnowledgeReport = {
    canTrade: true,
    liquidity: 100,
    gasScore: 100,
    routeScore: 100,
    marketScore: 100,
    riskScore: 0,
    expectedValue: 1,
    confidenceModifier: 0,
    warnings: [],
    recommendations: [],
    sources: { liquidity: true, route: true, gas: true, price: true, history: false, reputation: false },
    timestamp: Date.now(),
  }
  return {
    reputation: { getScore: () => 0 },
    knowledge: { query: async () => report },
  }
}

class Guard implements ISafetyGuard {
  readonly name = "guard"
  isOpenCalls = 0
  open = false
  isOpen(): boolean { this.isOpenCalls++; return this.open }
  recordSuccess(): void {}
  recordFailure(): void {}
  reset(): void { this.open = false }
  getStatus(): SafetyStatus { return { isOpen: this.open, reason: null, triggeredAt: null, consecutiveFailures: 0, maxFailures: 5, cooldownUntil: null } }
}

class Executor implements IExecutor {
  readonly name = "K2c5Executor"
  canExecuteCalls = 0
  executeCalls = 0
  onCanExecute?: () => void
  lastResult?: ExecutionResult
  canExecute(): { allowed: boolean; reason: string } {
    this.canExecuteCalls++
    this.onCanExecute?.()
    return { allowed: true, reason: "" }
  }
  estimateCost(): number { return 0 }
  async execute(proposal: AgentProposal): Promise<ExecutionResult> {
    this.executeCalls++
    this.lastResult = { success: true, action: proposal.action, profit: 7, gasCost: 2, txHash: "0xk2c5" }
    return this.lastResult
  }
}

class Agent implements IAgent {
  proposeCalls = 0
  constructor(readonly agentId: string, private proposal_: AgentProposal | null = null) {}
  getIdentity(): AgentIdentity { return { agentId: this.agentId, name: this.agentId, version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 100 } }
  propose(): AgentProposal | null { this.proposeCalls++; return this.proposal_ }
  vote(proposal: AgentProposal): AgentVote { return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "approve", timestamp: Date.now() } }
  onFeedback(): void {}
}

class ConfigurableAudit implements IAudit {
  readonly entries = new Map<string, AuditEntry>()
  recordMode: "ok" | "false" | "throw" = "ok"
  readMode: "ok" | "missing" | "divergent" = "ok"
  recordCalls = 0
  constructor(readonly name: string) {}
  record(entry: AuditEntry): AuditWriteResult {
    this.recordCalls++
    if (this.recordMode === "throw") throw new Error("SECRET_AUDIT")
    if (this.recordMode === "false") return { recorded: false, error: "SECRET_AUDIT" }
    this.entries.set(entry.id, entry)
    return { recorded: true }
  }
  getById(id: string): AuditEntry | null {
    if (this.readMode === "missing") return null
    const entry = this.entries.get(id) ?? null
    if (this.readMode === "divergent" && entry) return { ...entry, id: "divergent" }
    return entry
  }
  updateEntry(): boolean { return false }
  getRecent(count: number): AuditEntry[] { return [...this.entries.values()].slice(-count) }
  getByAgent(agentId: string): AuditEntry[] { return [...this.entries.values()].filter(entry => entry.agentId === agentId) }
  getReport(): AuditReport { return { totalActions: this.entries.size, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: Date.now() } }
  clear(): void { this.entries.clear() }
}

class NoReadBackAudit implements IAudit {
  readonly name = "no-readback"
  record(): AuditWriteResult { return { recorded: true } }
  updateEntry(): boolean { return false }
  getRecent(): AuditEntry[] { return [] }
  getByAgent(): AuditEntry[] { return [] }
  getReport(): AuditReport { return { totalActions: 0, successful: 0, failed: 0, totalProfit: 0, totalGasCost: 0, topAgents: [], periodStart: 0, periodEnd: 0 } }
  clear(): void {}
}

class FourthReadFailsPublisher extends IntentPublisher {
  getCalls = 0
  getRecord(id: string): ReturnType<IntentPublisher["getRecord"]> {
    this.getCalls++
    if (this.getCalls === 4) return null
    return super.getRecord(id)
  }
}

const allow: IOperationalRecoveryAuthorizer = { authorizeOperationalRecovery: () => true }
const deny: IOperationalRecoveryAuthorizer = { authorizeOperationalRecovery: () => false }
let sequence = 0
function proposal(): AgentProposal {
  sequence++
  return { id: `p_${sequence}`, agentId: "source", action: "TEST", params: {}, confidence: 90, timestamp: Date.now() + sequence }
}
function coordinator(options: { audit?: IAudit; omitAudit?: boolean; executor?: Executor; guard?: Guard; publisher?: IntentPublisher; authorizer?: IOperationalRecoveryAuthorizer } = {}): Coordinator {
  const config = {
    name: `k2c5_${++sequence}`,
    executor: options.executor,
    safetyGuard: options.guard,
    intentPublisher: options.publisher ?? new IntentPublisher(`pub_${sequence}`, 500),
    recoveryAuthorizer: options.authorizer,
  }
  return options.omitAudit
    ? new Coordinator(config, decisionDependencies())
    : new Coordinator({ ...config, audit: options.audit ?? new Audit(`audit_${sequence}`, 500) }, decisionDependencies())
}
function registerVoters(c: Coordinator, cycleProposal: AgentProposal | null = null): Agent[] {
  const agents = [new Agent("a", cycleProposal), new Agent("b")]
  agents.forEach(agent => c.registerAgent(agent))
  return agents
}
async function rejectionFailure(mode: "audit_false" | "audit_throw" | "first_false" | "first_throw" | "final_false" | "final_throw"): Promise<Coordinator> {
  const audit = new ConfigurableAudit(mode)
  if (mode === "audit_false") audit.recordMode = "false"
  if (mode === "audit_throw") audit.recordMode = "throw"
  const guard = new Guard(); guard.open = true
  const c = coordinator({ audit, guard })
  const original = c["_saveDecisionReport"].bind(c)
  let calls = 0
  c["_saveDecisionReport"] = async (...args: Parameters<typeof original>) => {
    calls++
    if (mode === "first_false" && calls === 1) return { saved: false, mode: "updated_existing" }
    if (mode === "first_throw" && calls === 1) throw new Error("SECRET_FIRST")
    if (mode === "final_false" && calls === 2) return { saved: false, mode: "updated_existing" }
    if (mode === "final_throw" && calls === 2) throw new Error("SECRET_FINAL")
    return original(...args)
  }
  let caught: unknown
  try { await c.submitProposal(proposal()) } catch (error) { caught = error }
  assert(`${mode} first detection throws typed error`, caught instanceof CycleRejectionEvidenceError)
  equal(`${mode} public error fixed`, (caught as Error)?.message, "Cycle rejection evidence failure")
  equal(`${mode} enters recovery required`, c.getOperationalStatus().operationalStatus, "RECOVERY_REQUIRED")
  return c
}

async function main(): Promise<void> {
  console.log("\n=== K-2c.5 Operational Fail-Closed Tests ===\n")

  const noAudit = coordinator({ omitAudit: true, executor: new Executor(), guard: new Guard() })
  equal("A missing Audit starts degraded", noAudit.getOperationalStatus().operationalStatus, "RECOVERY_REQUIRED")
  equal("A missing Audit code", noAudit.getOperationalStatus().degradationCode, "AUDIT_UNAVAILABLE")

  const primaryGuard = new Guard(); primaryGuard.open = true
  const primaryExecutor = new Executor()
  const primary = coordinator({ omitAudit: true, executor: primaryExecutor, guard: primaryGuard })
  const primaryResult = await primary.submitProposal(proposal())
  equal("B submit primary gate returns unavailable", primaryResult.kind, "operational_unavailable")
  equal("B Safety Guard not consulted", primaryGuard.isOpenCalls, 0)
  equal("B execute not called", primaryExecutor.executeCalls, 0)

  const cycleExecutor = new Executor()
  const cycle = coordinator({ omitAudit: true, executor: cycleExecutor, guard: new Guard() })
  const cycleAgents = registerVoters(cycle, proposal())
  const cycleResult = await cycle.runCycle()
  equal("C cycle gate returns unavailable", cycleResult.kind, "operational_unavailable")
  equal("C agents not consulted", cycleAgents.reduce((sum, agent) => sum + agent.proposeCalls, 0), 0)
  equal("C cycle execute not called", cycleExecutor.executeCalls, 0)

  for (const mode of ["audit_false", "audit_throw", "first_false", "first_throw", "final_false", "final_throw"] as const) {
    const degraded = await rejectionFailure(mode)
    const subsequent = await degraded.submitProposal(proposal())
    equal(`${mode} subsequent call structured`, subsequent.kind, "operational_unavailable")
  }

  const stableDegraded = await rejectionFailure("audit_false")
  const degradedAt = stableDegraded.getOperationalStatus().degradedAt
  await new Promise(resolvePromise => setTimeout(resolvePromise, 2))
  await stableDegraded.submitProposal(proposal())
  equal("N time does not recover", stableDegraded.getOperationalStatus().operationalStatus, "RECOVERY_REQUIRED")
  equal("N degradedAt is stable", stableDegraded.getOperationalStatus().degradedAt, degradedAt)

  const missingAuthorizer = coordinator({ omitAudit: true })
  const missingCandidate = new ConfigurableAudit("missing-authorizer")
  const missingAuthResult = await missingAuthorizer.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: missingCandidate })
  equal("P missing authorizer denied", missingAuthResult.status, "denied")
  equal("P probe not started", missingCandidate.recordCalls, 0)

  const denied = coordinator({ omitAudit: true, authorizer: deny })
  const deniedCandidate = new ConfigurableAudit("denied")
  const deniedResult = await (denied as unknown as { attemptOperationalRecovery: Coordinator["attemptOperationalRecovery"] }).attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: deniedCandidate })
  equal("Q/R runtime authorizer denies cast caller", deniedResult.status, "denied")
  equal("Q/R denied before probe", deniedCandidate.recordCalls, 0)

  const missingReadBack = coordinator({ omitAudit: true, authorizer: allow })
  const missingReadResult = await missingReadBack.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: new NoReadBackAudit() })
  equal("D missing getById fails", missingReadResult.status, "failed")
  equal("D missing getById stays degraded", missingReadBack.getOperationalStatus().operationalStatus, "RECOVERY_REQUIRED")

  for (const readMode of ["missing", "divergent"] as const) {
    const c = coordinator({ omitAudit: true, authorizer: allow })
    const candidate = new ConfigurableAudit(readMode); candidate.readMode = readMode
    const result = await c.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: candidate })
    equal(`${readMode} Audit readback fails`, result.status, "failed")
    assert(`${readMode} candidate not installed`, c.getAudit() !== candidate)
  }

  const badIntentRead = coordinator({ omitAudit: true, authorizer: allow, publisher: new FourthReadFailsPublisher("bad-read", 500) })
  const badIntentCandidate = new ConfigurableAudit("bad-intent")
  const badIntentResult = await badIntentRead.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: badIntentCandidate })
  equal("Z inconsistent Intent readback fails", badIntentResult.status, "failed")
  assert("Z candidate not installed", badIntentRead.getAudit() !== badIntentCandidate)

  const recovered = coordinator({ omitAudit: true, authorizer: allow })
  const approvedCandidate = new ConfigurableAudit("approved")
  const recoveredResult = await recovered.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: approvedCandidate })
  equal("AB complete proof recovers", recoveredResult.status, "recovered")
  equal("AB status operational", recovered.getOperationalStatus().operationalStatus, "OPERATIONAL")
  assert("AD candidate installed only after proof", recovered.getAudit() === approvedCandidate)
  const alreadyCandidate = new ConfigurableAudit("already")
  const already = await recovered.attemptOperationalRecovery({ requestedBy: "admin", candidateAudit: alreadyCandidate })
  equal("AP already operational deterministic", already.status, "already_operational")
  assert("AP backend not swapped", recovered.getAudit() === approvedCandidate)

  const concurrent = coordinator({ omitAudit: true, authorizer: allow })
  const candidateA = new ConfigurableAudit("candidate-A")
  const candidateB = new ConfigurableAudit("candidate-B")
  assert("AE candidates are distinct", candidateA !== candidateB)
  const attemptA = concurrent.attemptOperationalRecovery({ requestedBy: "A", candidateAudit: candidateA })
  const attemptB = concurrent.attemptOperationalRecovery({ requestedBy: "B", candidateAudit: candidateB })
  const [resultA, resultB] = await Promise.all([attemptA, attemptB])
  equal("AE winner recovered", resultA.status, "recovered")
  equal("AE loser sees mutex", resultB.status, "recovery_in_progress")
  assert("AF loser never installed", concurrent.getAudit() !== candidateB)
  assert("AE exactly winner installed", concurrent.getAudit() === candidateA)

  const concurrentFailure = coordinator({ omitAudit: true, authorizer: allow })
  const failingA = new ConfigurableAudit("failing-A"); failingA.recordMode = "false"
  const losingB = new ConfigurableAudit("losing-B")
  const failedA = concurrentFailure.attemptOperationalRecovery({ requestedBy: "A", candidateAudit: failingA })
  const lostB = concurrentFailure.attemptOperationalRecovery({ requestedBy: "B", candidateAudit: losingB })
  const [failedWinner, failedLoser] = await Promise.all([failedA, lostB])
  equal("AG winner failure reported", failedWinner.status, "failed")
  equal("AG loser still excluded", failedLoser.status, "recovery_in_progress")
  equal("AG state remains degraded", concurrentFailure.getOperationalStatus().operationalStatus, "RECOVERY_REQUIRED")
  assert("AG neither backend installed", concurrentFailure.getAudit() !== failingA && concurrentFailure.getAudit() !== losingB)

  const finalCheckExecutor = new Executor()
  const finalCheck = coordinator({ executor: finalCheckExecutor })
  registerVoters(finalCheck)
  finalCheckExecutor.onCanExecute = () => finalCheck["_enterRecoveryRequired"]("AUDIT_WRITE_REJECTED", "unavailable")
  const finalCheckResult = await finalCheck.submitProposal(proposal())
  equal("AH second check returns unavailable", finalCheckResult.kind, "operational_unavailable")
  equal("AH execute blocked", finalCheckExecutor.executeCalls, 0)

  for (const auditMode of ["false", "throw"] as const) {
    const audit = new ConfigurableAudit(`post-${auditMode}`); audit.recordMode = auditMode
    const executor = new Executor()
    const c = coordinator({ audit, executor })
    registerVoters(c)
    const result = await c.submitProposal(proposal())
    equal(`AJ/AK ${auditMode} returns unavailable`, result.kind, "operational_unavailable")
    if (result.kind === "operational_unavailable") {
      equal(`AJ/AK ${auditMode} execution occurred`, result.executionOccurred, true)
      equal(`AJ/AK ${auditMode} evidence unproven`, result.evidenceStatus, "unproven")
      equal(`AJ/AK ${auditMode} public reason fixed`, result.publicReason, "Operational recovery required")
      equal(`AJ/AK ${auditMode} consensus reason fixed`, result.consensus.reason, "Operational recovery required")
      assert(`AJ/AK ${auditMode} preserves exact ExecutionResult`, result.executionResult === executor.lastResult)
    }
    const after = await c.submitProposal(proposal())
    equal(`AL ${auditMode} next call blocked`, after.kind, "operational_unavailable")
    equal(`AL ${auditMode} no second execute`, executor.executeCalls, 1)
  }

  const source = readFileSync(resolve(process.cwd(), "lib/agent-framework/coordinator.ts"), "utf8")
  const executeMatches = [...source.matchAll(/const finalOperationalReadiness = this\._getOperationalReadiness\([^\n]+\)[\s\S]*?const executionPromise = this\.executor_\.execute\(proposal\)/g)]
  equal("AI both execute sites have final readiness", executeMatches.length, 2)
  for (const [index, match] of executeMatches.entries()) {
    equal(`AI execute site ${index + 1} has zero await before invocation`, (match[0].match(/\bawait\b/g) ?? []).length, 0)
  }
  assert("AM fixed public reason excludes SECRET", !"Operational recovery required".includes("SECRET"))

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
