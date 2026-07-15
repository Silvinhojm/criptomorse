// RI-L1-P3 — server-only Coordinator factory contract tests.
// Canonical execution: local TypeScript + ts.transpileModule() + custom @/ resolver.
// Canonical runner SHA-256: CBF7234281DFBAFA4050049FEC479FFC4090B83E60E86353C45109467A0DA903

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "fs"
import { resolve } from "path"
import { spawnSync } from "child_process"
import ts from "typescript"

import type {
  CreateServerCoordinatorOptions,
  ExecutionDisabledIntentPersistence,
  ServerCoordinatorComposition,
} from "../lib/agent-framework/server/_coordinator-factory-core"
import { Coordinator } from "../lib/agent-framework/coordinator"
import { PolicyEngine } from "../lib/agent-framework/policy-engine"
import type { IAgent, AgentIdentity, AgentProposal, AgentVote } from "../lib/agent-framework/IAgent"
import type { IAudit, AuditEntry, AuditReport, AuditWriteResult } from "../lib/agent-framework/IAudit"
import type { DecisionReport } from "../lib/agent-framework/decision-report"
import type { AgentIntent, IntentFilter, IntentRecord, IntentStatus } from "../lib/agent-framework/intent-types"
import type { KnowledgeReport } from "../lib/agent-framework/knowledge-types"
import type { CoordinatorDecisionDependencies } from "../lib/agent-framework/coordinator-dependencies"

type CoreRuntime = {
  createServerCoordinatorComposition(
    options: CreateServerCoordinatorOptions,
  ): ServerCoordinatorComposition
}

type RuntimeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const runtimeModule = require("node:module") as {
  _load: RuntimeModuleLoader
}
const originalRuntimeLoad = runtimeModule._load
let coreRuntime: CoreRuntime

try {
  runtimeModule._load = (
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown => {
    if (request === "server-only") return Object.freeze({})
    return originalRuntimeLoad(request, parent, isMain)
  }
  coreRuntime = require(
    "../lib/agent-framework/server/_coordinator-factory-core",
  ) as CoreRuntime
} finally {
  runtimeModule._load = originalRuntimeLoad
}

const { createServerCoordinatorComposition } = coreRuntime

const scenarios = [
  "P3_CORE_FIRST_IMPORT_IS_SERVER_ONLY",
  "P3_01_BOUNDARY_FIRST_IMPORT_IS_SERVER_ONLY",
  "P3_BOUNDARY_AND_CORE_BOTH_ENFORCE_SERVER_ONLY",
  "P3_02_BOUNDARY_ONLY_REEXPORTS_CORE",
  "P3_03_CORE_DOES_NOT_IMPORT_SINGLETONS",
  "P3_04_CORE_HAS_NO_DYNAMIC_SINGLETON_IMPORT",
  "P3_05_SINGLETONS_DOES_NOT_IMPORT_P3",
  "P3_06_SHARED_BARRELS_DO_NOT_EXPORT_P3",
  "P3_07_CURRENT_CONSUMERS_DO_NOT_IMPORT_P3",
  "P3_08_CORE_HAS_NO_TOP_LEVEL_NEW",
  "P3_09_CORE_HAS_NO_TOP_LEVEL_LISTENER_TIMER_OR_CACHE",
  "P3_10_CORE_HAS_NO_WALLET_PROVIDER_SIGNER_CONTRACT_OR_TRADING_IMPORT",
  "P3_11_CORE_DOES_NOT_CREATE_SETTLEMENT_REGISTRY",
  "P3_12_CORE_DOES_NOT_CREATE_REPLAY_QUEUE_OR_SETTLEMENT_LISTENER",
  "P3_13_VALID_OPTIONS_CREATE_COMPOSITION",
  "P3_14_INVALID_OPTIONS_OBJECT_FAILS",
  "P3_15_EMPTY_NAME_FAILS",
  "P3_16_INVALID_AUDIT_FAILS_EAGERLY",
  "P3_17_EACH_MISSING_PERSISTENCE_METHOD_FAILS_EAGERLY",
  "P3_18_ANCHOR_CAPABILITY_IS_REJECTED",
  "P3_19_RETRY_CAPABILITY_IS_REJECTED",
  "P3_20_INVALID_POLICY_ENGINE_FAILS_EAGERLY",
  "P3_21_COORDINATOR_DEPENDENCY_ERRORS_PROPAGATE_CANONICALLY",
  "P3_22_FORBIDDEN_EXECUTOR_OPTION_FAILS",
  "P3_23_FORBIDDEN_SAFETY_GUARD_OPTION_FAILS",
  "P3_24_FORBIDDEN_RECOVERY_AUTHORIZER_OPTION_FAILS",
  "P3_25_EXECUTION_MODE_IS_DISABLED",
  "P3_26_GET_EXECUTOR_RETURNS_NULL",
  "P3_27_COMPOSITION_IS_FROZEN",
  "P3_28_COORDINATOR_FACADE_IS_FROZEN",
  "P3_29_CONCRETE_COORDINATOR_IS_NOT_EXPOSED",
  "P3_30_SET_EXECUTOR_IS_NOT_EXPOSED",
  "P3_31_ATTEMPT_OPERATIONAL_RECOVERY_IS_NOT_EXPOSED",
  "P3_32_PUBLISHER_VIEW_HAS_ALL_REQUIRED_METHODS",
  "P3_33_PUBLISHER_VIEW_HAS_NO_ANCHOR",
  "P3_34_PUBLISHER_VIEW_HAS_NO_RETRY",
  "P3_35_SUBMIT_PROPOSAL_RETURNS_NO_EXECUTOR_REJECTION",
  "P3_36_NO_EXECUTOR_REJECTION_IS_PERSISTED",
  "P3_37_REGISTER_PENDING_REMAINS_ZERO",
  "P3_REPLAY_IS_CALLED_ONCE_PER_SUCCESSFUL_REJECTION_SAVE",
  "P3_39_NO_EXECUTOR_EXECUTION_RESULT_IS_NOT_PRODUCED",
  "P3_40_NO_TRADING_DISPATCH_OCCURS",
  "P3_41_RUN_CYCLE_REACHES_NO_EXECUTOR",
  "P3_42_AGENT_PROPOSE_CAN_RUN_BEFORE_EXECUTOR_GATE",
  "P3_43_AGENT_VOTE_CAN_RUN_BEFORE_EXECUTOR_GATE",
  "P3_44_RUN_CYCLE_REGISTER_PENDING_REMAINS_ZERO",
  "P3_45_RUN_CYCLE_REPLAY_OCCURS_AFTER_SAVED_REJECTION",
  "P3_46_MULTIPLE_FACTORY_CALLS_RETURN_DISTINCT_FACADES",
  "P3_47_MULTIPLE_FACTORY_CALLS_HAVE_NO_INTERNAL_CACHE",
  "P3_48_CALLER_OWNED_DEPENDENCIES_CAN_BE_SHARED",
  "P3_49_FACTORY_DOES_NOT_ENFORCE_PROCESS_SINGLETON",
] as const

let passed = 0
let failed = 0

function assertScenario(name: typeof scenarios[number], condition: boolean, detail = ""): void {
  if (condition) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function errorMessage(action: () => unknown): string {
  try {
    action()
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

class TestAudit implements IAudit {
  readonly name = "p3-audit"
  readonly entries: AuditEntry[] = []
  record(entry: AuditEntry): AuditWriteResult {
    this.entries.push(entry)
    return { recorded: true }
  }
  getById(id: string): AuditEntry | null {
    return this.entries.find(entry => entry.id === id) ?? null
  }
  updateEntry(): boolean { return false }
  getRecent(count: number): AuditEntry[] { return this.entries.slice(-count) }
  getByAgent(agentId: string): AuditEntry[] { return this.entries.filter(entry => entry.agentId === agentId) }
  getReport(since: number): AuditReport {
    return {
      totalActions: this.entries.filter(entry => entry.timestamp >= since).length,
      successful: 0,
      failed: 0,
      totalProfit: 0,
      totalGasCost: 0,
      topAgents: [],
      periodStart: since,
      periodEnd: Date.now(),
    }
  }
  clear(): void { this.entries.length = 0 }
}

class TestPersistence implements ExecutionDisabledIntentPersistence {
  readonly records = new Map<string, IntentRecord>()
  setDecisionReportCalls = 0
  publishThisMatches = true
  async publish(intent: AgentIntent): Promise<string> {
    this.publishThisMatches = this.publishThisMatches && this instanceof TestPersistence
    this.records.set(intent.id, {
      intent: { ...intent },
      status: "CREATED",
      votes: [],
      createdAt: Date.now(),
      statusHistory: [{ status: "CREATED", timestamp: Date.now() }],
    })
    return intent.id
  }
  getRecord(id: string): IntentRecord | null { return this.records.get(id) ?? null }
  list(filter?: IntentFilter): IntentRecord[] {
    let records = [...this.records.values()]
    if (filter?.agentId) records = records.filter(record => record.intent.agentId === filter.agentId)
    return records
  }
  updateStatus(id: string, status: IntentStatus): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.status = status
    record.statusHistory?.push({ status, timestamp: Date.now() })
    return true
  }
  recordVote(id: string, vote: IntentRecord["votes"][number]): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.votes.push({ ...vote })
    return true
  }
  recordResult(id: string, result: NonNullable<IntentRecord["result"]>): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.result = { ...result }
    return true
  }
  setDecisionReport(id: string, report: DecisionReport): boolean {
    this.setDecisionReportCalls++
    const record = this.records.get(id)
    if (!record) return false
    record.decisionReport = report
    return true
  }
  subscribe(): () => void { return () => {} }
}

class TestAgent implements IAgent {
  proposeCalls = 0
  voteCalls = 0
  constructor(readonly agentId: string, private proposal: AgentProposal | null = null) {}
  getIdentity(): AgentIdentity {
    return { agentId: this.agentId, name: this.agentId, version: "1", level: 1, canExecuteSolo: false, maxAmountUSD: 1 }
  }
  propose(): AgentProposal | null { this.proposeCalls++; return this.proposal }
  vote(proposal: AgentProposal): AgentVote {
    this.voteCalls++
    return { agentId: this.agentId, proposalId: proposal.id, approved: true, confidence: 100, reason: "approved", timestamp: Date.now() }
  }
  onFeedback(): void {}
}

function knowledgeReport(): KnowledgeReport {
  return {
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
}

type Harness = {
  audit: TestAudit
  persistence: TestPersistence
  policyEngine: PolicyEngine
  deps: CoordinatorDecisionDependencies
  registerPendingCalls: number
  replayCalls: string[]
}

function harness(): Harness {
  const state: Harness = {
    audit: new TestAudit(),
    persistence: new TestPersistence(),
    policyEngine: new PolicyEngine(),
    deps: undefined as unknown as CoordinatorDecisionDependencies,
    registerPendingCalls: 0,
    replayCalls: [],
  }
  state.deps = {
    reputation: { getScore: () => 100 },
    knowledge: { query: async () => knowledgeReport() },
    settlementRegistry: {
      registerPending: record => {
        state.registerPendingCalls++
        return record
      },
    },
    settlementReplay: {
      replayForCorrelationId: correlationId => { state.replayCalls.push(correlationId) },
    },
  }
  return state
}

function options(state: Harness, name = "p3-test"): CreateServerCoordinatorOptions {
  return {
    name,
    minAgents: 2,
    audit: state.audit,
    intentPersistence: state.persistence,
    policyEngine: state.policyEngine,
    decisionDependencies: state.deps,
  }
}

function walkFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (["node_modules", ".git", ".next", "server"].includes(entry)) continue
    const path = resolve(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) found.push(...walkFiles(path))
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry)) found.push(path)
  }
  return found
}

function runBuild(): { status: number | null; output: string } {
  const command = process.platform === "win32"
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : "npm"
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run build"]
    : ["run", "build"]
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 600_000,
    env: process.env,
    windowsHide: true,
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.stack ?? ""}\nsignal=${result.signal ?? ""}`,
  }
}

async function main(): Promise<void> {
  console.log("\n=== RI-L1-P3 Server Factory Tests ===\n")

  const boundaryPath = resolve("lib/agent-framework/server/coordinator-factory.ts")
  const corePath = resolve("lib/agent-framework/server/_coordinator-factory-core.ts")
  const boundarySource = readFileSync(boundaryPath, "utf8")
  const coreSource = readFileSync(corePath, "utf8")
  const boundaryAst = ts.createSourceFile(boundaryPath, boundarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const coreAst = ts.createSourceFile(corePath, coreSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const boundaryStatements = boundaryAst.statements.filter(statement => !ts.isEmptyStatement(statement))
  const coreStatements = coreAst.statements.filter(statement => !ts.isEmptyStatement(statement))
  const firstBoundary = boundaryStatements[0]
  const firstCore = coreStatements[0]
  const boundaryStartsServerOnly =
    !!firstBoundary && ts.isImportDeclaration(firstBoundary) &&
    firstBoundary.moduleSpecifier.getText(boundaryAst) === '"server-only"'
  const coreStartsServerOnly =
    !!firstCore && ts.isImportDeclaration(firstCore) &&
    firstCore.moduleSpecifier.getText(coreAst) === '"server-only"'
  assertScenario("P3_CORE_FIRST_IMPORT_IS_SERVER_ONLY", coreStartsServerOnly)
  assertScenario("P3_01_BOUNDARY_FIRST_IMPORT_IS_SERVER_ONLY",
    boundaryStartsServerOnly)
  assertScenario("P3_BOUNDARY_AND_CORE_BOTH_ENFORCE_SERVER_ONLY",
    boundaryStartsServerOnly && coreStartsServerOnly)
  assertScenario("P3_02_BOUNDARY_ONLY_REEXPORTS_CORE",
    boundaryStatements.length === 2 && ts.isExportDeclaration(boundaryStatements[1]) && boundarySource.includes('from "./_coordinator-factory-core"'))
  assertScenario("P3_03_CORE_DOES_NOT_IMPORT_SINGLETONS", !/from\s+["'][^"']*singletons/.test(coreSource))
  assertScenario("P3_04_CORE_HAS_NO_DYNAMIC_SINGLETON_IMPORT", !/import\s*\([^)]*singletons|require\s*\([^)]*singletons/.test(coreSource))

  const singletonsSource = readFileSync(resolve("lib/agent-framework/singletons.ts"), "utf8")
  assertScenario("P3_05_SINGLETONS_DOES_NOT_IMPORT_P3", !/server[\\/]coordinator-factory|_coordinator-factory-core/.test(singletonsSource))
  const barrelSources = [
    "lib/agent-framework/index.ts",
    "lib/agent-framework/types/index.ts",
    "lib/agent-framework/client/index.ts",
  ].map(path => readFileSync(resolve(path), "utf8")).join("\n")
  assertScenario("P3_06_SHARED_BARRELS_DO_NOT_EXPORT_P3", !/server[\\/]|coordinator-factory/.test(barrelSources))
  const consumerSources = [...walkFiles(resolve("app")), ...walkFiles(resolve("lib"))]
    .filter(path => path !== boundaryPath && path !== corePath)
    .map(path => readFileSync(path, "utf8")).join("\n")
  assertScenario("P3_07_CURRENT_CONSUMERS_DO_NOT_IMPORT_P3", !/server[\\/]coordinator-factory|_coordinator-factory-core/.test(consumerSources))

  let topLevelNew = false
  let topLevelState = false
  for (const statement of coreAst.statements) {
    if (ts.isVariableStatement(statement)) {
      topLevelState = true
      const inspect = (node: ts.Node): void => {
        if (ts.isNewExpression(node)) topLevelNew = true
        ts.forEachChild(node, inspect)
      }
      inspect(statement)
    }
  }
  assertScenario("P3_08_CORE_HAS_NO_TOP_LEVEL_NEW", !topLevelNew)
  assertScenario("P3_09_CORE_HAS_NO_TOP_LEVEL_LISTENER_TIMER_OR_CACHE",
    !topLevelState && !/setRecordListener|setInterval|setTimeout|pendingSettlement|cache\s*=/.test(coreSource))
  assertScenario("P3_10_CORE_HAS_NO_WALLET_PROVIDER_SIGNER_CONTRACT_OR_TRADING_IMPORT",
    !/from\s+["']ethers|Wallet|JsonRpcProvider|\bSigner\b|\bContract\b|TradingAdapter/.test(coreSource))
  assertScenario("P3_11_CORE_DOES_NOT_CREATE_SETTLEMENT_REGISTRY", !/new\s+SettlementRegistry|from\s+["'][^"']*settlement-registry/.test(coreSource))
  assertScenario("P3_12_CORE_DOES_NOT_CREATE_REPLAY_QUEUE_OR_SETTLEMENT_LISTENER",
    !/pendingSettlementReplays|setRecordListener|function\s+replaySettlement/.test(coreSource))

  const validState = harness()
  const validComposition = createServerCoordinatorComposition(options(validState))
  assertScenario("P3_13_VALID_OPTIONS_CREATE_COMPOSITION", !!validComposition.coordinator)
  assertScenario("P3_14_INVALID_OPTIONS_OBJECT_FAILS",
    errorMessage(() => createServerCoordinatorComposition(null as unknown as CreateServerCoordinatorOptions)) ===
      "createServerCoordinatorComposition requires options to be an object")
  assertScenario("P3_15_EMPTY_NAME_FAILS",
    errorMessage(() => createServerCoordinatorComposition({ ...options(harness()), name: "  " })) ===
      "createServerCoordinatorComposition requires options.name to be a non-empty string")

  const invalidAudit = Object.create(harness().audit) as Record<string, unknown>
  Object.defineProperty(invalidAudit, "getReport", { value: undefined })
  assertScenario("P3_16_INVALID_AUDIT_FAILS_EAGERLY",
    errorMessage(() => createServerCoordinatorComposition({ ...options(harness()), audit: invalidAudit as unknown as IAudit })) ===
      "createServerCoordinatorComposition requires options.audit.getReport to be a function")

  const persistenceMethods = ["publish", "getRecord", "list", "updateStatus", "recordVote", "recordResult", "setDecisionReport", "subscribe"]
  const persistenceErrors = persistenceMethods.map(method => {
    const candidate = Object.create(harness().persistence) as Record<string, unknown>
    Object.defineProperty(candidate, method, { value: undefined })
    return errorMessage(() => createServerCoordinatorComposition({
      ...options(harness()),
      intentPersistence: candidate as unknown as ExecutionDisabledIntentPersistence,
    })) === `createServerCoordinatorComposition requires options.intentPersistence.${method} to be a function`
  })
  assertScenario("P3_17_EACH_MISSING_PERSISTENCE_METHOD_FAILS_EAGERLY", persistenceErrors.every(Boolean))

  class AnchoringPersistence extends TestPersistence { anchorDecision(): Promise<null> { return Promise.resolve(null) } }
  class RetryingPersistence extends TestPersistence { retryPendingProofs(): Promise<number> { return Promise.resolve(0) } }
  assertScenario("P3_18_ANCHOR_CAPABILITY_IS_REJECTED",
    errorMessage(() => createServerCoordinatorComposition({ ...options(harness()), intentPersistence: new AnchoringPersistence() as never })) ===
      "createServerCoordinatorComposition forbids anchoring and pending-proof retry capabilities")
  assertScenario("P3_19_RETRY_CAPABILITY_IS_REJECTED",
    errorMessage(() => createServerCoordinatorComposition({ ...options(harness()), intentPersistence: new RetryingPersistence() as never })) ===
      "createServerCoordinatorComposition forbids anchoring and pending-proof retry capabilities")
  assertScenario("P3_20_INVALID_POLICY_ENGINE_FAILS_EAGERLY",
    errorMessage(() => createServerCoordinatorComposition({ ...options(harness()), policyEngine: {} as PolicyEngine })) ===
      "createServerCoordinatorComposition requires options.policyEngine.isAllowed to be a function")

  const dependencyCases: Array<[Partial<CoordinatorDecisionDependencies>, string]> = [
    [{}, "Coordinator requires deps.reputation.getScore to be a function"],
    [{ reputation: { getScore: () => 0 } }, "Coordinator requires deps.knowledge.query to be a function"],
    [{ reputation: { getScore: () => 0 }, knowledge: { query: async () => knowledgeReport() } }, "Coordinator requires deps.settlementRegistry.registerPending to be a function"],
    [{ reputation: { getScore: () => 0 }, knowledge: { query: async () => knowledgeReport() }, settlementRegistry: { registerPending: record => record } }, "Coordinator requires deps.settlementReplay.replayForCorrelationId to be a function"],
  ]
  assertScenario("P3_21_COORDINATOR_DEPENDENCY_ERRORS_PROPAGATE_CANONICALLY",
    dependencyCases.every(([deps, expected]) => errorMessage(() => createServerCoordinatorComposition({
      ...options(harness()), decisionDependencies: deps as CoordinatorDecisionDependencies,
    })) === expected))
  for (const [scenario, property] of [
    ["P3_22_FORBIDDEN_EXECUTOR_OPTION_FAILS", "executor"],
    ["P3_23_FORBIDDEN_SAFETY_GUARD_OPTION_FAILS", "safetyGuard"],
    ["P3_24_FORBIDDEN_RECOVERY_AUTHORIZER_OPTION_FAILS", "recoveryAuthorizer"],
  ] as const) {
    assertScenario(scenario, errorMessage(() => createServerCoordinatorComposition({
      ...options(harness()), [property]: {},
    } as CreateServerCoordinatorOptions)) ===
      "createServerCoordinatorComposition forbids executor, safetyGuard, and recoveryAuthorizer capabilities")
  }

  assertScenario("P3_25_EXECUTION_MODE_IS_DISABLED", validComposition.executionMode === "disabled")
  assertScenario("P3_26_GET_EXECUTOR_RETURNS_NULL", validComposition.coordinator.getExecutor() === null)
  assertScenario("P3_27_COMPOSITION_IS_FROZEN", Object.isFrozen(validComposition))
  assertScenario("P3_28_COORDINATOR_FACADE_IS_FROZEN", Object.isFrozen(validComposition.coordinator))
  assertScenario("P3_29_CONCRETE_COORDINATOR_IS_NOT_EXPOSED", !(validComposition.coordinator instanceof Coordinator))
  assertScenario("P3_30_SET_EXECUTOR_IS_NOT_EXPOSED", !("setExecutor" in validComposition.coordinator))
  assertScenario("P3_31_ATTEMPT_OPERATIONAL_RECOVERY_IS_NOT_EXPOSED", !("attemptOperationalRecovery" in validComposition.coordinator))

  const viewMatch = coreSource.match(/const intentPublisher = Object\.freeze\(\{([\s\S]*?)\}\) satisfies IIntentPublisher/)
  const viewSource = viewMatch?.[1] ?? ""
  assertScenario("P3_32_PUBLISHER_VIEW_HAS_ALL_REQUIRED_METHODS",
    persistenceMethods.every(method => new RegExp(`\\b${method}:`).test(viewSource)) && validState.persistence.publishThisMatches)
  assertScenario("P3_33_PUBLISHER_VIEW_HAS_NO_ANCHOR", !/anchorDecision\s*:/.test(viewSource))
  assertScenario("P3_34_PUBLISHER_VIEW_HAS_NO_RETRY", !/retryPendingProofs\s*:/.test(viewSource))

  const submitState = harness()
  const submitComposition = createServerCoordinatorComposition(options(submitState, "p3-submit"))
  submitComposition.coordinator.registerAgent(new TestAgent("submit-a"))
  submitComposition.coordinator.registerAgent(new TestAgent("submit-b"))
  const proposal: AgentProposal = { id: "p3-submit-proposal", agentId: "source", action: "TEST", params: {}, confidence: 100, timestamp: Date.now() }
  const submitResult = await submitComposition.coordinator.submitProposal(proposal)
  const submitIntentId = `intent_${proposal.agentId}_${proposal.timestamp}`
  const submitReport = submitState.persistence.getRecord(submitIntentId)?.decisionReport
  assertScenario("P3_35_SUBMIT_PROPOSAL_RETURNS_NO_EXECUTOR_REJECTION",
    submitResult.kind === "decision" && submitResult.consensus.approved === false && submitResult.consensus.reason === "No executor configured")
  assertScenario("P3_36_NO_EXECUTOR_REJECTION_IS_PERSISTED", submitReport?.rejection?.rejectionCode === "NO_EXECUTOR")
  assertScenario("P3_37_REGISTER_PENDING_REMAINS_ZERO", submitState.registerPendingCalls === 0)
  assertScenario("P3_REPLAY_IS_CALLED_ONCE_PER_SUCCESSFUL_REJECTION_SAVE",
    submitState.replayCalls.length === submitState.persistence.setDecisionReportCalls &&
      submitState.replayCalls.every(id => id === submitIntentId))
  assertScenario("P3_39_NO_EXECUTOR_EXECUTION_RESULT_IS_NOT_PRODUCED",
    submitResult.kind === "decision" && submitResult.executionResult === undefined && submitReport?.execution === undefined)
  assertScenario("P3_40_NO_TRADING_DISPATCH_OCCURS", submitState.registerPendingCalls === 0 && !coreSource.includes("TradingAdapter"))

  const cycleState = harness()
  const cycleComposition = createServerCoordinatorComposition(options(cycleState, "p3-cycle"))
  const cycleProposal: AgentProposal = { id: "p3-cycle-proposal", agentId: "cycle-a", action: "TEST", params: {}, confidence: 100, timestamp: Date.now() + 1 }
  const cycleA = new TestAgent("cycle-a", cycleProposal)
  const cycleB = new TestAgent("cycle-b")
  cycleComposition.coordinator.registerAgent(cycleA)
  cycleComposition.coordinator.registerAgent(cycleB)
  const cycleResult = await cycleComposition.coordinator.runCycle()
  const cycleReport = cycleState.persistence.list().map(record => record.decisionReport).find(report => report?.rejection?.rejectionCode === "NO_EXECUTOR")
  assertScenario("P3_41_RUN_CYCLE_REACHES_NO_EXECUTOR", !!cycleReport && cycleResult.kind === "cycle_report")
  assertScenario("P3_42_AGENT_PROPOSE_CAN_RUN_BEFORE_EXECUTOR_GATE", cycleA.proposeCalls > 0 && cycleB.proposeCalls > 0)
  assertScenario("P3_43_AGENT_VOTE_CAN_RUN_BEFORE_EXECUTOR_GATE", cycleA.voteCalls > 0 && cycleB.voteCalls > 0)
  assertScenario("P3_44_RUN_CYCLE_REGISTER_PENDING_REMAINS_ZERO", cycleState.registerPendingCalls === 0)
  assertScenario("P3_45_RUN_CYCLE_REPLAY_OCCURS_AFTER_SAVED_REJECTION", cycleState.replayCalls.length > 0)

  const sharedState = harness()
  const first = createServerCoordinatorComposition(options(sharedState, "p3-first"))
  const second = createServerCoordinatorComposition(options(sharedState, "p3-second"))
  assertScenario("P3_46_MULTIPLE_FACTORY_CALLS_RETURN_DISTINCT_FACADES", first.coordinator !== second.coordinator)
  assertScenario("P3_47_MULTIPLE_FACTORY_CALLS_HAVE_NO_INTERNAL_CACHE", first !== second && first.coordinator.getAgents() !== second.coordinator.getAgents())
  assertScenario("P3_48_CALLER_OWNED_DEPENDENCIES_CAN_BE_SHARED",
    first.coordinator.getAudit() === sharedState.audit && second.coordinator.getAudit() === sharedState.audit &&
      first.coordinator.getPolicyEngine() === sharedState.policyEngine && second.coordinator.getPolicyEngine() === sharedState.policyEngine)
  assertScenario("P3_49_FACTORY_DOES_NOT_ENFORCE_PROCESS_SINGLETON", first.coordinator.name !== second.coordinator.name)

  // Next treats route folders beginning with `_` as private and excludes them
  // from routing. Use a routable temporary folder so every build reaches the
  // intended server-only import boundary.
  const probeDirectory = resolve("app/ri_l1_p3_server_boundary_probe")
  const probeFile = resolve(probeDirectory, "page.tsx")
  const serverProbeSource = `import {\n  createServerCoordinatorComposition,\n} from "../../lib/agent-framework/server/coordinator-factory"\n\nexport default function P3ServerBoundaryProbe() {\n  return <div>{typeof createServerCoordinatorComposition}</div>\n}\n`
  const clientBoundaryProbeSource = `"use client"\n\nimport {\n  createServerCoordinatorComposition,\n} from "../../lib/agent-framework/server/coordinator-factory"\n\nexport default function P3ClientBoundaryProbe() {\n  return <div>{typeof createServerCoordinatorComposition}</div>\n}\n`
  const clientCoreProbeSource = `"use client"\n\nimport {\n  createServerCoordinatorComposition,\n} from "../../lib/agent-framework/server/_coordinator-factory-core"\n\nexport default function P3ClientCoreProbe() {\n  return <div>{typeof createServerCoordinatorComposition}</div>\n}\n`
  let baselineBuildExit: number | null = null
  let serverProbeBuildExit: number | null = null
  let clientBoundaryBuildExit: number | null = null
  let clientBoundaryReasonMatched = false
  let clientCoreBuildExit: number | null = null
  let clientCoreReasonMatched = false
  let postCleanupBuildExit: number | null = null
  let serverProbeCreated = false
  let allProbesRemoved = false

  const baselineBuild = runBuild()
  baselineBuildExit = baselineBuild.status
  if (baselineBuildExit !== 0) throw new Error(`P3 client-boundary precondition build failed:\n${baselineBuild.output}`)

  try {
    mkdirSync(probeDirectory, { recursive: false })
    writeFileSync(probeFile, serverProbeSource, "utf8")
    serverProbeCreated = existsSync(probeFile)

    const serverProbeBuild = runBuild()
    serverProbeBuildExit = serverProbeBuild.status
    if (serverProbeBuildExit !== 0) {
      throw new Error(`P3 server-boundary import build failed:\n${serverProbeBuild.output}`)
    }

    writeFileSync(probeFile, clientBoundaryProbeSource, "utf8")
    const clientBoundaryBuild = runBuild()
    clientBoundaryBuildExit = clientBoundaryBuild.status
    clientBoundaryReasonMatched = /server-only|Server-only|only works in a Server Component/i.test(clientBoundaryBuild.output)
    if (clientBoundaryBuildExit === 0 || !clientBoundaryReasonMatched) {
      throw new Error(`P3 client-boundary build did not fail for server-only reason:\n${clientBoundaryBuild.output}`)
    }

    writeFileSync(probeFile, clientCoreProbeSource, "utf8")
    const clientCoreBuild = runBuild()
    clientCoreBuildExit = clientCoreBuild.status
    clientCoreReasonMatched = /server-only|Server-only|only works in a Server Component/i.test(clientCoreBuild.output)
    if (clientCoreBuildExit === 0 || !clientCoreReasonMatched) {
      throw new Error(`P3 client-core build did not fail for server-only reason:\n${clientCoreBuild.output}`)
    }
  } finally {
    rmSync(probeFile, { force: true })
    if (existsSync(probeDirectory) && readdirSync(probeDirectory).length === 0) rmdirSync(probeDirectory)
    allProbesRemoved = !existsSync(probeFile) && !existsSync(probeDirectory)
    postCleanupBuildExit = runBuild().status
  }

  console.log("\nCLIENT BOUNDARY SUMMARY")
  console.log(`PRECONDITION_BUILD_EXIT=${baselineBuildExit}`)
  console.log(`SERVER_PROBE_CREATED=${serverProbeCreated ? "YES" : "NO"}`)
  console.log(`SERVER_PROBE_BUILD_EXIT=${serverProbeBuildExit}`)
  console.log(`CLIENT_BOUNDARY_PROBE_EXPECTED_FAILURE=${clientBoundaryBuildExit !== 0 ? "YES" : "NO"}`)
  console.log(`CLIENT_BOUNDARY_FAILURE_REASON_MATCHED=${clientBoundaryReasonMatched ? "YES" : "NO"}`)
  console.log(`CLIENT_CORE_PROBE_EXPECTED_FAILURE=${clientCoreBuildExit !== 0 ? "YES" : "NO"}`)
  console.log(`CLIENT_CORE_FAILURE_REASON_MATCHED=${clientCoreReasonMatched ? "YES" : "NO"}`)
  console.log(`ALL_PROBES_REMOVED=${allProbesRemoved ? "YES" : "NO"}`)
  console.log(`POST_CLEANUP_BUILD_EXIT=${postCleanupBuildExit}`)

  if (!serverProbeCreated || serverProbeBuildExit !== 0 || clientBoundaryBuildExit === 0 ||
      !clientBoundaryReasonMatched || clientCoreBuildExit === 0 || !clientCoreReasonMatched ||
      !allProbesRemoved || postCleanupBuildExit !== 0) failed++

  console.log(`\nP3 Results: ${passed} passed, ${failed} failed, ${scenarios.length} scenarios`)
  console.log(`P3_ASSERTIONS=${passed}/${scenarios.length}`)
  console.log(`NO_EXECUTOR_REGISTER_PENDING_CALLS=${submitState.registerPendingCalls}`)
  console.log(`NO_EXECUTOR_SUCCESSFUL_REPORT_SAVES=${submitState.persistence.setDecisionReportCalls}`)
  console.log(`NO_EXECUTOR_REPLAY_CALLS=${submitState.replayCalls.length}`)
  console.log(`REPLAY_CALLS_PER_SUCCESSFUL_SAVE=${submitState.replayCalls.length / submitState.persistence.setDecisionReportCalls}`)
  if (failed !== 0 || passed !== scenarios.length) process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
