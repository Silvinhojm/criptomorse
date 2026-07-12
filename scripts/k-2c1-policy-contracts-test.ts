import { Audit } from "../lib/agent-framework/audit"
import type { AuditEntry } from "../lib/agent-framework/IAudit"
import type { AgentProposal } from "../lib/agent-framework/IAgent"
import type { DecisionReport, RejectionCode, RejectionMetadata } from "../lib/agent-framework/decision-report"
import { PolicyEngine } from "../lib/agent-framework/policy-engine"

let passed = 0
let failed = 0

function assert(label: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`✅ ${label}`)
  } else {
    failed++
    console.error(`❌ ${label}`)
  }
}

function expectRangeError(label: string, fn: () => void): void {
  try {
    fn()
    assert(label, false)
  } catch (error) {
    assert(label, error instanceof RangeError)
  }
}

const rejectionCodes: RejectionCode[] = [
  "SAFETY_GUARD_OPEN",
  "DUPLICATE_INTENT",
  "KNOWLEDGE_CAN_TRADE_FALSE",
  "PRE_VOTE_POLICY_REJECTED",
  "VOTING_REJECTED",
  "NO_EXECUTOR",
  "PRE_EXEC_POLICY_REJECTED",
  "EXECUTOR_CAN_EXECUTE_FALSE",
]
assert("all eight RejectionCode values are accepted", rejectionCodes.length === 8)

if (false) {
  // @ts-expect-error invalid rejection code must not compile
  const invalidCode: RejectionCode = "INVALID_REJECTION_CODE"
  void invalidCode
}

const legacyReport: DecisionReport = {
  id: "decision_legacy",
  intentId: "intent_legacy",
  agentId: "agent",
  action: "BUY",
  params: {},
  createdAt: 1,
}
assert("legacy DecisionReport remains valid without new fields", legacyReport.outcome === undefined)

const rejection: RejectionMetadata = {
  rejectedBy: "policy",
  rejectionCode: "PRE_VOTE_POLICY_REJECTED",
  rejectionStage: "pre_vote_policy",
  rejectionReason: "test rejection",
  sourcePath: "submitProposal",
  occurredAt: 2,
}
const rejectedReport: DecisionReport = {
  ...legacyReport,
  id: "decision_rejected",
  outcome: "rejected",
  rejection,
  auditStatus: "recorded",
}
assert("rejected report accepts RejectionMetadata", rejectedReport.rejection?.rejectionCode === rejection.rejectionCode)

const auditStates: NonNullable<DecisionReport["auditStatus"]>[] = ["not_attempted", "recorded", "write_failed"]
assert("auditStatus accepts exactly the three designed states", auditStates.length === 3)
if (false) {
  // @ts-expect-error invalid audit status must not compile
  const invalidAuditStatus: NonNullable<DecisionReport["auditStatus"]> = "unknown"
  void invalidAuditStatus
}

const proposal: AgentProposal = {
  id: "proposal_test",
  agentId: "agent",
  action: "BUY",
  params: {},
  confidence: 50,
  timestamp: 1,
}
function auditEntry(id: string): AuditEntry {
  return {
    id,
    timestamp: 1,
    agentId: "agent",
    action: "BUY",
    proposal,
    result: null,
    consensus: { approved: false, confidence: 0, voters: 0 },
    tags: [],
  }
}

const audit = new Audit("k2c1", 2)
const firstWrite = audit.record(auditEntry("audit_1"))
audit.record(auditEntry("audit_2"))
audit.record(auditEntry("audit_3"))
assert("Audit.record returns recorded=true", firstWrite.recorded === true && firstWrite.error === undefined)
assert("recorded Audit entry is observable", audit.getRecent(10).some(entry => entry.id === "audit_3"))
assert("Audit preserves newest-first read order", audit.getRecent(2).map(entry => entry.id).join(",") === "audit_3,audit_2")
assert("Audit preserves configured maximum", audit.getRecent(10).length === 2)
assert("Audit API has no retry method", !("retry" in audit))
assert("Audit API has no persistence method", !("save" in audit) && !("load" in audit))

const defaults = new PolicyEngine()
assert("minimum confidence default threshold is 10", defaults.getMinimumConfidencePolicy().threshold === 10)
assert("minimum confidence default is enabled", defaults.getMinimumConfidencePolicy().enabled === true)
assert("isAllowed agrees with typed default", defaults.isAllowed("requireMinimumConfidence") === defaults.getMinimumConfidencePolicy().enabled)

const zero = new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: 0 } })
assert("threshold 0 is valid", zero.getMinimumConfidencePolicy().threshold === 0)
const hundred = new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: 100 } })
assert("threshold 100 is valid", hundred.getMinimumConfidencePolicy().threshold === 100)
expectRangeError("negative threshold is rejected", () => new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: -1 } }))
expectRangeError("threshold above 100 is rejected", () => new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: 101 } }))
expectRangeError("NaN threshold is rejected", () => new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: Number.NaN } }))
expectRangeError("infinite threshold is rejected", () => new PolicyEngine({ rules: [], minimumConfidence: { enabled: true, threshold: Number.POSITIVE_INFINITY } }))

const thresholdOnly = new PolicyEngine({
  rules: [],
  minimumConfidence: { enabled: true, threshold: 10, networkOverrides: { polygon: { threshold: 30 } } },
})
assert("threshold-only override inherits enabled", thresholdOnly.getMinimumConfidencePolicy("polygon").enabled === true)
assert("threshold-only override applies threshold", thresholdOnly.getMinimumConfidencePolicy("polygon").threshold === 30)

const enabledOnly = new PolicyEngine({
  rules: [],
  minimumConfidence: { enabled: true, threshold: 10, networkOverrides: { polygon: { enabled: false } } },
})
assert("enabled-only override inherits threshold", enabledOnly.getMinimumConfidencePolicy("polygon").threshold === 10)
assert("enabled-only override applies enabled", enabledOnly.getMinimumConfidencePolicy("polygon").enabled === false)
assert("isAllowed agrees with enabled-only override", enabledOnly.isAllowed("requireMinimumConfidence", "polygon") === false)

const both = new PolicyEngine({
  rules: [],
  minimumConfidence: { enabled: false, threshold: 15, networkOverrides: { arc: { enabled: true, threshold: 25 } } },
})
assert("combined override applies enabled", both.getMinimumConfidencePolicy("arc").enabled === true)
assert("combined override applies threshold", both.getMinimumConfidencePolicy("arc").threshold === 25)
assert("combined override reports network source", both.getMinimumConfidencePolicy("arc").source === "network_override")

defaults.disable("requireMinimumConfidence")
assert("legacy disable synchronizes typed policy", defaults.getMinimumConfidencePolicy().enabled === false && defaults.isAllowed("requireMinimumConfidence") === false)
defaults.enable("requireMinimumConfidence")
defaults.setNetworkOverride("requireMinimumConfidence", "polygon", false)
assert("legacy network override synchronizes typed policy", defaults.getMinimumConfidencePolicy("polygon").enabled === false && defaults.isAllowed("requireMinimumConfidence", "polygon") === false)
defaults.setRule("requireMinimumConfidence", { enabled: false })
assert("legacy setRule synchronizes typed policy", defaults.getMinimumConfidencePolicy().enabled === false && defaults.isAllowed("requireMinimumConfidence") === false)

const getterIsolation = new PolicyEngine()
getterIsolation.setNetworkOverride("requireMinimumConfidence", "polygon", true)
const returnedRule = getterIsolation.getRule("requireMinimumConfidence")
if (returnedRule) {
  returnedRule.enabled = false
  if (returnedRule.networkOverrides) returnedRule.networkOverrides.polygon = false
}
assert("getRule enabled mutation cannot change isAllowed", getterIsolation.isAllowed("requireMinimumConfidence") === true)
assert("getRule override mutation cannot change typed policy", getterIsolation.getMinimumConfidencePolicy("polygon").enabled === true)
assert("new getRule call excludes external mutations", getterIsolation.getRule("requireMinimumConfidence")?.enabled === true && getterIsolation.getRule("requireMinimumConfidence")?.networkOverrides?.polygon === true)

const returnedRules = getterIsolation.getAllRules()
const returnedMinimum = returnedRules.find(rule => rule.name === "requireMinimumConfidence")
if (returnedMinimum) {
  returnedMinimum.enabled = false
  if (returnedMinimum.networkOverrides) returnedMinimum.networkOverrides.polygon = false
}
returnedRules.splice(0, returnedRules.length)
assert("getAllRules object mutation cannot change internal state", getterIsolation.isAllowed("requireMinimumConfidence") === true)
assert("getAllRules override mutation cannot change internal state", getterIsolation.getMinimumConfidencePolicy("polygon").enabled === true)
assert("getAllRules array mutation cannot remove internal rules", getterIsolation.getAllRules().length > 0)

const suppliedRule = {
  name: "requireMinimumConfidence",
  enabled: true,
  description: "supplied rule",
  networkOverrides: { polygon: true },
}
const suppliedRuleEngine = new PolicyEngine({ rules: [suppliedRule] })
suppliedRule.enabled = false
suppliedRule.networkOverrides.polygon = false
assert("constructor defensively copies supplied rule", suppliedRuleEngine.isAllowed("requireMinimumConfidence") === true)
assert("constructor defensively copies supplied overrides", suppliedRuleEngine.getMinimumConfidencePolicy("polygon").enabled === true && suppliedRuleEngine.getRule("requireMinimumConfidence")?.networkOverrides?.polygon === true)

suppliedRuleEngine.disable("requireMinimumConfidence")
suppliedRuleEngine.enable("requireMinimumConfidence")
suppliedRuleEngine.setNetworkOverride("requireMinimumConfidence", "polygon", false)
suppliedRuleEngine.setRule("requireMinimumConfidence", { enabled: false })
suppliedRuleEngine.setMinimumConfidencePolicy({ enabled: true, threshold: 20 })
assert("official mutator APIs remain effective", suppliedRuleEngine.isAllowed("requireMinimumConfidence") === true && suppliedRuleEngine.getMinimumConfidencePolicy().threshold === 20)

const ruleNames = new PolicyEngine().getAllRules().map(rule => rule.name)
assert("enableAuditTrail is absent from DEFAULT_RULES", !ruleNames.includes("enableAuditTrail"))
assert("requireVotingConsensus remains present", ruleNames.includes("requireVotingConsensus"))
assert("allowSyntheticRoutes remains present", ruleNames.includes("allowSyntheticRoutes"))
assert("allowDirectStressTransactions remains present", ruleNames.includes("allowDirectStressTransactions"))
const routeRules = new PolicyEngine().getAllRules()
assert("synthetic Polygon override remains false", routeRules.find(rule => rule.name === "allowSyntheticRoutes")?.networkOverrides?.polygon === false)
assert("direct transaction Polygon override remains false", routeRules.find(rule => rule.name === "allowDirectStressTransactions")?.networkOverrides?.polygon === false)

console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exitCode = 1
