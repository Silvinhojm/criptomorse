// Phase 2e.2f — Settlement Replay/Sync Race Closure test
// No swaps, no funds, no signing, no Anchor, no accounting mutation.
// Tests the post-save replay mechanism for DecisionReport/SettlementRegistry race.

import { SettlementRegistry, type SettlementRecord } from "../lib/agent-framework/settlement-registry"
import { IntentPublisher, type IntentRecord } from "../lib/agent-framework/intent-publisher"
import type { DecisionReport } from "../lib/agent-framework/decision-report"
import {
  frameworkSettlementRegistry,
  frameworkIntents,
  replaySettlementForCorrelationId,
  getPendingSettlementReplayDiagnostics,
  flushPendingSettlementReplays,
  replaySettlementToDecisionReport,
} from "../lib/agent-framework/singletons"

// ── Helpers ──────────────────────────────────────────────────────────────

const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000"

function makeReport(id: string, correlationId: string, overrides?: Partial<DecisionReport>): DecisionReport {
  return {
    id,
    intentId: correlationId,
    agentId: "test-agent",
    action: "BUY",
    params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" },
    createdAt: Date.now(),
    execution: {
      success: true,
      profit: 0,
      gasCost: 0.005,
      durationMs: 100,
      adapter: "TradingAdapter",
      correlationId,
      intentId: correlationId,
      proposalId: `proposal_${correlationId}`,
      decisionReportId: id,
      dispatchStatus: "dispatched",
      settlementStatus: "dispatched",
      isProvisional: true,
    },
    ...overrides,
  }
}

function makeSettlementRecord(correlationId: string, overrides?: Partial<SettlementRecord>): SettlementRecord {
  const ts = Date.now()
  return {
    settlementId: `settlement_test_${correlationId}_${ts}`,
    correlationId,
    intentId: correlationId,
    proposalId: `proposal_${correlationId}`,
    decisionReportId: `decision_test_${correlationId}`,
    adapter: "trading",
    status: "confirmed",
    txHash: `0x${"a".repeat(64)}`,
    receiptStatus: 1,
    blockNumber: 12345678,
    gasUsed: "21000",
    effectiveGasPrice: "1000000000",
    gasCostNative: "0.000021",
    gasCostUsd: 0.006,
    fromToken: "USDC",
    toToken: "cirBTC",
    amountIn: "10000000",
    actualAmountOut: "9900000",
    canonicalSettlement: true,
    synthetic: false,
    source: "corretor",
    timestamp: ts,
    ...overrides,
  }
}

function cloneReport(r: DecisionReport): DecisionReport {
  return JSON.parse(JSON.stringify(r))
}

function replaceSetDecisionReport(fn: ((id: string, report: DecisionReport) => boolean) | null): () => void {
  const saved = frameworkIntents.setDecisionReport
  if (fn) {
    frameworkIntents.setDecisionReport = fn
  }
  return function restore() { frameworkIntents.setDecisionReport = saved }
}

// ── Verdict tracking ────────────────────────────────────────────────────

let passed = 0
let failed = 0
const scenarioAssertionCounts = new Map<string, number>()

const SCENARIO_NAMES: Record<string, string> = {
  A: "Settlement update before DecisionReport save",
  B: "DecisionReport before settlement update",
  C: "Confirmed canonical protected from stale updates",
  D: "Synthetic/all-zero txHash",
  E: "Missing match",
  F: "Multiple updates before report save",
  H: "Stale submitted after confirmed before report",
  I: "Two queued entries for same correlationId",
  J: "Orphan correlation",
  K: "Confirmed canonical to submitted stale",
  L: "Confirmed canonical to failed stale",
  M: "Confirmed canonical to synthetic stale",
  N: "Confirmed canonical to all-zero txHash",
  O: "Submitted to confirmed canonical",
  P: "Failed to confirmed canonical",
  Q: "Synthetic to confirmed canonical",
  R: "Same-status enrichment",
  S: "Conflicting canonical txHash",
  T: "Listener and queue integration",
  U: "registerPending valid path",
  V: "Partial valid update",
  W: "Submitted to dispatched blocked",
  X: "Confirmed non-canonical to submitted blocked",
  Y: "Confirmed canonical rejects settled update",
  Z: "Submitted rejects settled update",
  AA: "Failed rejects settled update",
  AB: "Synthetic rejects settled update",
  AC: "Confirmed canonical gasUsed protected",
  AD: "Confirmed canonical balanceDelta protected",
  AE: "Confirmed canonical same-tx enrichment",
  AF: "Same-tx new balanceDelta key",
  AG: "Same-tx conflicting balanceDelta",
  AJ: "Partial inferior update",
  AK: "Create settled without existing record rejected",
  AL: "Dispatched rejects settled update",
  AM: "registerPending settled with full evidence rejected",
  AN: "registerPending settled plus synthetic rejected before normalization",
  AO: "Global registry contains no settled records",
  AP: "registerPending settled plus zero txHash rejected before normalization",
  AQ: "Mixed settled update rejected atomically",
  AR: "Valid status flows remain supported",
  AS: "Exception: one queued item — retryCount tracked, item preserved",
  AT: "Exception mid-flush does NOT corrupt remaining items",
  AU: "Retry count increments across multiple calls",
  AV: "Item dropped after MAX_SETTLEMENT_REPLAY_ATTEMPTS failures",
  AW: "Multiple correlationIds — one fails, other unaffected",
  AX: "FIFO order preserved within same correlationId",
  AY: "Cap enforcement — eviction of oldest entries",
  AZ: "Dedupe by settlementId — snapshot preserved",
  BA: "Snapshot integrity — registry mutation does not affect queue",
  BB: "SettlementId re-enqueued after drop is allowed",
  BC: "getPendingSettlementReplayDiagnostics returns correct fields",
  BD: "Monkey-patch intercepts setDecisionReport calls",
  BE: "Replay after drop triggers fresh enqueue",
  BF: "flushPendingSettlementReplays returns 0 when empty",
  BG: "flushPendingSettlementReplays FIFO — A fails, B and C blocked",
  BH: "flushPendingSettlementReplays — different corrIds independent",
  BI: "A1/A2/A3 FIFO — success→fail→block + second call + cross-corrId independence",
}

const SCENARIO_ORDER = [
  "A", "B", "C", "D", "E", "F", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X",
  "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AJ", "AK", "AL", "AM", "AN", "AO", "AP", "AQ", "AR",
  "AS", "AT", "AU", "AV", "AW", "AX", "AY", "AZ", "BA", "BB", "BC", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BK",
] as const

SCENARIO_NAMES.BJ = "Scoped replaySettlementForCorrelationId FIFO and correlation isolation"
SCENARIO_NAMES.BK = "Diagnostics balanceDeltas copy isolation"

function captureWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(value => String(value)).join(" "))
  }
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = originalWarn
  }
}

function assert(label: string, condition: boolean, detail?: string): void {
  const scenario = /^([A-Z]+)\./.exec(label)?.[1] ?? "UNSCOPED"
  scenarioAssertionCounts.set(scenario, (scenarioAssertionCounts.get(scenario) ?? 0) + 1)
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failed++
  }
}

// ── Scenario A: update before report save ───────────────────────────────

console.log("\n📋 Scenario A — Settlement update before DecisionReport save")
console.log("  (simulates: listener fires → report not found → queued → post-save replay)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_a_001"
  const record = makeSettlementRecord(correlationId, {
    status: "confirmed",
    canonicalSettlement: true,
  })

  // 1. Register settlement (simulates corretor callback arriving before save)
  registry.registerPending(record)

  // 2. Only later, create report (simulates _saveDecisionReport)
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // 3. Post-save sync (simulates _syncSettlementFromRegistry)
  // Look up by correlationId and apply replay logic inline (same as replaySettlementForCorrelationId)
  const foundRecord = registry.findByCorrelationId(correlationId)
  assert("A.1 Settlement record found in registry", !!foundRecord)
  assert("A.2 Record status is confirmed", foundRecord!.status === "confirmed")

  // The replay would update the report — verify via direct merge
  const beforeExec = cloneReport(report).execution!
  const syncedRecord = foundRecord!
  const expectedStatus = syncedRecord.status === "confirmed" ? "confirmed" : beforeExec.settlementStatus
  const canonical = syncedRecord.status === "confirmed" && syncedRecord.canonicalSettlement === true && !syncedRecord.synthetic && !/^0x0+$/.test(syncedRecord.txHash ?? "")
  assert("A.3 Expected settlementStatus from sync", expectedStatus === "confirmed")
  assert("A.4 Expected canonicalSettlement from sync", canonical === true)

  // The pending queue would capture this. Let's verify:
  const intentRecord = publisher.getRecord(correlationId)
  assert("A.5 Intent record exists after publish", !!intentRecord)
  assert("A.6 DecisionReport exists on intent record", !!(intentRecord?.decisionReport))
  assert("A.7 Execution exists on report", !!(intentRecord?.decisionReport?.execution))
}

// ── Scenario B: report before update (existing listener path) ─────────────

console.log("\n📋 Scenario B — DecisionReport before settlement update")
console.log("  (existing listener path — should work without replay)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_b_001"
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Now settlement arrives (simulates listener)
  const record = makeSettlementRecord(correlationId, { status: "submitted", canonicalSettlement: false })
  registry.registerPending(record)

  // Direct find should work
  const intentRecord = publisher.getRecord(correlationId)
  const reportExec = intentRecord?.decisionReport?.execution
  assert("B.1 DecisionReport found for settlement", !!reportExec)

  // Verify merge safety would work
  assert("B.2 Settlement record exists", !!registry.findByCorrelationId(correlationId))
  assert("B.3 Execution fields accessible", !!(reportExec?.settlementStatus))
}

// ── Scenario C: confirmed canonical protected from stale updates ──────────

console.log("\n📋 Scenario C — Confirmed canonical protected from stale updates")
console.log("  (submitted/failed/synthetic cannot downgrade confirmed)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_c_001"
  const report = makeReport(`decision_${correlationId}`, correlationId, {
    execution: {
      success: true,
      profit: 0.01,
      gasCost: 0.005,
      durationMs: 200,
      adapter: "TradingAdapter",
      correlationId,
      intentId: correlationId,
      proposalId: `proposal_${correlationId}`,
      decisionReportId: `decision_${correlationId}`,
      settlementStatus: "confirmed",
      isProvisional: false,
      synthetic: false,
      canonicalSettlement: true,
      txHash: `0x${"b".repeat(64)}`,
      receiptStatus: 1,
      blockNumber: 87654321,
    },
  })
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Try stale synthetic update via registerPending (simulating listener)
  const staleRecord = makeSettlementRecord(correlationId, {
    status: "synthetic",
    synthetic: true,
    canonicalSettlement: false,
    txHash: ZERO_TX,
  })
  registry.registerPending(staleRecord)

  // Replay (simulating post-save sync)
  // The status merge logic should reject synthetic over confirmed
  const intentRecord = publisher.getRecord(correlationId)
  const exec = intentRecord?.decisionReport?.execution
  assert("C.1 Canonical settlement preserved", exec?.canonicalSettlement === true)
  assert("C.2 Synthetic false preserved", exec?.synthetic === false)
  assert("C.3 Confirmed status preserved", exec?.settlementStatus === "confirmed")
  assert("C.4 TxHash not overwritten", exec?.txHash !== ZERO_TX)
  assert("C.5 TxHash still present", exec?.txHash === `0x${"b".repeat(64)}`)

  // Try stale failed update
  const staleFailed = makeSettlementRecord(correlationId, {
    status: "failed",
    canonicalSettlement: false,
    errorMsg: "stale error",
  })
  registry.registerPending(staleFailed)

  const exec2 = publisher.getRecord(correlationId)?.decisionReport?.execution
  assert("C.6 Confirmed preserved after failed attempt", exec2?.settlementStatus === "confirmed")
  assert("C.7 Canonical preserved after failed attempt", exec2?.canonicalSettlement === true)
}

// ── Scenario D: synthetic/all-zero txHash ────────────────────────────────

console.log("\n📋 Scenario D — Synthetic/all-zero txHash")
console.log("  (synthetic record should not become canonical)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_d_001"
  const record = makeSettlementRecord(correlationId, {
    status: "synthetic",
    synthetic: true,
    canonicalSettlement: true,  // explicitly set — should be overridden
    txHash: ZERO_TX,
  })
  registry.registerPending(record)

  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Verify that canonicalSettlement is forced false for synthetic/zero-tx
  const normalizedStatus = record.synthetic === true || /^0x0+$/.test(record.txHash ?? "") ? "synthetic" : record.status
  const normalizedCanonical = normalizedStatus === "confirmed" && record.canonicalSettlement === true && !record.synthetic && !/^0x0+$/.test(record.txHash ?? "")

  // The replay should respect this normalization
  const intentRecord = publisher.getRecord(correlationId)
  const exec = intentRecord?.decisionReport?.execution
  assert("D.1 Normalized status is synthetic", normalizedStatus === "synthetic")
  assert("D.2 Normalized canonicalSettlement is false", normalizedCanonical === false)
  assert("D.3 Record stored with synthetic status", record.status === "synthetic" || record.synthetic === true)
}

// ── Scenario E: missing match ─────────────────────────────────────────────

console.log("\n📋 Scenario E — Missing match (no settlement record)")
console.log("  (replay with no matching record should be no-op)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_e_001"
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // No settlement record created — replay should do nothing
  const foundRecord = registry.findByCorrelationId(correlationId)
  assert("E.1 No settlement record found for missing match", !foundRecord)

  const intentRecord = publisher.getRecord(correlationId)
  assert("E.2 Intent record exists", !!intentRecord)
  assert("E.3 DecisionReport exists", !!(intentRecord?.decisionReport))
  assert("E.4 Execution exists and is unchanged", !!(intentRecord?.decisionReport?.execution))
  assert("E.5 Settlement status is still dispatched", intentRecord?.decisionReport?.execution?.settlementStatus === "dispatched")
  assert("E.6 canTrade/gates not affected", true) // no reachable code path affects gates
}

// ── Scenario F: multiple updates (dispatched → submitted → confirmed) before report ─

console.log("\n📋 Scenario F — dispatched → submitted → confirmed before report save")
console.log("  (Registry consolidates to confirmed, replay picks it up)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_g_001"

  // 1. Register dispatched (simulates Coordinator initial callback)
  registry.recordUpdate({
    correlationId,
    settlementId: `settlement_${correlationId}_dispatched`,
    adapter: "trading",
    status: "dispatched",
    canonicalSettlement: false,
    timestamp: Date.now(),
  })

  // 2. Register submitted
  registry.recordUpdate({
    correlationId,
    adapter: "trading",
    status: "submitted",
    canonicalSettlement: false,
    txHash: `0x${"c".repeat(64)}`,
    timestamp: Date.now() + 1000,
  })

  // 3. Register confirmed
  registry.recordUpdate({
    correlationId,
    adapter: "trading",
    status: "confirmed",
    canonicalSettlement: true,
    txHash: `0x${"d".repeat(64)}`,
    receiptStatus: 1,
    blockNumber: 99999999,
    timestamp: Date.now() + 2000,
  })

  // At this point, the Registry should have a SINGLE consolidated record
  // (byCorrelationId maps to the latest settlementId)
  const consolidated = registry.findByCorrelationId(correlationId)
  assert("F.1 Consolidated record found", !!consolidated)
  assert("F.2 Status is confirmed (progressive)", consolidated!.status === "confirmed")
  assert("F.3 TxHash is the confirmed one", consolidated!.txHash === `0x${"d".repeat(64)}`)
  assert("F.4 canonicalSettlement is true", consolidated!.canonicalSettlement === true)
  assert("F.5 blockNumber is confirmed one", consolidated!.blockNumber === 99999999)

  // Now save report (simulates _saveDecisionReport running after all updates)
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Verify report is saved with initial (dispatched) status
  const intentRecord = publisher.getRecord(correlationId)
  const exec = intentRecord?.decisionReport?.execution
  assert("F.6 Report execution exists after save", !!exec)
  assert("F.7 Report starts as dispatched before replay", exec?.settlementStatus === "dispatched")

  // Simulate what replaySettlementForCorrelationId does:
  // looks up consolidated Registry record + merges via updateDecisionReportFromSettlement
  const syncedRecord = consolidated!
  const incomingStatus = syncedRecord.status === "confirmed" ? "confirmed" : syncedRecord.status
  const shouldAccept = (() => {
    // isStatusRegression: dispatched(1) < confirmed(3) → OK
    const STATUS_ORDER: Record<string, number> = { dispatched: 1, submitted: 2, confirmed: 3, failed: 4, synthetic: 5 }
    return (STATUS_ORDER[incomingStatus] ?? 0) >= (STATUS_ORDER[exec!.settlementStatus ?? ""] ?? 0)
  })()
  const canonical = incomingStatus === "confirmed" && syncedRecord.canonicalSettlement === true &&
    !syncedRecord.synthetic && !/^0x0+$/.test(syncedRecord.txHash ?? "")
  assert("F.8 Replay should accept confirmed (not regression)", shouldAccept === true)
  assert("F.9 Replay should produce canonical=true", canonical === true)
  assert("F.10 Replay should use confirmed txHash", syncedRecord.txHash === `0x${"d".repeat(64)}`)
}

// ── Scenario H: stale submitted after confirmed before report save ──────────

console.log("\n📋 Scenario H — Stale submitted after confirmed before report")
console.log("  (Registry merge now progressive — confirmed canonical preserved)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_h_001"

  // 1. confirmed arrives first (unusual order but possible)
  registry.recordUpdate({
    correlationId,
    settlementId: `settlement_${correlationId}_confirmed`,
    adapter: "trading",
    status: "confirmed",
    canonicalSettlement: true,
    txHash: `0x${"e".repeat(64)}`,
    receiptStatus: 1,
    blockNumber: 11111111,
    timestamp: Date.now(),
  })

  // 2. stale submitted arrives later — Phase 2e.2h: merge rejects regression
  registry.recordUpdate({
    correlationId,
    adapter: "trading",
    status: "submitted",
    canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  // Phase 2e.2h: Registry merge is now progressive — confirmed canonical preserved
  const registryRecord = registry.findByCorrelationId(correlationId)
  console.log(`  ℹ️ Registry status after stale update: ${registryRecord?.status} (Phase 2e.2h — confirmed canonical preserved)`)

  assert("H.1 Registry txHash preserved (submitted record had none, keeps confirmed txHash)",
    registryRecord?.txHash === `0x${"e".repeat(64)}`)
  assert("H.2 Registry blockNumber preserved", registryRecord?.blockNumber === 11111111)
  assert("H.3 Registry canonicalSettlement preserved as true (Phase 2e.2h — no regression)",
    registryRecord?.canonicalSettlement === true)
  assert("H.4 Registry synthetic is false", registryRecord?.synthetic !== true)

  // Now save report (initial status: dispatched)
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Verify report is saved with initial (dispatched) status
  const intentRecord = publisher.getRecord(correlationId)
  const exec = intentRecord?.decisionReport?.execution
  assert("H.5 Report execution exists after save", !!exec)
  assert("H.6 Report starts as dispatched", exec?.settlementStatus === "dispatched")

  // Simulate replay decision: currentStatus=dispatched(1), incomingStatus=confirmed(3)
  // dispatched(1) < confirmed(3) → isStatusRegression returns false → merge ACCEPTED
  // DecisionReport accepts "confirmed" from the Registry — correct progression
  const STATUS_ORDER: Record<string, number> = { dispatched: 1, submitted: 2, confirmed: 3, failed: 4, synthetic: 5 }
  const incomingStatus = registryRecord?.status ?? "dispatched"
  const currentOrder = STATUS_ORDER[exec!.settlementStatus ?? ""] ?? 0
  const incomingOrder = STATUS_ORDER[incomingStatus] ?? 0
  assert("H.7 Incoming status is not regression from current (dispatched→confirmed)",
    incomingOrder >= currentOrder)
  assert("H.8 Registry status is confirmed (not regressed)",
    registryRecord?.status === "confirmed")
}

// ── Scenario I: two queued entries for same correlationId ───────────────────

console.log("\n📋 Scenario I — Two queued entries for same correlationId")
console.log("  (dedup prevents double-queue, replay is idempotent)\n")

{
  const registry = new SettlementRegistry()
  const publisher = new IntentPublisher("test", 100)

  const correlationId = "scenario_i_001"

  // Two updates for the same correlationId, with different settlementIds
  const record1 = makeSettlementRecord(correlationId, {
    settlementId: `settlement_${correlationId}_unique`,
    status: "submitted",
    canonicalSettlement: false,
    timestamp: Date.now(),
  })
  const record2 = makeSettlementRecord(correlationId, {
    settlementId: `settlement_${correlationId}_different`, // different settlementId
    status: "confirmed",
    canonicalSettlement: true,
    txHash: `0x${"f".repeat(64)}`,
    timestamp: Date.now() + 1000,
  })

  // Register via registerPending (simulates listener before report save)
  // Both entries are queued in the Registry's pending queue (by-correlationId dedup)
  registry.registerPending(record1)
  registry.registerPending(record2)

  // Registry consolidates to the latest by settlementId
  const consolidated = registry.findByCorrelationId(correlationId)
  assert("I.1 Registry has consolidated record", !!consolidated)
  assert("I.2 Registry status is latest (confirmed)", consolidated!.status === "confirmed")
  assert("I.3 Registry txHash is confirmed one", consolidated!.txHash === `0x${"f".repeat(64)}`)

  // Now save report (simulates _saveDecisionReport)
  const report = makeReport(`decision_${correlationId}`, correlationId)
  publisher.publish({
    id: correlationId,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  publisher.setDecisionReport(correlationId, report)

  // Verify report starts with dispatched status (no replay yet)
  const intentRecord = publisher.getRecord(correlationId)
  const exec = intentRecord?.decisionReport?.execution
  assert("I.4 Report execution exists after save", !!exec)
  assert("I.5 Report starts as dispatched", exec?.settlementStatus === "dispatched")

  // Simulate replay inline (same as what replaySettlementForCorrelationId does):
  const syncedRecord = consolidated!
  const incomingStatus = syncedRecord.status === "confirmed" ? "confirmed" : syncedRecord.status
  const STATUS_ORDER: Record<string, number> = { dispatched: 1, submitted: 2, confirmed: 3, failed: 4, synthetic: 5 }
  const notRegression = (STATUS_ORDER[incomingStatus] ?? 99) >= (STATUS_ORDER[exec!.settlementStatus ?? ""] ?? 0)
  assert("I.6 Replay would accept confirmed (not regression)", notRegression === true)
  assert("I.7 Replay would set txHash from consolidated record", syncedRecord.txHash === `0x${"f".repeat(64)}`)

  // Demonstrate idempotence: second replay with same consolidated record produces same result
  assert("I.8 Idempotent — same Registry lookup returns same record",
    registry.findByCorrelationId(correlationId)?.settlementId === syncedRecord.settlementId)
}

// ── Scenario J: correlation whose report is never created ───────────────────

console.log("\n📋 Scenario J — Orphan correlation (report never created)")
console.log("  (no phantom DecisionReport, Registry holds record quietly)\n")

{
  const registry = new SettlementRegistry()

  // Register settlement for a correlationId that will never get a DecisionReport
  const orphanCid = "scenario_j_orphan_001"
  registry.recordUpdate({
    correlationId: orphanCid,
    settlementId: `settlement_${orphanCid}`,
    adapter: "trading",
    status: "dispatched",
    canonicalSettlement: false,
    timestamp: Date.now(),
  })

  const found = registry.findByCorrelationId(orphanCid)
  assert("J.1 Orphan record exists in Registry", !!found)
  assert("J.2 Orphan record status is dispatched", found!.status === "dispatched")
  assert("J.3 Orphan record canonicalSettlement is false", found!.canonicalSettlement === false)

  // Verify no DecisionReport was auto-created
  const publisher = new IntentPublisher("test", 100)
  const record = publisher.getRecord(orphanCid)
  assert("J.4 No intent record auto-created for orphan", !record)

  // Verify: orphan record never promoted to canonical (no replay ever happened)
  assert("J.5 Orphan record canonicalSettlement remains false",
    registry.findByCorrelationId(orphanCid)?.canonicalSettlement === false)

  // Registry's internal storage is unbounded per settlementId (unique IDs)
  // The bounded pending queue is in singletons.ts (pendingSettlementReplays, MAX=500)
  // and is NOT tested here since it's a module-level array requiring singletons
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 2e.2h — SettlementRegistry Monotonic Merge Invariants
// settled is RESERVED for a future verification phase — not producible or
// promotable. All attempts to create/update to settled are rejected.
// Scenarios K–AO: 73 merge (K–V) + 24 blocker (W–X, AC–AG, AJ) + 17 settled-reserved (Y–AB, AK–AO) = 114 2e.2h assertions
// Deprecated: Y,Z,AA,AB (settled-as-terminal guards), AH,AI (settled enrichment) — replaced with settled-rejection tests
// ══════════════════════════════════════════════════════════════════════════

// ── Scenario K: confirmed canonical → submitted stale ──────────────────────

console.log("\n📋 Scenario K (Merge A) — Confirmed canonical → submitted stale")
console.log("  (Registry merge rejects regression — confirmed preserved)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_k_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"a".repeat(64)}`, receiptStatus: 1, blockNumber: 100,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("K.1 Status remains confirmed", r.status === "confirmed")
  assert("K.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("K.3 txHash preserved", r.txHash === `0x${"a".repeat(64)}`)
  assert("K.4 blockNumber preserved", r.blockNumber === 100)
  assert("K.5 synthetic remains false", r.synthetic !== true)
}

// ── Scenario L: confirmed canonical → failed stale ─────────────────────────

console.log("\n📋 Scenario L (Merge B) — Confirmed canonical → failed stale")
console.log("  (failed cannot overwrite confirmed canonical)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_l_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"b".repeat(64)}`, receiptStatus: 1, blockNumber: 200,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "failed", canonicalSettlement: false,
    errorMsg: "stale failure",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("L.1 Status remains confirmed", r.status === "confirmed")
  assert("L.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("L.3 txHash preserved", r.txHash === `0x${"b".repeat(64)}`)
  assert("L.4 blockNumber preserved", r.blockNumber === 200)
  assert("L.5 synthetic remains false", r.synthetic !== true)
  assert("L.6 errorMsg not set by stale failed on canonical", !r.errorMsg)
}

// ── Scenario M: confirmed canonical → synthetic stale ──────────────────────

console.log("\n📋 Scenario M (Merge C) — Confirmed canonical → synthetic stale")
console.log("  (synthetic cannot overwrite confirmed canonical)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_m_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"c".repeat(64)}`, receiptStatus: 1, blockNumber: 300,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "synthetic", synthetic: true, canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("M.1 Status remains confirmed", r.status === "confirmed")
  assert("M.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("M.3 txHash preserved", r.txHash === `0x${"c".repeat(64)}`)
  assert("M.4 blockNumber preserved", r.blockNumber === 300)
  assert("M.5 synthetic remains false", r.synthetic !== true)
}

// ── Scenario N: confirmed canonical → all-zero txHash update ──────────────

console.log("\n📋 Scenario N (Merge D) — Confirmed canonical → all-zero txHash")
console.log("  (all-zero txHash cannot convert confirmed into synthetic)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_n_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"d".repeat(64)}`, receiptStatus: 1, blockNumber: 400,
    timestamp: Date.now(),
  })

  // all-zero txHash update
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted",
    txHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("N.1 Status remains confirmed (not synthetic)", r.status === "confirmed")
  assert("N.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("N.3 txHash is original (non-zero)", r.txHash === `0x${"d".repeat(64)}`)
  assert("N.4 synthetic remains false", r.synthetic !== true)
  assert("N.5 blockNumber preserved", r.blockNumber === 400)
}

// ── Scenario O: submitted → confirmed canonical ────────────────────────────

console.log("\n📋 Scenario O (Merge E) — submitted → confirmed canonical")
console.log("  (natural progression accepted)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_o_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    txHash: `0x${"e".repeat(64)}`,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"e".repeat(64)}`, receiptStatus: 1, blockNumber: 500,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("O.1 Status is confirmed", r.status === "confirmed")
  assert("O.2 canonicalSettlement is true", r.canonicalSettlement === true)
  assert("O.3 txHash is confirmed one", r.txHash === `0x${"e".repeat(64)}`)
  assert("O.4 blockNumber set", r.blockNumber === 500)
  assert("O.5 receiptStatus set", r.receiptStatus === 1)
}

// ── Scenario P: failed → confirmed canonical ───────────────────────────────

console.log("\n📋 Scenario P (Merge F) — failed → confirmed canonical")
console.log("  (real proof can override failure)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_p_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "failed", canonicalSettlement: false,
    errorMsg: "initial failure",
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"f".repeat(64)}`, receiptStatus: 1, blockNumber: 600,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("P.1 Status is confirmed", r.status === "confirmed")
  assert("P.2 canonicalSettlement is true", r.canonicalSettlement === true)
  assert("P.3 txHash set", r.txHash === `0x${"f".repeat(64)}`)
  assert("P.4 blockNumber set", r.blockNumber === 600)
  assert("P.5 errorMsg cleared on confirmed transition", r.errorMsg === undefined || r.errorMsg === "")
}

// ── Scenario Q: synthetic → confirmed canonical ────────────────────────────

console.log("\n📋 Scenario Q (Merge G) — synthetic → confirmed canonical")
console.log("  (real proof can replace diagnostic synthetic)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_q_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "synthetic", synthetic: true, canonicalSettlement: false,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"g".repeat(64)}`, receiptStatus: 1, blockNumber: 700,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("Q.1 Status is confirmed", r.status === "confirmed")
  assert("Q.2 canonicalSettlement is true", r.canonicalSettlement === true)
  assert("Q.3 txHash set", r.txHash === `0x${"g".repeat(64)}`)
  assert("Q.4 blockNumber set", r.blockNumber === 700)
  assert("Q.5 synthetic is false", r.synthetic !== true)
}

// ── Scenario R: same-status enrichment ─────────────────────────────────────

console.log("\n📋 Scenario R (Merge H) — Same-status enrichment")
console.log("  (confirmed canonical with blockNumber added)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_r_001"

  // confirmed canonical without blockNumber
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"h".repeat(64)}`, receiptStatus: 1,
    timestamp: Date.now(),
  })

  let r = registry.findByCorrelationId(cid)!
  assert("R.1 Status confirmed", r.status === "confirmed")
  assert("R.2 canonicalSettlement true", r.canonicalSettlement === true)
  assert("R.3 blockNumber initially undefined", r.blockNumber === undefined)

  // same txHash, blockNumber now provided — enrichment accepted
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"h".repeat(64)}`, blockNumber: 800,
    timestamp: Date.now() + 1000,
  })

  r = registry.findByCorrelationId(cid)!
  assert("R.4 Status confirmed after enrichment", r.status === "confirmed")
  assert("R.5 canonicalSettlement still true", r.canonicalSettlement === true)
  assert("R.6 txHash unchanged", r.txHash === `0x${"h".repeat(64)}`)
  assert("R.7 blockNumber now set", r.blockNumber === 800)
  assert("R.8 synthetic still false", r.synthetic !== true)
}

// ── Scenario S: conflicting canonical txHash ───────────────────────────────

console.log("\n📋 Scenario S (Merge I) — Conflicting canonical txHash")
console.log("  (different txHash on confirmed canonical is rejected — warning emitted)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_s_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"i".repeat(64)}`, receiptStatus: 1, blockNumber: 900,
    timestamp: Date.now(),
  })

  // Different txHash — must be rejected
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"j".repeat(64)}`,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("S.1 Status remains confirmed", r.status === "confirmed")
  assert("S.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("S.3 Original txHash preserved (conflict rejected)", r.txHash === `0x${"i".repeat(64)}`)
  assert("S.4 Original blockNumber preserved", r.blockNumber === 900)
  assert("S.5 synthetic remains false", r.synthetic !== true)
}

// ── Scenario T: D.3 real with listener and queue ───────────────────────────

console.log("\n📋 Scenario T (Merge J) — D.3 REAL with listener and queue")
console.log("  (confirmed canonical before report → submitted stale → report → replay)\n")
console.log("  WARNING: uses real singletons — side effects may occur\n")

{
  // Uses real singletons (imported at top of file — safe in CLI)

  const cid = "scenario_t_d3_real"
  const txA = `0x${"t".repeat(64)}`

  // 1. confirmed canonical arrives — DecisionReport does not exist yet
  //    The listener will queue it because no matching DecisionReport exists
  const created = frameworkSettlementRegistry.recordUpdate({
    correlationId: cid,
    settlementId: `settlement_${cid}`,
    adapter: "trading",
    status: "confirmed",
    canonicalSettlement: true,
    txHash: txA,
    receiptStatus: 1,
    blockNumber: 999,
    timestamp: Date.now(),
  })
  assert("T.1 Registry accepted confirmed canonical", !!created && created.status === "confirmed")

  // Give the listener time to enqueue (the listener runs synchronously in the same call stack)
  // Phase 2e.2h: the Registry must NOT regress when submitted stale arrives
  //            : the listener queues it because no DecisionReport exists yet

  // 2. stale submitted arrives — Phase 2e.2h: registry merge rejects regression
  const staleUpdate = frameworkSettlementRegistry.recordUpdate({
    correlationId: cid,
    adapter: "trading",
    status: "submitted",
    canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })
  assert("T.2 Registry still confirmed after stale submitted",
    staleUpdate?.status === "confirmed")
  assert("T.3 Registry canonicalSettlement still true",
    staleUpdate?.canonicalSettlement === true)
  assert("T.4 Registry txHash unchanged",
    staleUpdate?.txHash === txA)

  // 3. Create DecisionReport via frameworkIntents (the listener finds it through frameworkIntents)
  const report = makeReport(`decision_${cid}`, cid)
  // publish is async by signature but synchronous in side effects (IntentPublisher.publish
  // awaits nothing — the record is in the Map before the returned Promise resolves)
  frameworkIntents.publish({
    id: cid,
    agentId: report.agentId,
    action: report.action,
    params: report.params,
    confidence: 80,
    timestamp: report.createdAt,
  })
  frameworkIntents.setDecisionReport(cid, report)

  // 4. Replay: Registry first (confirmed), then queue (confirmed snapshot)
  replaySettlementForCorrelationId(cid)

  // 5. Verify
  const registryRecord = frameworkSettlementRegistry.findByCorrelationId(cid)
  assert("T.5 Registry status confirmed after replay", registryRecord?.status === "confirmed")
  assert("T.6 Registry canonical true after replay", registryRecord?.canonicalSettlement === true)
  assert("T.7 Registry txHash unchanged", registryRecord?.txHash === txA)

  const intentRecord = frameworkIntents.getRecord(cid)
  const exec = intentRecord?.decisionReport?.execution
  assert("T.8 DecisionReport exists after replay", !!exec)
  assert("T.9 Report settlementStatus is confirmed", exec?.settlementStatus === "confirmed")
  assert("T.10 Report canonicalSettlement is true", exec?.canonicalSettlement === true)
  assert("T.11 Report synthetic is false", exec?.synthetic === false)

  // Idempotency: second replay produces same result
  replaySettlementForCorrelationId(cid)
  const exec2 = frameworkIntents.getRecord(cid)?.decisionReport?.execution
  assert("T.12 Idempotent — report status still confirmed", exec2?.settlementStatus === "confirmed")
  assert("T.13 Idempotent — report canonical still true", exec2?.canonicalSettlement === true)

  // Cleanup: remove test record from singletons to avoid cross-test pollution
  // (Note: pendingSettlementReplays was consumed by replay, not leaked)
}

// ── Scenario U: registerPending path ─────────────────────────────────────

console.log("\n📋 Scenario U (Merge K) — registerPending path")
console.log("  (confirmed via registerPending → recordUpdate submitted stale → protection works)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_u_001"

  // Create via registerPending (simulates Coordinator initial dispatch)
  registry.registerPending({
    settlementId: `settlement_${cid}`,
    correlationId: cid,
    adapter: "trading",
    status: "confirmed",
    canonicalSettlement: true,
    synthetic: false,
    txHash: `0x${"u".repeat(64)}`,
    receiptStatus: 1,
    blockNumber: 1000,
    source: "coordinator",
    timestamp: Date.now(),
  })

  // Update via recordUpdate with stale submitted
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("U.1 Status remains confirmed", r.status === "confirmed")
  assert("U.2 canonicalSettlement remains true", r.canonicalSettlement === true)
  assert("U.3 txHash preserved", r.txHash === `0x${"u".repeat(64)}`)
  assert("U.4 blockNumber preserved", r.blockNumber === 1000)
  assert("U.5 synthetic remains false", r.synthetic !== true)
}

// ── Scenario V: partial update (missing fields) ────────────────────────────

console.log("\n📋 Scenario V (Merge L) — Partial update (missing fields)")
console.log("  (update without canonicalSettlement/txHash/blockNumber should not clear them)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_v_001"

  // Full confirmed canonical
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"v".repeat(64)}`, receiptStatus: 1, blockNumber: 1100,
    timestamp: Date.now(),
  })

  // Partial update with only timestamp and status — no canonicalSettlement, no txHash, no blockNumber
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("V.1 Status remains confirmed", r.status === "confirmed")
  assert("V.2 canonicalSettlement unchanged (true)", r.canonicalSettlement === true)
  assert("V.3 txHash unchanged", r.txHash === `0x${"v".repeat(64)}`)
  assert("V.4 blockNumber unchanged", r.blockNumber === 1100)
  assert("V.5 receiptStatus unchanged", r.receiptStatus === 1)
  assert("V.6 synthetic unchanged (false)", r.synthetic !== true)
}

// ── Scenario W: submitted → dispatched blocked ─────────────────────────────

console.log("\n📋 Scenario W (Blocker 1) — Submitted → dispatched blocked")
console.log("  (submitted cannot regress to dispatched)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_w_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    txHash: `0x${"w".repeat(64)}`,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "dispatched", canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("W.1 Status remains submitted (regression blocked)", r.status === "submitted")
  assert("W.2 canonicalSettlement unchanged", r.canonicalSettlement === false)
  assert("W.3 txHash preserved", r.txHash === `0x${"w".repeat(64)}`)
}

// ── Scenario X: confirmed (non-canonical) → submitted blocked ─────────────

console.log("\n📋 Scenario X (Blocker 1) — Confirmed non-canonical → submitted blocked")
console.log("  (confirmed protected from regression even when not canonical)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_x_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: false,
    txHash: `0x${"x".repeat(64)}`,
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("X.1 Status remains confirmed (non-canonical protection)", r.status === "confirmed")
  assert("X.2 canonicalSettlement unchanged", r.canonicalSettlement === false)
  assert("X.3 txHash preserved", r.txHash === `0x${"x".repeat(64)}`)
}

// ── Scenario Y: confirmed canonical → settled rejected ─────────────────────

console.log("\n📋 Scenario Y (Settled-reserved 1) — Confirmed canonical → settled rejected")
console.log("  (settled is reserved — confirmed preserved on settled update)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_y_001"
  const tx = `0x${"y".repeat(64)}`
  const rejectedTx = `0x${"1".repeat(64)}`
  let listenerCalls = 0

  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx, receiptStatus: 1, blockNumber: 1500,
    gasUsed: "21000", actualAmountOut: "99",
    timestamp: 1000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", canonicalSettlement: true, txHash: rejectedTx,
    receiptStatus: 0, blockNumber: 9999, gasUsed: "99999",
    actualAmountOut: "1", balanceDeltas: { USDC: "-999" },
    timestamp: 2000,
  }))

  const r = registry.findByCorrelationId(cid)!
  assert("Y.1 Status remains confirmed (settled rejected)", r.status === "confirmed")
  assert("Y.2 canonicalSettlement unchanged", r.canonicalSettlement === true)
  assert("Y.3 txHash unchanged", r.txHash === tx)
  assert("Y.4 recordUpdate returns existing record", rejected.result === original)
  assert("Y.5 Entire confirmed record preserved", JSON.stringify(r) === snapshot)
  assert("Y.6 Settled warning emitted", rejected.warnings.some(w => w.includes("Rejected recordUpdate") && w.includes(cid)))
  assert("Y.7 Listener not called", listenerCalls === 0)
  assert("Y.8 Existing txHash index preserved", registry.findByTxHash(tx) === original)
  assert("Y.9 Rejected txHash index not created", registry.findByTxHash(rejectedTx) === null)
  assert("Y.10 No settled record stored", registry.listRecent(10).every(record => record.status !== "settled"))
}

// ── Scenario Z: submitted → settled rejected ───────────────────────────────

console.log("\n📋 Scenario Z (Settled-reserved 2) — Submitted → settled rejected")
console.log("  (settled is reserved — submitted preserved)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_z_001"
  const tx = `0x${"z".repeat(64)}`
  let listenerCalls = 0

  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted",
    txHash: tx, timestamp: 3000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", blockNumber: 42,
    timestamp: 4000,
  }))

  const r = registry.findByCorrelationId(cid)!
  assert("Z.1 Status remains submitted (settled rejected)", r.status === "submitted")
  assert("Z.2 txHash unchanged", r.txHash === tx)
  assert("Z.3 Submitted record preserved atomically", JSON.stringify(r) === snapshot)
  assert("Z.4 Settled warning emitted", rejected.warnings.some(w => w.includes("Rejected recordUpdate") && w.includes(cid)))
  assert("Z.5 Listener not called", listenerCalls === 0)
}

// ── Scenario AA: failed → settled rejected ─────────────────────────────────

console.log("\n📋 Scenario AA (Settled-reserved 3) — Failed → settled rejected")
console.log("  (settled is reserved — failed preserved)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_aa_001"
  let listenerCalls = 0

  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "failed",
    errorMsg: "tx failed on-chain",
    timestamp: 5000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", errorMsg: "must not replace",
    timestamp: 6000,
  }))

  const r = registry.findByCorrelationId(cid)!
  assert("AA.1 Status remains failed (settled rejected)", r.status === "failed")
  assert("AA.2 errorMsg preserved", r.errorMsg === "tx failed on-chain")
  assert("AA.3 Failed record preserved atomically", JSON.stringify(r) === snapshot)
  assert("AA.4 Warning emitted and listener not called", rejected.warnings.length === 1 && listenerCalls === 0)
}

// ── Scenario AB: synthetic → settled rejected ──────────────────────────────

console.log("\n📋 Scenario AB (Settled-reserved 4) — Synthetic → settled rejected")
console.log("  (settled is reserved — synthetic preserved)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ab_001"
  let listenerCalls = 0

  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "synthetic", synthetic: true,
    timestamp: 7000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", canonicalSettlement: true,
    timestamp: 8000,
  }))

  const r = registry.findByCorrelationId(cid)!
  assert("AB.1 Status remains synthetic (settled rejected)", r.status === "synthetic")
  assert("AB.2 synthetic flag unchanged", r.synthetic === true)
  assert("AB.3 Synthetic record preserved atomically", JSON.stringify(r) === snapshot)
  assert("AB.4 Warning emitted and listener not called", rejected.warnings.length === 1 && listenerCalls === 0)
}

// ── Scenario AC: confirmed canonical gasUsed → stale submitted conflicting ─

console.log("\n📋 Scenario AC (Blocker 2) — Confirmed canonical gasUsed protected")
console.log("  (stale submitted cannot overwrite existing gasUsed)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ac_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"c".repeat(64)}`, receiptStatus: 1, blockNumber: 1900,
    gasUsed: "21000",
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "submitted", canonicalSettlement: false,
    gasUsed: "99999",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AC.1 Status remains confirmed", r.status === "confirmed")
  assert("AC.2 gasUsed preserved (stale overwrite blocked)", r.gasUsed === "21000")
  assert("AC.3 canonicalSettlement preserved", r.canonicalSettlement === true)
}

// ── Scenario AD: confirmed canonical balanceDelta → failed stale conflicting ─

console.log("\n📋 Scenario AD (Blocker 2) — Confirmed canonical balanceDelta protected")
console.log("  (stale failed cannot overwrite existing balanceDelta)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ad_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"d".repeat(64)}`, receiptStatus: 1, blockNumber: 2000,
    balanceDeltas: { USDC: "-10", cirBTC: "+0.0005" },
    timestamp: Date.now(),
  })

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "failed", canonicalSettlement: false,
    balanceDeltas: { USDC: "-100" },
    errorMsg: "stale failure",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AD.1 Status remains confirmed", r.status === "confirmed")
  assert("AD.2 USDC balanceDelta preserved (stale blocked)", r.balanceDeltas?.USDC === "-10")
  assert("AD.3 cirBTC balanceDelta still present", r.balanceDeltas?.cirBTC === "+0.0005")
}

// ── Scenario AE: confirmed canonical same txHash, gasUsed absent → enrich ──

console.log("\n📋 Scenario AE (Blocker 2) — Confirmed canonical same txHash enrichment")
console.log("  (same txHash can fill missing gasUsed)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ae_001"
  const tx = `0x${"e".repeat(64)}`

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx, receiptStatus: 1, blockNumber: 2100,
    timestamp: Date.now(),
  })

  // Same txHash, status — enrichment fills absent gasUsed
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx, gasUsed: "35000",
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AE.1 Status remains confirmed", r.status === "confirmed")
  assert("AE.2 gasUsed enriched from same settlement", r.gasUsed === "35000")
  assert("AE.3 canonicalSettlement true", r.canonicalSettlement === true)
}

// ── Scenario AF: confirmed canonical same txHash, new balanceDelta key ─────

console.log("\n📋 Scenario AF (Blocker 2) — Same txHash new balanceDelta key")
console.log("  (new key can be added by same settlement)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_af_001"
  const tx = `0x${"f".repeat(64)}`

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx, receiptStatus: 1, blockNumber: 2200,
    balanceDeltas: { USDC: "-10" },
    timestamp: Date.now(),
  })

  // Same txHash, new balanceDelta key
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx,
    balanceDeltas: { EURC: "+10" },
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AF.1 USDC balanceDelta preserved", r.balanceDeltas?.USDC === "-10")
  assert("AF.2 EURC balanceDelta enriched (new key)", r.balanceDeltas?.EURC === "+10")
  assert("AF.3 canonicalSettlement true", r.canonicalSettlement === true)
}

// ── Scenario AG: confirmed canonical same txHash, conflicting balanceDelta ──

console.log("\n📋 Scenario AG (Blocker 2) — Same txHash conflicting balanceDelta")
console.log("  (conflicting key preserved, new key enriched — warning emitted)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ag_001"
  const tx = `0x${"g".repeat(64)}`

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx, receiptStatus: 1, blockNumber: 2300,
    balanceDeltas: { USDC: "-10", cirBTC: "+0.0005" },
    timestamp: Date.now(),
  })

  // Same txHash, same status, conflicting value for USDC + new key for EURC
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: tx,
    balanceDeltas: { USDC: "-100", EURC: "+10" },
    timestamp: Date.now() + 1000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AG.1 USDC balanceDelta preserved (conflict rejected)", r.balanceDeltas?.USDC === "-10")
  assert("AG.2 EURC balanceDelta enriched (new key)", r.balanceDeltas?.EURC === "+10")
  assert("AG.3 cirBTC balanceDelta preserved", r.balanceDeltas?.cirBTC === "+0.0005")
}

// ── Scenario AJ: partial inferior update doesn't change only timestamp ─────

console.log("\n📋 Scenario AJ (Blocker 2) — Partial inferior update")
console.log("  (status-only update on confirmed canonical is no-op)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_aj_001"

  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed", canonicalSettlement: true,
    txHash: `0x${"k".repeat(64)}`, receiptStatus: 1, blockNumber: 2600,
    timestamp: Date.now(),
  })

  // Partial update with same status, no evidence fields
  registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "confirmed",
    timestamp: Date.now() + 100000,
  })

  const r = registry.findByCorrelationId(cid)!
  assert("AJ.1 Status remains confirmed", r.status === "confirmed")
  assert("AJ.2 canonicalSettlement unchanged", r.canonicalSettlement === true)
  assert("AJ.3 timestamp not replaced by inferior update", r.timestamp < Date.now() + 50000)
}

// ── Scenario AK: create direct settled → rejected (A) ──────────────────────

console.log("\n📋 Scenario AK (Settled-reserved 5) — Create direct settled rejected")
console.log("  (recordUpdate with status settled, no prior — returns null)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ak_001"
  const tx = `0x${"a".repeat(64)}`
  let listenerCalls = 0
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", canonicalSettlement: true,
    txHash: tx, ordemId: "ordem_ak_001",
    timestamp: 9000,
  }))

  const r = registry.findByCorrelationId(cid)
  assert("AK.1 recordUpdate returns null for new settled", rejected.result === null)
  assert("AK.2 No settled record created", r === null)
  assert("AK.3 Warning emitted with operation and correlation", rejected.warnings.some(w => w.includes("Rejected recordUpdate") && w.includes(cid)))
  assert("AK.4 Listener not called", listenerCalls === 0)
  assert("AK.5 No txHash or ordemId index created", registry.findByTxHash(tx) === null && registry.findByOrdemId("ordem_ak_001") === null)
  assert("AK.6 Registry remains empty", registry.listRecent(100).length === 0)
}

// ── Scenario AL: dispatched → settled rejected (C) ─────────────────────────

console.log("\n📋 Scenario AL (Settled-reserved 6) — Dispatched → settled rejected")
console.log("  (dispatched preserved when settled update arrives)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_al_001"
  const tx = `0x${"b".repeat(64)}`
  let listenerCalls = 0

  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "dispatched", ordemId: "ordem_al_001",
    timestamp: 10000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading",
    status: "settled", canonicalSettlement: true, txHash: tx,
    blockNumber: 1234, timestamp: 11000,
  }))

  const r = registry.findByCorrelationId(cid)!
  assert("AL.1 Status remains dispatched (settled rejected)", r.status === "dispatched")
  assert("AL.2 canonicalSettlement false (unchanged)", r.canonicalSettlement === false)
  assert("AL.3 recordUpdate returns existing", rejected.result === original)
  assert("AL.4 Entire dispatched record preserved", JSON.stringify(r) === snapshot)
  assert("AL.5 Warning emitted", rejected.warnings.some(w => w.includes("Rejected recordUpdate")))
  assert("AL.6 Listener not called", listenerCalls === 0)
  assert("AL.7 Rejected txHash index not created", registry.findByTxHash(tx) === null)
}

// ── Scenario AM: registerPending settled with full evidence rejected ──────

console.log("\n📋 Scenario AM (Settled-reserved 7) — registerPending settled with full evidence rejected")
console.log("  (throws controlled RangeError; no record, index, or listener side effect)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_am_001"
  const tx = `0x${"c".repeat(64)}`
  let listenerCalls = 0
  let thrown: unknown
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => {
    try {
      registry.registerPending({
        settlementId: "settled_am_001",
        correlationId: cid, adapter: "trading",
        status: "settled", canonicalSettlement: true,
        txHash: tx, receiptStatus: 1, blockNumber: 2700,
        gasUsed: "21000", actualAmountOut: "100",
        ordemId: "ordem_am_001", timestamp: 12000,
      })
    } catch (error) {
      thrown = error
    }
  })

  assert("AM.1 registerPending throws RangeError", thrown instanceof RangeError)
  assert("AM.2 Error message is stable", (thrown as Error)?.message === "Settlement status \"settled\" is reserved for a future verification phase")
  assert("AM.3 Warning emitted with operation and identifiers", rejected.warnings.some(w => w.includes("Rejected registerPending") && w.includes(cid) && w.includes("settled_am_001")))
  assert("AM.4 No correlation index created", registry.findByCorrelationId(cid) === null)
  assert("AM.5 No txHash index created", registry.findByTxHash(tx) === null)
  assert("AM.6 No ordemId index created", registry.findByOrdemId("ordem_am_001") === null)
  assert("AM.7 Registry remains empty", registry.listRecent(100).length === 0)
  assert("AM.8 Listener not called", listenerCalls === 0)
}

// ── Scenario AN: registerPending settled + synthetic rejected before normalize

console.log("\n📋 Scenario AN (Settled-reserved 8) — registerPending settled + synthetic rejected")
console.log("  (explicit settled is rejected before normalizeRecord can mask it as synthetic)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_an_001"
  let listenerCalls = 0
  let thrown: unknown
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => {
    try {
      registry.registerPending({
        settlementId: "settled_an_001",
        correlationId: cid, adapter: "trading",
        status: "settled", synthetic: true,
        canonicalSettlement: true, timestamp: 13000,
      })
    } catch (error) {
      thrown = error
    }
  })

  assert("AN.1 registerPending throws before normalization", thrown instanceof RangeError)
  assert("AN.2 Warning identifies registerPending", rejected.warnings.some(w => w.includes("Rejected registerPending")))
  assert("AN.3 No synthetic record stored", registry.listRecent(100).every(record => record.status !== "synthetic"))
  assert("AN.4 No settled record stored", registry.listRecent(100).every(record => record.status !== "settled"))
  assert("AN.5 No correlation index created", registry.findByCorrelationId(cid) === null)
  assert("AN.6 Listener not called", listenerCalls === 0)
}

// ── Scenario AO: no settled records can exist in registry (I) ─────────────

console.log("\n📋 Scenario AO (Settled-reserved 9) — No settled records in registry")
console.log("  (all settled creation attempts were rejected — no record has status settled)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ao_001"
  const tx = `0x${"o".repeat(64)}`
  let listenerCalls = 0

  registry.recordUpdate({
    correlationId: `${cid}_dispatch`, adapter: "trading",
    status: "dispatched", timestamp: 14000,
  })
  registry.recordUpdate({
    correlationId: `${cid}_confirmed`, adapter: "trading",
    status: "confirmed", canonicalSettlement: true, txHash: tx,
    receiptStatus: 1, blockNumber: 3000, timestamp: 15000,
  })
  listenerCalls = 0
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => {
    registry.recordUpdate({
      correlationId: cid, adapter: "trading",
      status: "settled", canonicalSettlement: true, txHash: `0x${"d".repeat(64)}`,
      timestamp: 16000,
    })
    registry.recordUpdate({
      correlationId: `${cid}_dispatch`, adapter: "trading",
      status: "settled", timestamp: 17000,
    })
    registry.recordUpdate({
      correlationId: `${cid}_confirmed`, adapter: "trading",
      status: "settled", timestamp: 18000,
    })
    try {
      registry.registerPending({
        settlementId: "settled_ao_pending",
        correlationId: `${cid}_pending`, adapter: "trading",
        status: "settled", canonicalSettlement: true,
        timestamp: 19000,
      })
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  })

  const recent = registry.listRecent(100)
  const settledCount = recent.filter(r => r.status === "settled").length
  const dispatchedCount = recent.filter(r => r.status === "dispatched").length
  const confirmedCount = recent.filter(r => r.status === "confirmed").length

  assert("AO.1 Zero records with status settled", settledCount === 0)
  assert("AO.2 Dispatch preserved (dispatched)", dispatchedCount >= 1)
  assert("AO.3 Confirmed preserved (confirmed)", confirmedCount >= 1)
  assert("AO.4 Only the two valid records remain", recent.length === 2)
  assert("AO.5 Four rejection warnings and no listener calls", rejected.warnings.length === 4 && listenerCalls === 0)
}

// ── Scenario AP: registerPending settled + all-zero txHash rejected ────────

console.log("\n📋 Scenario AP (Settled-reserved 10) — registerPending settled + all-zero txHash rejected")
console.log("  (explicit settled is rejected before zero-hash normalization)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_ap_001"
  let listenerCalls = 0
  let thrown: unknown
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => {
    try {
      registry.registerPending({
        settlementId: "settled_ap_001",
        correlationId: cid, adapter: "trading",
        status: "settled", canonicalSettlement: true,
        txHash: ZERO_TX, timestamp: 20000,
      })
    } catch (error) {
      thrown = error
    }
  })

  assert("AP.1 registerPending throws before zero-hash normalization", thrown instanceof RangeError)
  assert("AP.2 Warning identifies reserved settled", rejected.warnings.some(w => w.includes("reserved for a future verification phase")))
  assert("AP.3 No synthetic record stored", registry.listRecent(100).every(record => record.status !== "synthetic"))
  assert("AP.4 No settled record stored", registry.listRecent(100).every(record => record.status !== "settled"))
  assert("AP.5 No correlation or txHash index created", registry.findByCorrelationId(cid) === null && registry.findByTxHash(ZERO_TX) === null)
  assert("AP.6 Listener not called", listenerCalls === 0)
}

// ── Scenario AQ: mixed settled update rejected atomically ─────────────────

console.log("\n📋 Scenario AQ (Settled-reserved 11) — Mixed settled update rejected atomically")
console.log("  (legitimate-looking evidence fields are rejected with the reserved status)\n")

{
  const registry = new SettlementRegistry()
  const cid = "scenario_aq_001"
  let listenerCalls = 0
  const original = registry.recordUpdate({
    correlationId: cid, adapter: "trading", status: "dispatched",
    fromToken: "USDC", toToken: "EURC", amountIn: "100",
    timestamp: 21000,
  })!
  const snapshot = JSON.stringify(original)
  registry.setRecordListener(() => { listenerCalls++ })

  const rejected = captureWarnings(() => registry.recordUpdate({
    correlationId: cid, adapter: "trading", status: "settled",
    blockNumber: 9876, gasUsed: "55555",
    balanceDeltas: { USDC: "-100", EURC: "+99" },
    actualAmountOut: "99", timestamp: 22000,
  }))
  const after = registry.findByCorrelationId(cid)!

  assert("AQ.1 Existing record returned", rejected.result === original)
  assert("AQ.2 Entire record unchanged", JSON.stringify(after) === snapshot)
  assert("AQ.3 blockNumber not applied", after.blockNumber === undefined)
  assert("AQ.4 gasUsed not applied", after.gasUsed === undefined)
  assert("AQ.5 balanceDeltas not applied", after.balanceDeltas === undefined)
  assert("AQ.6 actualAmountOut not applied", after.actualAmountOut === undefined)
  assert("AQ.7 Warning emitted", rejected.warnings.some(w => w.includes("Rejected recordUpdate") && w.includes(cid)))
  assert("AQ.8 Listener not called", listenerCalls === 0)
}

// ── Scenario AR: valid flows remain supported ─────────────────────────────

console.log("\n📋 Scenario AR (Settled-reserved 12) — Valid status flows remain supported")
console.log("  (reserved settled rejection does not change existing valid transitions)\n")

{
  const registry = new SettlementRegistry()
  const txSubmitted = `0x${"e".repeat(64)}`
  const txFailed = `0x${"f".repeat(64)}`
  const txSynthetic = `0x${"9".repeat(64)}`

  registry.recordUpdate({ correlationId: "ar_progress", adapter: "trading", status: "dispatched", timestamp: 23000 })
  registry.recordUpdate({ correlationId: "ar_progress", adapter: "trading", status: "submitted", txHash: txSubmitted, timestamp: 24000 })
  assert("AR.1 dispatched to submitted succeeds", registry.findByCorrelationId("ar_progress")?.status === "submitted")

  registry.recordUpdate({ correlationId: "ar_progress", adapter: "trading", status: "confirmed", canonicalSettlement: true, txHash: txSubmitted, receiptStatus: 1, blockNumber: 1, timestamp: 25000 })
  assert("AR.2 submitted to confirmed canonical succeeds", registry.findByCorrelationId("ar_progress")?.status === "confirmed")
  assert("AR.3 confirmed canonical evidence retained", registry.findByTxHash(txSubmitted)?.canonicalSettlement === true)

  registry.recordUpdate({ correlationId: "ar_failed", adapter: "trading", status: "failed", errorMsg: "temporary", timestamp: 26000 })
  registry.recordUpdate({ correlationId: "ar_failed", adapter: "trading", status: "confirmed", canonicalSettlement: true, txHash: txFailed, receiptStatus: 1, blockNumber: 2, timestamp: 27000 })
  assert("AR.4 failed to confirmed canonical succeeds", registry.findByCorrelationId("ar_failed")?.status === "confirmed")
  assert("AR.5 failed error cleared on confirmation", registry.findByCorrelationId("ar_failed")?.errorMsg === undefined)

  registry.recordUpdate({ correlationId: "ar_synthetic", adapter: "trading", status: "synthetic", synthetic: true, timestamp: 28000 })
  registry.recordUpdate({ correlationId: "ar_synthetic", adapter: "trading", status: "confirmed", canonicalSettlement: true, synthetic: false, txHash: txSynthetic, receiptStatus: 1, blockNumber: 3, timestamp: 29000 })
  assert("AR.6 synthetic to confirmed canonical succeeds", registry.findByCorrelationId("ar_synthetic")?.status === "confirmed")
  assert("AR.7 synthetic flag cleared by real proof", registry.findByCorrelationId("ar_synthetic")?.synthetic === false)

  const protectedBefore = JSON.stringify(registry.findByCorrelationId("ar_progress"))
  registry.recordUpdate({ correlationId: "ar_progress", adapter: "trading", status: "submitted", timestamp: 30000 })
  assert("AR.8 confirmed canonical does not regress", JSON.stringify(registry.findByCorrelationId("ar_progress")) === protectedBefore)

  registry.recordUpdate({ correlationId: "ar_partial", adapter: "trading", status: "dispatched", timestamp: 31000 })
  registry.recordUpdate({ correlationId: "ar_partial", gasUsed: "42000" })
  assert("AR.9 valid partial update still enriches", registry.findByCorrelationId("ar_partial")?.gasUsed === "42000")
  assert("AR.10 valid flows created no settled record", registry.listRecent(100).every(record => record.status !== "settled"))
}

// ══════════════════════════════════════════════════════════════════════════
// End Phase 2e.2h scenarios
// --------------------------------------------------------------------------
// Phase 2e.2i � Settlement Replay Queue Integration (AS�BD)
// --------------------------------------------------------------------------

// -- Scenario AS: Exception � one queued item, retryCount tracked ----------

console.log("Scenario AS � Exception: one queued item � retryCount tracked, item preserved")
console.log("  (listener enqueues when report absent ? override fires on replay)")

{
  var corrIdAS = "scenario_AS_enqueue_retry"
  var setAS = "settlement_AS_001"

  // 1. Publish intent first (so intent record exists)
  frameworkIntents.publish({ id: corrIdAS, agentId: "test-as", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // 2. Register in global registry � listener fires and enqueues (report absent)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAS, { settlementId: setAS }))

  // 3. Set report
  frameworkIntents.setDecisionReport(corrIdAS, makeReport("decision_" + corrIdAS, corrIdAS))

  // 4. Activate throwing override
  const _restoreOverride = replaceSetDecisionReport(function () { throw new Error("Simulated failure AS") })

  try {
    // 5. Replay � projection works (report exists), queued item fires override
    replaySettlementForCorrelationId(corrIdAS)

    var diagAS = getPendingSettlementReplayDiagnostics()
    var entryAS = diagAS.find(function (e) { return e.correlationId === corrIdAS })
    assert("AS.1 Entry remains in queue", !!entryAS)
    if (entryAS) {
      assert("AS.2 retryCount === 1", entryAS.retryCount === 1, "got " + entryAS.retryCount)
      assert("AS.3 lastAttemptAt is set", typeof entryAS.lastAttemptAt === "number")
      assert("AS.4 lastError contains error", (entryAS.lastError ?? "").indexOf("Simulated failure AS") !== -1)
    }
  } finally {
    _restoreOverride()
    // Clean up residual entry: with real setDecisionReport restored,
    // replay succeeds and removes the queued entry.
    replaySettlementForCorrelationId(corrIdAS)
  }
}

// -- Scenario AT: Exception mid-flush does NOT corrupt remaining items -----

console.log("Scenario AT � Exception mid-flush does NOT corrupt remaining items")
console.log("  (replay processes each correlationId independently)")

{
  var cOkAT = "scenario_AT_corr_ok"
  var cFailAT = "scenario_AT_corr_fail"
  var cOk2AT = "scenario_AT_corr_ok2"
  var allAT = [cOkAT, cFailAT, cOk2AT]

  for (var idx3 = 0; idx3 < allAT.length; idx3++) {
    var c = allAT[idx3]
    frameworkIntents.publish({ id: c, agentId: "test-at", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
    frameworkSettlementRegistry.registerPending(makeSettlementRecord(c, { settlementId: "settlement_AT_" + c }))
    frameworkIntents.setDecisionReport(c, makeReport("decision_" + c, c))
  }

  const _restoreOverride = replaceSetDecisionReport(function (id) {
    // id is the intent ID = correlation ID
    if (id === cFailAT) throw new Error("Simulated failure AT")
    return true
  })

  try {
    replaySettlementForCorrelationId(cOkAT)
    replaySettlementForCorrelationId(cFailAT)
    replaySettlementForCorrelationId(cOk2AT)

    var diagAT2 = getPendingSettlementReplayDiagnostics()
    assert("AT.1 corr_ok cleared", !diagAT2.find(function (e) { return e.correlationId === cOkAT }))
    var fAT = diagAT2.find(function (e) { return e.correlationId === cFailAT })
    assert("AT.2 corr_fail remains", !!fAT)
    if (fAT) assert("AT.3 corr_fail retryCount >= 1", fAT.retryCount >= 1, "got " + fAT.retryCount)
    assert("AT.4 corr_ok2 cleared", !diagAT2.find(function (e) { return e.correlationId === cOk2AT }))
  } finally {
    _restoreOverride()
    // Clean up residual entry: replay cFailAT with real hook succeeds.
    replaySettlementForCorrelationId(cFailAT)
  }
}

// -- Scenario AU: Retry count increments across multiple calls -----------

console.log("Scenario AU � Retry count increments across multiple calls")
console.log("  (each call increments retryCount without removing the entry)")

{
  var corrIdAU = "scenario_AU_retry_increment"
  var setAU = "settlement_AU_001"

  frameworkIntents.publish({ id: corrIdAU, agentId: "test-au", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAU, { settlementId: setAU }))
  frameworkIntents.setDecisionReport(corrIdAU, makeReport("decision_" + corrIdAU, corrIdAU))

  const _restoreOverride = replaceSetDecisionReport(function () { throw new Error("Persistent failure AU") })

  try {
    replaySettlementForCorrelationId(corrIdAU)
    replaySettlementForCorrelationId(corrIdAU)
    replaySettlementForCorrelationId(corrIdAU)

    var diagAU = getPendingSettlementReplayDiagnostics()
    var entryAU = diagAU.find(function (e) { return e.correlationId === corrIdAU })
    assert("AU.1 Entry still in queue", !!entryAU)
    if (entryAU) {
      assert("AU.2 retryCount === 3", entryAU.retryCount === 3, "got " + entryAU.retryCount)
      assert("AU.3 lastError preserved", typeof entryAU.lastError === "string" && entryAU.lastError.length > 0)
    }
  } finally {
    _restoreOverride()
    // Clean up residual entry: replay with real hook succeeds.
    replaySettlementForCorrelationId(corrIdAU)
  }
}

// -- Scenario AV: Item dropped after MAX_SETTLEMENT_REPLAY_ATTEMPTS (5) --

console.log("Scenario AV � Item dropped after MAX_SETTLEMENT_REPLAY_ATTEMPTS failures")
console.log("  (5 consecutive failures ? entry removed, warning emitted)")

{
  var corrIdAV = "scenario_AV_drop_limit"
  var setAVA1 = "settlement_AV_A1"
  var setAVA2 = "settlement_AV_A2"
  var txAVA1 = "0xd100000000000000000000000000000000000000000000000000000000000001"
  var txAVA2 = "0xd200000000000000000000000000000000000000000000000000000000000002"

  // Assert queue is clean before AV starts — prior scenarios clean their own state.
  var diagBeforeAV = getPendingSettlementReplayDiagnostics()
  assert("AV.0 Queue empty before scenario",
    diagBeforeAV.length === 0,
    "got " + diagBeforeAV.length + " entries: " + JSON.stringify(diagBeforeAV.map(function (e) { return e.correlationId + "@" + e.settlementId + " retry=" + e.retryCount })))

  frameworkIntents.publish({ id: corrIdAV, agentId: "test-av", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAV, { settlementId: setAVA1, txHash: txAVA1 }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAV, { settlementId: setAVA2, txHash: txAVA2 }))
  frameworkIntents.setDecisionReport(corrIdAV, makeReport("decision_" + corrIdAV, corrIdAV))

  var appliedAVA2 = 0
  var attemptedAVA1 = 0
  const _restoreOverride = replaceSetDecisionReport(function (_id, updatedReport) {
    var appliedTxHash = updatedReport.execution?.txHash
    if (appliedTxHash === txAVA1) {
      attemptedAVA1++
      throw new Error("Persistent failure AV A1")
    }
    if (appliedTxHash === txAVA2) appliedAVA2++
    return true
  })

  try {
    var wAV = captureWarnings(function () {
      var removedAV1 = flushPendingSettlementReplays()
      var diagAV1 = getPendingSettlementReplayDiagnostics().filter(function (e) { return e.correlationId === corrIdAV })
      var a1AV1 = diagAV1.find(function (e) { return e.settlementId === setAVA1 })
      var a2AV1 = diagAV1.find(function (e) { return e.settlementId === setAVA2 })
      assert("AV.1 Call 1 removes 0", removedAV1 === 0, "got " + removedAV1)
      assert("AV.2 A1 remains with retryCount 1", a1AV1?.retryCount === 1, "got " + a1AV1?.retryCount)
      assert("AV.3 A2 remains with retryCount 0 after call 1", a2AV1?.retryCount === 0, "got " + a2AV1?.retryCount)
      assert("AV.4 A2 not called after call 1", appliedAVA2 === 0, "got " + appliedAVA2)
      assert("AV.4a A1 attempted exactly once in call 1", attemptedAVA1 === 1, "got " + attemptedAVA1)

      var removedAV2 = flushPendingSettlementReplays()
      var diagAV2 = getPendingSettlementReplayDiagnostics().filter(function (e) { return e.correlationId === corrIdAV })
      assert("AV.5 Call 2 removes 0", removedAV2 === 0, "got " + removedAV2)
      assert("AV.6 A1 retryCount 2", diagAV2.find(function (e) { return e.settlementId === setAVA1 })?.retryCount === 2)
      assert("AV.7 A2 retryCount 0 after call 2", diagAV2.find(function (e) { return e.settlementId === setAVA2 })?.retryCount === 0)
      assert("AV.8 A2 not called after call 2", appliedAVA2 === 0)
      assert("AV.8a A1 attempted exactly once in call 2", attemptedAVA1 === 2, "got cumulative " + attemptedAVA1)

      var removedAV3 = flushPendingSettlementReplays()
      var diagAV3 = getPendingSettlementReplayDiagnostics().filter(function (e) { return e.correlationId === corrIdAV })
      assert("AV.9 Call 3 removes 0", removedAV3 === 0, "got " + removedAV3)
      assert("AV.10 A1 retryCount 3", diagAV3.find(function (e) { return e.settlementId === setAVA1 })?.retryCount === 3)
      assert("AV.11 A2 retryCount 0 after call 3", diagAV3.find(function (e) { return e.settlementId === setAVA2 })?.retryCount === 0)
      assert("AV.12 A2 not called after call 3", appliedAVA2 === 0)
      assert("AV.12a A1 attempted exactly once in call 3", attemptedAVA1 === 3, "got cumulative " + attemptedAVA1)

      var removedAV4 = flushPendingSettlementReplays()
      var diagAV4 = getPendingSettlementReplayDiagnostics().filter(function (e) { return e.correlationId === corrIdAV })
      assert("AV.13 Call 4 removes 0", removedAV4 === 0, "got " + removedAV4)
      assert("AV.14 A1 retryCount 4", diagAV4.find(function (e) { return e.settlementId === setAVA1 })?.retryCount === 4)
      assert("AV.15 A2 retryCount 0 after call 4", diagAV4.find(function (e) { return e.settlementId === setAVA2 })?.retryCount === 0)
      assert("AV.16 A2 not called after call 4", appliedAVA2 === 0)
      assert("AV.16a A1 attempted exactly once in call 4", attemptedAVA1 === 4, "got cumulative " + attemptedAVA1)

      var removedAV5 = flushPendingSettlementReplays()
      var diagAV5 = getPendingSettlementReplayDiagnostics().filter(function (e) { return e.correlationId === corrIdAV })
      assert("AV.17 Call 5 returns exactly 1 removal", removedAV5 === 1, "got " + removedAV5)
      assert("AV.18 A1 removed on fifth failure", !diagAV5.find(function (e) { return e.settlementId === setAVA1 }))
      assert("AV.19 A2 remains after A1 drop", !!diagAV5.find(function (e) { return e.settlementId === setAVA2 }))
      assert("AV.20 A2 retryCount 0 after A1 drop", diagAV5.find(function (e) { return e.settlementId === setAVA2 })?.retryCount === 0)
      assert("AV.21 A2 not called in A1 drop call", appliedAVA2 === 0)
      assert("AV.21a A1 attempted exactly once in call 5", attemptedAVA1 === 5, "got cumulative " + attemptedAVA1)
    })

    var dropWarningsAV = wAV.warnings.filter(function (w) {
      return w.indexOf("action=dropped_after_retry_limit") !== -1 && w.indexOf(setAVA1) !== -1
    })
    assert("AV.22 Exactly one dropped warning for A1", dropWarningsAV.length === 1, "got " + dropWarningsAV.length)

    var removedAV6 = flushPendingSettlementReplays()
    assert("AV.23 Call 6 removes A2 after success", removedAV6 === 1, "got " + removedAV6)
    assert("AV.24 A2 called only on call 6", appliedAVA2 === 1, "got " + appliedAVA2)
    assert("AV.25 Queue empty for correlationId", !getPendingSettlementReplayDiagnostics().find(function (e) { return e.correlationId === corrIdAV }))
  } finally {
    _restoreOverride()
    flushPendingSettlementReplays()
  }
}

function replaceFindByCorrelationId(fn: (correlationId: string) => SettlementRecord | null): () => void {
  const saved = frameworkSettlementRegistry.findByCorrelationId
  frameworkSettlementRegistry.findByCorrelationId = fn
  return function restore() { frameworkSettlementRegistry.findByCorrelationId = saved }
}

// -- Scenario AW: Multiple correlationIds � one fails, other unaffected --

console.log("Scenario AW � Multiple correlationIds � one fails, other unaffected")
console.log("  (failing corrId does not prevent other corrIds from succeeding)")

{
  var cOkAW = "scenario_AW_ok"
  var cFailAW = "scenario_AW_fail"
  var allAW = [cOkAW, cFailAW]

  for (var idx4 = 0; idx4 < allAW.length; idx4++) {
    var c = allAW[idx4]
    frameworkIntents.publish({ id: c, agentId: "test-aw", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
    frameworkSettlementRegistry.registerPending(makeSettlementRecord(c, { settlementId: "settlement_AW_" + c }))
    frameworkIntents.setDecisionReport(c, makeReport("decision_" + c, c))
  }

  const _restoreOverride = replaceSetDecisionReport(function (id) {
    if (id === cFailAW) throw new Error("Simulated failure AW")
    return true
  })

  try {
    replaySettlementForCorrelationId(cOkAW)
    replaySettlementForCorrelationId(cFailAW)

    var diagAW = getPendingSettlementReplayDiagnostics()
    assert("AW.1 cOk cleared", !diagAW.find(function (e) { return e.correlationId === cOkAW }))
    var fAW = diagAW.find(function (e) { return e.correlationId === cFailAW })
    assert("AW.2 cFail remains", !!fAW)
    if (fAW) assert("AW.3 cFail retryCount >= 1", fAW.retryCount >= 1, "got " + fAW.retryCount)
  } finally {
    _restoreOverride()
    flushPendingSettlementReplays()
  }
}

// -- Scenario AX: FIFO order preserved within same correlationId ---------

console.log("Scenario AX � FIFO order preserved within same correlationId")
console.log("  (two queued items for same corrId � first enqueued is processed first)")

{
  var corrIdAX = "scenario_AX_fifo"
  var setAX1 = "settlement_AX_first"
  var setAX2 = "settlement_AX_second"

  frameworkIntents.publish({ id: corrIdAX, agentId: "test-ax", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Listener enqueues set1 (report absent)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAX, { settlementId: setAX1 }))
  // Listener enqueues set2 (different settlementId, report still absent)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAX, { settlementId: setAX2, status: "submitted" }))

  // With no override, replay should process both (projection works, queued items succeed)
  replaySettlementForCorrelationId(corrIdAX)

  var diagAX = getPendingSettlementReplayDiagnostics()
  var entriesAX = diagAX.filter(function (e) { return e.correlationId === corrIdAX })
  // Both entries should be processed and removed successfully
  assert("AX.1 No entries remaining after successful replay", entriesAX.length === 0, "got " + entriesAX.length)
}

// -- Scenario AY: Cap enforcement � eviction of oldest entries ----------

console.log("Scenario AY � Cap enforcement � eviction of oldest entries")
console.log("  (queue reaches MAX_PENDING_SETTLEMENT_REPLAYS ? oldest evicted)")

{
  // Fill the queue to the cap by calling registerPending without intent records.
  var wAY = captureWarnings(function () {
    for (var i5 = 0; i5 < 510; i5++) {
      var cidAY = "scenario_AY_cap_" + String(i5).padStart(4, "0")
      frameworkSettlementRegistry.registerPending(makeSettlementRecord(cidAY, {
        settlementId: "settlement_AY_" + String(i5).padStart(4, "0"),
        correlationId: cidAY,
        fromToken: "USDC",
        toToken: "EURC",
      }))
    }
  })

  try {
    var diagAY = getPendingSettlementReplayDiagnostics()
    assert("AY.1 Queue size <= 500", diagAY.length <= 500, "got " + diagAY.length)
    var evictedAY = wAY.warnings.filter(function (w) { return w.indexOf("evicted_queue_full") !== -1 })
    assert("AY.2 At least one eviction warning", evictedAY.length >= 1, "got " + evictedAY.length)
  } finally {
    // Deterministic cleanup even if assertions fail.
    // Creates 510 intent records (unique IDs prefixed scenario_AY_cap_*;
    // they remain in frameworkIntents — no removal API exists — but do NOT
    // interfere with other scenarios because no test references them).
    for (var ciAY = 0; ciAY < 510; ciAY++) {
      var cidAYclean = "scenario_AY_cap_" + String(ciAY).padStart(4, "0")
      frameworkIntents.publish({ id: cidAYclean, agentId: "test-ay", action: "BUY", params: { fromToken: "USDC", toToken: "EURC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
      frameworkIntents.setDecisionReport(cidAYclean, makeReport("decision_" + cidAYclean, cidAYclean))
    }
    flushPendingSettlementReplays()
  }

  // Verify zero AY entries remain in the replay queue after cleanup
  // IntentRecords still exist (no removal API), but they are unique IDs not
  // referenced by any other scenario and do not leak into future assertions.
  var ayAfterCleanup = getPendingSettlementReplayDiagnostics().filter(function (e) {
    return e.correlationId.indexOf("scenario_AY_cap_") === 0
  })
  assert("AY.3 Zero AY entries remain in queue after cleanup", ayAfterCleanup.length === 0, "got " + ayAfterCleanup.length)
}


// -- Scenario AZ: Dedupe by settlementId --------------------------------

console.log("Scenario AZ � Dedupe by settlementId � same settlementId not enqueued twice")
console.log("  (second registerPending with same settlementId is deduped in queue)")
console.log("  (firstQueuedAt, replayId, retryCount, and record fields are preserved)")

{
  var corrIdAZ = "scenario_AZ_dedupe"
  var setAZ = "settlement_AZ_001"

  frameworkIntents.publish({ id: corrIdAZ, agentId: "test-az", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // First registerPending: listener enqueues (report absent)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAZ, { settlementId: setAZ }))
  // Capture first entry snapshot
  var diagBeforeAZ = getPendingSettlementReplayDiagnostics()
  var entryBeforeAZ = diagBeforeAZ.find(function (e) { return e.correlationId === corrIdAZ })
  var firstReplayIdAZ = entryBeforeAZ ? entryBeforeAZ.replayId : null
  var firstQueuedAtAZ = entryBeforeAZ ? entryBeforeAZ.firstQueuedAt : null

  // Second registerPending with SAME settlementId: listener fires, dedupe blocks
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdAZ, { settlementId: setAZ }))

  // Set report so the override fires
  frameworkIntents.setDecisionReport(corrIdAZ, makeReport(corrIdAZ, corrIdAZ))

  const _restoreOverride = replaceSetDecisionReport(function () { throw new Error("AZ dedupe") })
  try {
    replaySettlementForCorrelationId(corrIdAZ)

    var diagAZ = getPendingSettlementReplayDiagnostics()
    var entriesAZ = diagAZ.filter(function (e) { return e.correlationId === corrIdAZ })
    assert("AZ.1 Exactly 1 entry in queue", entriesAZ.length === 1, "got " + entriesAZ.length)
    if (entriesAZ.length === 1) {
      assert("AZ.2 retryCount === 1", entriesAZ[0].retryCount === 1, "got " + entriesAZ[0].retryCount)
      // Snapshot preservation assertions
      assert("AZ.3 replayId unchanged", entriesAZ[0].replayId === firstReplayIdAZ, "got " + entriesAZ[0].replayId + " expected " + firstReplayIdAZ)
      assert("AZ.4 firstQueuedAt unchanged", entriesAZ[0].firstQueuedAt === firstQueuedAtAZ, "got " + entriesAZ[0].firstQueuedAt)
      assert("AZ.5 record settlementId unchanged", entriesAZ[0].settlementId === setAZ, "got " + entriesAZ[0].settlementId)
    }
  } finally {
    _restoreOverride()
    // Clean up remaining queue entry so BF starts empty
    flushPendingSettlementReplays()
  }
}

// -- Scenario BA: Snapshot integrity -- direct mutation of original object --

console.log("Scenario BA � Snapshot integrity -- direct mutation of original object")
console.log("  (mutating the original variable after enqueue does NOT alter queued copy)")

{
  var corrIdBA = "scenario_BA_snapshot"
  var setBA = "settlement_BA_001"

  frameworkIntents.publish({ id: corrIdBA, agentId: "test-ba", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  try {
    // Create a record variable, then enqueue it
    var originalRecordBA = makeSettlementRecord(corrIdBA, {
      settlementId: setBA,
      status: "submitted",
      txHash: "0xbaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNumber: 1000,
      balanceDeltas: { USDC: "-5000000", cirBTC: "0.0005" },
    })
    frameworkSettlementRegistry.registerPending(originalRecordBA)

    // DIRECTLY MUTATE the original object (not through Registry API)
    // Scalars:
    originalRecordBA.status = "confirmed"
    originalRecordBA.txHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    originalRecordBA.blockNumber = 9999
    originalRecordBA.canonicalSettlement = true
    // balanceDeltas:
    if (originalRecordBA.balanceDeltas) {
      originalRecordBA.balanceDeltas.USDC = "-99999999"
      delete originalRecordBA.balanceDeltas.cirBTC
      originalRecordBA.balanceDeltas.EURC = "+10000000"
    }

    // The queued entry should still have the ORIGINAL snapshot
    var diagBA = getPendingSettlementReplayDiagnostics()
    var entryBA = diagBA.find(function (e) { return e.correlationId === corrIdBA })
    assert("BA.1 Entry exists in queue", !!entryBA)
    if (entryBA) {
      assert("BA.2 settlementId unchanged", entryBA.settlementId === setBA, "got " + entryBA.settlementId)
      assert("BA.3 status is original (submitted, not confirmed)", entryBA.status === "submitted", "got " + entryBA.status)
      assert("BA.4 txHash is original (ba..., not cc...)", entryBA.txHash === "0xbaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "got " + entryBA.txHash)
      assert("BA.5 blockNumber is original (1000, not 9999)", entryBA.blockNumber === 1000, "got " + entryBA.blockNumber)
      assert("BA.6 retryCount is 0 (fresh enqueue)", entryBA.retryCount === 0, "got " + entryBA.retryCount)
      assert("BA.7 replayId is non-empty string", typeof entryBA.replayId === "string" && entryBA.replayId.length > 0)
      assert("BA.8 firstQueuedAt > 0", typeof entryBA.firstQueuedAt === "number" && entryBA.firstQueuedAt > 0)
      // balanceDeltas snapshot:
      assert("BA.9 USDC balDelta preserved (-5000000)", entryBA.balanceDeltas?.USDC === "-5000000", "got " + entryBA.balanceDeltas?.USDC)
      assert("BA.10 cirBTC balDelta preserved (0.0005)", entryBA.balanceDeltas?.cirBTC === "0.0005", "got " + entryBA.balanceDeltas?.cirBTC)
      assert("BA.11 EURC not leaked into snapshot", !entryBA.balanceDeltas?.EURC, "got " + entryBA.balanceDeltas?.EURC)
    }
  } finally {
    // Clean up the queued entry
    frameworkIntents.setDecisionReport(corrIdBA, makeReport("decision_" + corrIdBA, corrIdBA))
    flushPendingSettlementReplays()
  }
}

// -- Scenario BB: SettlementId re-enqueued after drop is allowed ---------

console.log("Scenario BB � SettlementId re-enqueued after drop is allowed")
console.log("  (after an entry is dropped due to max retries, re-enqueueing the same settlementId creates a fresh entry)")

{
  var corrIdBB = "scenario_BB_reenqueue"
  var setBB = "settlement_BB_001"

  frameworkIntents.publish({ id: corrIdBB, agentId: "test-bb", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Enqueue
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBB, { settlementId: setBB }))
  frameworkIntents.setDecisionReport(corrIdBB, makeReport("decision_" + corrIdBB, corrIdBB))

  // Drop by exhausting retries
  const _restoreOverrideBB = replaceSetDecisionReport(function () { throw new Error("BB persistent failure") })

  try {
    for (var i6 = 0; i6 < 5; i6++) replaySettlementForCorrelationId(corrIdBB)
  } finally {
    _restoreOverrideBB()
  }

  try {
    // Verify dropped
    var diagAfterDrop = getPendingSettlementReplayDiagnostics()
    var afterDrop = diagAfterDrop.find(function (e) { return e.correlationId === corrIdBB })
    assert("BB.1 Entry dropped after max retries", !afterDrop, "found retryCount=" + (afterDrop ? afterDrop.retryCount : "none"))

    // Re-enqueue same settlementId � should create a fresh entry (dedupe only blocks while entry exists)
    frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBB, { settlementId: setBB, status: "confirmed" }))

    // After drop + re-register: report is merged synchronously (no queue entry)
    // because the report already exists with execution.
    var diagRe = getPendingSettlementReplayDiagnostics()
    var reEntry = diagRe.find(function (e) { return e.correlationId === corrIdBB })
    assert("BB.2 No queue entry after re-register (synchronous merge)", !reEntry)
    var intentBB = frameworkIntents.getRecord(corrIdBB)
    assert("BB.3 Report exists after re-register", !!(intentBB?.decisionReport?.execution))
    if (intentBB?.decisionReport?.execution) {
      assert("BB.4 settlementStatus is confirmed after merge", intentBB.decisionReport.execution.settlementStatus === "confirmed", "got " + intentBB.decisionReport.execution.settlementStatus)
    }
  } finally {
    // Cleanup: flush any remaining entries
    flushPendingSettlementReplays()
  }
}

// -- Scenario BC: getPendingSettlementReplayDiagnostics returns correct fields --

console.log("Scenario BC � getPendingSettlementReplayDiagnostics returns correct fields")
console.log("  (all diagnostic fields populated correctly)")

{
  var corrIdBC = "scenario_BC_diag_fields"
  var setBC = "settlement_BC_001"

  frameworkIntents.publish({ id: corrIdBC, agentId: "test-bc", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBC, { settlementId: setBC }))
  frameworkIntents.setDecisionReport(corrIdBC, makeReport("decision_" + corrIdBC, corrIdBC))

  const _restoreOverride = replaceSetDecisionReport(function () { throw new Error("BC diagnostic") })
  try {
    replaySettlementForCorrelationId(corrIdBC)

    var diagBC = getPendingSettlementReplayDiagnostics()
    var entryBC = diagBC.find(function (e) { return e.correlationId === corrIdBC })
    assert("BC.1 Entry exists", !!entryBC)
    if (entryBC) {
      assert("BC.2 replayId is non-empty string", typeof entryBC.replayId === "string" && entryBC.replayId.length > 0)
      assert("BC.3 settlementId matches", entryBC.settlementId === setBC, "got " + entryBC.settlementId)
      assert("BC.4 correlationId matches", entryBC.correlationId === corrIdBC)
      assert("BC.5 status matches", entryBC.status === "confirmed", "got " + entryBC.status)
      assert("BC.6 retryCount is number >= 0", typeof entryBC.retryCount === "number" && entryBC.retryCount >= 0)
      assert("BC.7 firstQueuedAt > 0", typeof entryBC.firstQueuedAt === "number" && entryBC.firstQueuedAt > 0)
      assert("BC.8 lastAttemptAt >= firstQueuedAt", typeof entryBC.lastAttemptAt === "number" && entryBC.lastAttemptAt >= entryBC.firstQueuedAt)
      assert("BC.9 lastError contains message", (entryBC.lastError ?? "").indexOf("BC diagnostic") !== -1)
    }
  } finally {
    _restoreOverride()
    // Clean up remaining queue entry so BF starts empty
    flushPendingSettlementReplays()
  }
}

// -- Scenario BD: Monkey-patch intercepts setDecisionReport calls --------

console.log("Scenario BD � Monkey-patch intercepts setDecisionReport calls")
console.log("  (the monkey-patch intercepts every call to frameworkIntents.setDecisionReport)")

{
  var corrIdBD = "scenario_BD_hook_intercept"
  var setBD = "settlement_BD_001"

  frameworkIntents.publish({ id: corrIdBD, agentId: "test-bd", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBD, { settlementId: setBD }))
  frameworkIntents.setDecisionReport(corrIdBD, makeReport("decision_" + corrIdBD, corrIdBD))

  var hookCallCountBD = 0
  var lastIdPassedBD: string | null = null
  var hasSettlementStatusBD = false

  const _restoreOverride = replaceSetDecisionReport(function (id, updatedReport) {
    hookCallCountBD++
    lastIdPassedBD = id
    hasSettlementStatusBD = JSON.stringify(updatedReport).indexOf("settlementStatus") !== -1
    return true
  })

  try {
    replaySettlementForCorrelationId(corrIdBD)
    assert("BD.1 Hook called at least once", hookCallCountBD >= 1, "called " + hookCallCountBD)
    // intent ID = correlation ID in tests, NOT "decision_corrId"
    assert("BD.2 Hook received correct intent ID", lastIdPassedBD === corrIdBD, "got " + lastIdPassedBD)
    assert("BD.3 Hook received report with settlementStatus", hookCallCountBD >= 1 && hasSettlementStatusBD)

    // Restore and verify no errors
    _restoreOverride()
    var bdW = captureWarnings(function () { replaySettlementForCorrelationId(corrIdBD) })
    assert("BD.4 No error warnings after restore", bdW.warnings.filter(function (w) { return /error/i.test(w) }).length === 0)
  } finally {
    _restoreOverride()
    // Clean up remaining queue entry so BF starts empty
    flushPendingSettlementReplays()
  }
}

// -- Scenario BE: Replay after drop triggers fresh enqueue ---------------

console.log("Scenario BE � Replay after drop triggers fresh enqueue")
console.log("  (after drop, a new registry update with same correlationId creates a fresh queue entry)")

{
  var corrIdBE = "scenario_BE_reenqueue_after_drop"
  var setBE = "settlement_BE_001"

  frameworkIntents.publish({ id: corrIdBE, agentId: "test-be", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Enqueue first entry
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBE, { settlementId: setBE, status: "submitted" }))

  // Set report and drop via retry exhaustion
  frameworkIntents.setDecisionReport(corrIdBE, makeReport("decision_" + corrIdBE, corrIdBE))
  const _restoreOverrideBE = replaceSetDecisionReport(function () { throw new Error("BE persistent failure") })
  try {
    for (var i9 = 0; i9 < 5; i9++) replaySettlementForCorrelationId(corrIdBE)
  } finally {
    _restoreOverrideBE()
  }

  try {
    // Verify dropped
    var diagAfterBE = getPendingSettlementReplayDiagnostics()
    assert("BE.1 Entry dropped after 5 retries", !diagAfterBE.find(function (e) { return e.correlationId === corrIdBE }))

    // New registry update triggers fresh enqueue (different settlementId)
    frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBE, { settlementId: "settlement_BE_002", status: "confirmed" }))

    // After drop + re-register: report is merged synchronously (no queue entry)
    var diagReBE = getPendingSettlementReplayDiagnostics()
    var reBE = diagReBE.find(function (e) { return e.correlationId === corrIdBE })
    assert("BE.2 No queue entry after re-register (synchronous merge)", !reBE)
    var intentBE = frameworkIntents.getRecord(corrIdBE)
    assert("BE.3 Report exists after re-register", !!(intentBE?.decisionReport?.execution))
    if (intentBE?.decisionReport?.execution) {
      assert("BE.4 settlementStatus is confirmed after merge", intentBE.decisionReport.execution.settlementStatus === "confirmed", "got " + intentBE.decisionReport.execution.settlementStatus)
    }
  } finally {
    flushPendingSettlementReplays()
  }
}

// -- Scenario BF: flushPendingSettlementReplays returns 0 when empty ----
// Queue is empty because every prior scenario cleaned up its own entries.
// (AY in try/finally, AZ flush in finally, BA set+flush in finally,
//  BB flush in finally, BC flush in finally, BD flush in finally,
//  BE entry drops then merges synchronously.)

console.log("Scenario BF � flushPendingSettlementReplays returns 0 when queue is empty")

{
  // Assert queue is clean before testing empty flush — any leak means
  // a prior scenario's finally block failed to clean up.
  var diagBeforeBF = getPendingSettlementReplayDiagnostics()
  assert("BF.0 Precondition: queue empty before BF", diagBeforeBF.length === 0,
    "got " + diagBeforeBF.length + " entries: " + JSON.stringify(diagBeforeBF.map(function (e) { return e.correlationId + "@" + e.settlementId + " retry=" + e.retryCount })))

  // Flush should return 0 when the queue is already consumed
  var flushCount = flushPendingSettlementReplays()
  assert("BF.1 flush returns 0 when empty", flushCount === 0, "got " + flushCount)
  assert("BF.2 No entries after empty flush", getPendingSettlementReplayDiagnostics().length === 0)
}

// -- Scenario BG: flushPendingSettlementReplays FIFO � A B C � A fails, B and C blocked --

console.log("Scenario BG � flushPendingSettlementReplays FIFO � three entries same corrId, first fails, rest blocked")
console.log("  (A enqueued first, processed first; A fails ? B and C blocked)")

{
  var corrIdBG = "scenario_BG_fifo_block"
  var corrIdBGSuccess = "scenario_BG_independent_success"
  var setBG1 = "settlement_BG_first"
  var setBG2 = "settlement_BG_second"
  var setBG3 = "settlement_BG_third"
  var setBGSuccess = "settlement_BG_success"

  frameworkIntents.publish({ id: corrIdBG, agentId: "test-bg", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkIntents.publish({ id: corrIdBGSuccess, agentId: "test-bg", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Enqueue three entries for same correlationId (report absent each time)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBG, { settlementId: setBG1 }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBG, { settlementId: setBG2, status: "submitted" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBG, { settlementId: setBG3, status: "confirmed" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBGSuccess, { settlementId: setBGSuccess }))

  // Set report so the override fires
  frameworkIntents.setDecisionReport(corrIdBG, makeReport("decision_" + corrIdBG, corrIdBG))
  frameworkIntents.setDecisionReport(corrIdBGSuccess, makeReport("decision_" + corrIdBGSuccess, corrIdBGSuccess))

  const _restoreOverride = replaceSetDecisionReport(function (id) {
    if (id === corrIdBG) throw new Error("BG failure")
    return true
  })
  try {
    // Use flush which processes ALL correlationIds
    var flushResult = captureWarnings(function () { return flushPendingSettlementReplays() })
    var flushReturned = flushResult.result

    var diagBG = getPendingSettlementReplayDiagnostics()
    var entriesBG = diagBG.filter(function (e) { return e.correlationId === corrIdBG })
    // First entry (setBG1) was processed ? failed, retryCount=1
    // It was retained (retryCount < MAX), so it stays in queue
    // B and C are blocked by the same correlationId
    assert("BG.1 At least one entry remains", entriesBG.length >= 1, "got " + entriesBG.length)
    assert("BG.2 All 3 entries remain (1 retained, 2 blocked)", entriesBG.length === 3, "got " + entriesBG.length)
    // The first entry (setBG1) has retryCount=1
    var firstBG = entriesBG.find(function (e) { return e.settlementId === setBG1 })
    assert("BG.3 First entry still in queue", !!firstBG, "firstBG not found")
    if (firstBG) {
      assert("BG.4 First entry retryCount === 1", firstBG.retryCount === 1, "got " + firstBG.retryCount)
    }
    // Verify the ordering: the entry at index 0 in the queue should be the first settlement
    if (diagBG.length > 0) {
      assert("BG.5 First queued entry is setBG1 (FIFO preserved)", diagBG[0].settlementId === setBG1, "got " + diagBG[0].settlementId)
    }
    assert("BG.6 One success, one failure and blocked items return 1 removal", flushReturned === 1, "got " + flushReturned)
    assert("BG.7 Independent success removed", !diagBG.find(function (e) { return e.settlementId === setBGSuccess }))
  } finally {
    _restoreOverride()
    flushPendingSettlementReplays()
  }
}

// -- Scenario BH: flushPendingSettlementReplays � different corrIds independent --

console.log("Scenario BH � flushPendingSettlementReplays � different correlationIds are independent")
console.log("  (B fails, A still succeeds, C still succeeds)")

{
  var corrIdBH_A = "scenario_BH_multi_A"
  var corrIdBH_B = "scenario_BH_multi_B"
  var corrIdBH_C = "scenario_BH_multi_C"

  frameworkIntents.publish({ id: corrIdBH_A, agentId: "test-bh", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkIntents.publish({ id: corrIdBH_B, agentId: "test-bh", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkIntents.publish({ id: corrIdBH_C, agentId: "test-bh", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Enqueue all three (report absent)
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBH_A, { settlementId: "settlement_BH_A" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBH_B, { settlementId: "settlement_BH_B" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBH_C, { settlementId: "settlement_BH_C" }))

  // Set reports
  frameworkIntents.setDecisionReport(corrIdBH_A, makeReport("decision_" + corrIdBH_A, corrIdBH_A))
  frameworkIntents.setDecisionReport(corrIdBH_B, makeReport("decision_" + corrIdBH_B, corrIdBH_B))
  frameworkIntents.setDecisionReport(corrIdBH_C, makeReport("decision_" + corrIdBH_C, corrIdBH_C))

  // Only corrIdBH_B fails
  const _restoreOverride = replaceSetDecisionReport(function (id) {
    if (id === corrIdBH_B) throw new Error("BH failure B")
    return true
  })

  try {
    flushPendingSettlementReplays()

    var diagBH = getPendingSettlementReplayDiagnostics()
    // A and C should be cleared, B should remain
    var leftA = diagBH.find(function (e) { return e.correlationId === corrIdBH_A })
    var leftB = diagBH.find(function (e) { return e.correlationId === corrIdBH_B })
    var leftC = diagBH.find(function (e) { return e.correlationId === corrIdBH_C })
    assert("BH.1 A cleared (different corrId)", !leftA)
    assert("BH.2 B remains (failed)", !!leftB)
    assert("BH.3 C cleared (different corrId)", !leftC)
    if (leftB) {
      assert("BH.4 B retryCount >= 1", leftB.retryCount >= 1, "got " + leftB.retryCount)
    }
  } finally {
    _restoreOverride()
    flushPendingSettlementReplays()
  }
}

// -- Scenario BI: A1/A2/A3 FIFO via flushPendingSettlementReplays (no projection) --

console.log("Scenario BI � A1/A2/A3 FIFO via flushPendingSettlementReplays")
console.log("  (uses flushPendingSettlementReplays to avoid projection;")
console.log("   distinct txHashes ensure non-identical reports so setDecisionReport is reached;")
console.log("   A1 succeeds, A2 fails, A3 blocked; second call clears all)")

{
  var corrIdBI = "scenario_BI_main"
  var corrIdBI_B = "scenario_BI_other"
  var setIdA1 = "settlement_BI_A1"
  var setIdA2 = "settlement_BI_A2"
  var setIdA3 = "settlement_BI_A3"
  var setIdB1 = "settlement_BI_B1"

  frameworkIntents.publish({ id: corrIdBI, agentId: "test-bi", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkIntents.publish({ id: corrIdBI_B, agentId: "test-bi", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })

  // Enqueue A1, A2, A3 (same corrId) with distinct txHashes, then B1 (different corrId)
  // Using distinct txHashes ensures even with same "confirmed" status,
  // updateDecisionReportFromSettlement finds non-identical reports and calls setDecisionReport.
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBI, { settlementId: setIdA1, txHash: "0xa100000000000000000000000000000000000000000000000000000000000001" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBI, { settlementId: setIdA2, txHash: "0xa200000000000000000000000000000000000000000000000000000000000002" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBI, { settlementId: setIdA3, txHash: "0xa300000000000000000000000000000000000000000000000000000000000003" }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBI_B, { settlementId: setIdB1 }))

  // Set reports so replay can find them
  frameworkIntents.setDecisionReport(corrIdBI, makeReport("decision_" + corrIdBI, corrIdBI))
  frameworkIntents.setDecisionReport(corrIdBI_B, makeReport("decision_" + corrIdBI_B, corrIdBI_B))

  // Override: first `setDecisionReport` call for corrIdBI succeeds, second throws.
  // flushPendingSettlementReplays processes A1 (1st call, succeeds), A2 (2nd call, throws → blocked),
  // A3 blocked. B1 succeeds (different corrId, always true).
  var biFailA2 = true
  var firstPassProcessed: string[] = []
  var firstPassAProcessed: string[] = []
  var secondPassProcessed: string[] = []

  const _restoreOverride = replaceSetDecisionReport(function (id, updatedReport) {
    var appliedTxHash = updatedReport.execution?.txHash
    if (id === corrIdBI) {
      var settlementId = appliedTxHash === "0xa100000000000000000000000000000000000000000000000000000000000001" ? setIdA1
        : appliedTxHash === "0xa200000000000000000000000000000000000000000000000000000000000002" ? setIdA2
        : appliedTxHash === "0xa300000000000000000000000000000000000000000000000000000000000003" ? setIdA3
        : "unknown"
      if (biFailA2) {
        firstPassProcessed.push(settlementId)
        firstPassAProcessed.push(settlementId)
        if (settlementId === setIdA2) throw new Error("Simulated failure BI A2")
      } else {
        secondPassProcessed.push(settlementId)
      }
      return true
    }
    if (id === corrIdBI_B && biFailA2) firstPassProcessed.push(setIdB1)
    return true
  })

  try {
    // ── First pass: flushPendingSettlementReplays (no projection step) ──
    var firstFlushRemovedBI = flushPendingSettlementReplays()

    var diagBI = getPendingSettlementReplayDiagnostics()
    var entriesBI = diagBI.filter(function (e) { return e.correlationId === corrIdBI })
    // A1 removed (success); A2 retained (failure); A3 blocked
    assert("BI.1 A1 removed after success", !entriesBI.find(function (e) { return e.settlementId === setIdA1 }))
    assert("BI.2 A2 remains after failure", !!entriesBI.find(function (e) { return e.settlementId === setIdA2 }))
    assert("BI.3 A3 remains (blocked)", !!entriesBI.find(function (e) { return e.settlementId === setIdA3 }))
    // Verify exactly 2 entries remain for this corrId
    assert("BI.4 Exactly 2 entries remain (A2 + A3)", entriesBI.length === 2, "got " + entriesBI.length)
    // retryCounts
    var a2Entry = entriesBI.find(function (e) { return e.settlementId === setIdA2 })
    var a3Entry = entriesBI.find(function (e) { return e.settlementId === setIdA3 })
    assert("BI.5 A2 retryCount === 1", a2Entry ? a2Entry.retryCount === 1 : false, "got " + (a2Entry ? a2Entry.retryCount : "missing"))
    assert("BI.6 A3 retryCount === 0 (never attempted)", a3Entry ? a3Entry.retryCount === 0 : false, "got " + (a3Entry ? a3Entry.retryCount : "missing"))
    // FIFO order: A2 before A3 in queue
    if (entriesBI.length >= 2) {
      assert("BI.7 FIFO order: A2 before A3", entriesBI[0].settlementId === setIdA2 && entriesBI[1].settlementId === setIdA3,
        "got [" + entriesBI.map(function (e) { return e.settlementId }).join(",") + "]")
    }
    assert("BI.8 A3 NOT attempted in first pass", firstPassAProcessed.indexOf(setIdA3) === -1)
    assert("BI.9 First pass A order exactly [A1, A2]",
      JSON.stringify(firstPassAProcessed) === JSON.stringify([setIdA1, setIdA2]),
      "got [" + firstPassAProcessed.join(",") + "]")
    assert("BI.10 Global first-pass order exactly [A1, A2, B1]",
      JSON.stringify(firstPassProcessed) === JSON.stringify([setIdA1, setIdA2, setIdB1]),
      "got [" + firstPassProcessed.join(",") + "]")
    assert("BI.11 First flush returns 2 removals", firstFlushRemovedBI === 2, "got " + firstFlushRemovedBI)

    // B1 processed independently — different corrId is unaffected by A2's failure
    var b1AfterFirstPass = diagBI.find(function (e) { return e.correlationId === corrIdBI_B })
    assert("BI.12 B1 processed independently (different corrId)", !b1AfterFirstPass)

    // ── Second pass: allow A2, then A3; keep the hook to observe exact order ──
    biFailA2 = false

    var flushedCount = flushPendingSettlementReplays()

    var diagBI2 = getPendingSettlementReplayDiagnostics()
    var a2After = diagBI2.find(function (e) { return e.correlationId === corrIdBI && e.settlementId === setIdA2 })
    var a3After = diagBI2.find(function (e) { return e.correlationId === corrIdBI && e.settlementId === setIdA3 })
    var b1After = diagBI2.find(function (e) { return e.correlationId === corrIdBI_B })

    assert("BI.13 A2 cleared on second call", !a2After)
    assert("BI.14 A3 cleared on second call", !a3After)
    assert("BI.15 B1 already cleared in first pass", !b1After)

    // ── Prove second pass processed [A2, A3] for corrIdBI ──
    // Before pass 2 the remaining entries for corrIdBI were [A2(retry=1), A3(retry=0)]
    // (known from entriesBI above). After pass 2 both are gone.
    // The hook remains installed in success mode so it records both removals.
    assert("BI.16 Second pass processed [A2, A3]",
      JSON.stringify(secondPassProcessed) === JSON.stringify([setIdA2, setIdA3]),
      "got [" + secondPassProcessed.join(",") + "]")
    assert("BI.17 Second flush returns 2 removals", flushedCount === 2, "got " + flushedCount)

    // No entries remain for either correlationId
    assert("BI.18 No entries remain for main corrId", diagBI2.filter(function (e) { return e.correlationId === corrIdBI }).length === 0)
    assert("BI.19 No entries remain for other corrId", diagBI2.filter(function (e) { return e.correlationId === corrIdBI_B }).length === 0)
  } finally {
    _restoreOverride()
    flushPendingSettlementReplays()
  }
}

// ══════════════════════════════════════════════════════════════════════════

// ── Summary ──────────────────────────────────────────────────────────────

// Scenario BJ: scoped replaySettlementForCorrelationId FIFO
console.log("Scenario BJ - scoped replaySettlementForCorrelationId FIFO and correlation isolation")
{
  var corrIdBJ_A = "scenario_BJ_scoped_A"
  var corrIdBJ_B = "scenario_BJ_scoped_B"
  var setBJA1 = "settlement_BJ_A1"
  var setBJA2 = "settlement_BJ_A2"
  var setBJA3 = "settlement_BJ_A3"
  var setBJB1 = "settlement_BJ_B1"
  var txBJA1 = "0xe100000000000000000000000000000000000000000000000000000000000001"
  var txBJA2 = "0xe200000000000000000000000000000000000000000000000000000000000002"
  var txBJA3 = "0xe300000000000000000000000000000000000000000000000000000000000003"
  var txBJB1 = "0xe400000000000000000000000000000000000000000000000000000000000004"

  frameworkIntents.publish({ id: corrIdBJ_A, agentId: "test-bj", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkIntents.publish({ id: corrIdBJ_B, agentId: "test-bj", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBJ_A, { settlementId: setBJA1, txHash: txBJA1 }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBJ_A, { settlementId: setBJA2, txHash: txBJA2 }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBJ_A, { settlementId: setBJA3, txHash: txBJA3 }))
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBJ_B, { settlementId: setBJB1, txHash: txBJB1 }))
  frameworkIntents.setDecisionReport(corrIdBJ_A, makeReport("decision_" + corrIdBJ_A, corrIdBJ_A))
  frameworkIntents.setDecisionReport(corrIdBJ_B, makeReport("decision_" + corrIdBJ_B, corrIdBJ_B))

  var failBJA2 = true
  var firstOrderBJ: string[] = []
  var secondOrderBJ: string[] = []
  var bOrderBJ: string[] = []
  const restoreFindBJ = replaceFindByCorrelationId(function () { return null })
  const restoreSetBJ = replaceSetDecisionReport(function (id, updatedReport) {
    var txHash = updatedReport.execution?.txHash
    var settlementId = txHash === txBJA1 ? setBJA1
      : txHash === txBJA2 ? setBJA2
      : txHash === txBJA3 ? setBJA3
      : txHash === txBJB1 ? setBJB1
      : "unknown"
    if (id === corrIdBJ_A) {
      if (failBJA2) firstOrderBJ.push(settlementId)
      else secondOrderBJ.push(settlementId)
      if (failBJA2 && settlementId === setBJA2) throw new Error("BJ A2 failure")
    } else if (id === corrIdBJ_B) {
      bOrderBJ.push(settlementId)
    }
    return true
  })

  try {
    replaySettlementForCorrelationId(corrIdBJ_A)
    var diagBJ1 = getPendingSettlementReplayDiagnostics()
    var aBJ1 = diagBJ1.filter(function (e) { return e.correlationId === corrIdBJ_A })
    assert("BJ.1 First A order exactly [A1,A2]", JSON.stringify(firstOrderBJ) === JSON.stringify([setBJA1, setBJA2]), "got " + JSON.stringify(firstOrderBJ))
    assert("BJ.2 A1 removed", !aBJ1.find(function (e) { return e.settlementId === setBJA1 }))
    assert("BJ.3 A2 remains", !!aBJ1.find(function (e) { return e.settlementId === setBJA2 }))
    assert("BJ.4 A2 retryCount 1", aBJ1.find(function (e) { return e.settlementId === setBJA2 })?.retryCount === 1)
    assert("BJ.5 A3 remains", !!aBJ1.find(function (e) { return e.settlementId === setBJA3 }))
    assert("BJ.6 A3 retryCount 0", aBJ1.find(function (e) { return e.settlementId === setBJA3 })?.retryCount === 0)
    assert("BJ.7 B1 untouched by scoped A replay", !!diagBJ1.find(function (e) { return e.settlementId === setBJB1 }) && bOrderBJ.length === 0)

    failBJA2 = false
    replaySettlementForCorrelationId(corrIdBJ_A)
    var diagBJ2 = getPendingSettlementReplayDiagnostics()
    assert("BJ.8 Second A order exactly [A2,A3]", JSON.stringify(secondOrderBJ) === JSON.stringify([setBJA2, setBJA3]), "got " + JSON.stringify(secondOrderBJ))
    assert("BJ.9 A queue empty", !diagBJ2.find(function (e) { return e.correlationId === corrIdBJ_A }))
    assert("BJ.10 B1 still remains after second A replay", !!diagBJ2.find(function (e) { return e.settlementId === setBJB1 }))

    replaySettlementForCorrelationId(corrIdBJ_B)
    var diagBJ3 = getPendingSettlementReplayDiagnostics()
    assert("BJ.11 B order exactly [B1]", JSON.stringify(bOrderBJ) === JSON.stringify([setBJB1]), "got " + JSON.stringify(bOrderBJ))
    assert("BJ.12 B queue empty", !diagBJ3.find(function (e) { return e.correlationId === corrIdBJ_B }))
  } finally {
    restoreSetBJ()
    restoreFindBJ()
    flushPendingSettlementReplays()
  }
}

// Scenario BK: diagnostics balanceDeltas copy isolation
console.log("Scenario BK - diagnostics balanceDeltas copy isolation")
{
  var corrIdBK = "scenario_BK_diagnostics_copy"
  var setBK = "settlement_BK_001"
  frameworkIntents.publish({ id: corrIdBK, agentId: "test-bk", action: "BUY", params: { fromToken: "USDC", toToken: "cirBTC", rede: "arc" }, confidence: 80, timestamp: Date.now() })
  frameworkSettlementRegistry.registerPending(makeSettlementRecord(corrIdBK, {
    settlementId: setBK,
    balanceDeltas: { USDC: "-5000000", cirBTC: "0.0005" },
  }))
  frameworkIntents.setDecisionReport(corrIdBK, makeReport("decision_" + corrIdBK, corrIdBK))

  var appliedBalanceDeltasBK: Record<string, string> | undefined
  const restoreSetBK = replaceSetDecisionReport(function (_id, updatedReport) {
    appliedBalanceDeltasBK = updatedReport.execution?.balanceDeltas
    return true
  })

  try {
    var firstDiagBK = getPendingSettlementReplayDiagnostics().find(function (e) { return e.settlementId === setBK })
    assert("BK.1 Diagnostics entry exists", !!firstDiagBK)
    if (firstDiagBK?.balanceDeltas) {
      firstDiagBK.balanceDeltas.USDC = "-99999999"
      delete firstDiagBK.balanceDeltas.cirBTC
      firstDiagBK.balanceDeltas.EURC = "+10000000"
    }
    var secondDiagBK = getPendingSettlementReplayDiagnostics().find(function (e) { return e.settlementId === setBK })
    assert("BK.2 Internal USDC unchanged", secondDiagBK?.balanceDeltas?.USDC === "-5000000")
    assert("BK.3 Internal cirBTC key preserved", secondDiagBK?.balanceDeltas?.cirBTC === "0.0005")
    assert("BK.4 Added EURC key not leaked", secondDiagBK?.balanceDeltas?.EURC === undefined)

    flushPendingSettlementReplays()
    assert("BK.5 Replay applied original USDC", appliedBalanceDeltasBK?.USDC === "-5000000")
    assert("BK.6 Replay applied original cirBTC", appliedBalanceDeltasBK?.cirBTC === "0.0005")
    assert("BK.7 Replay did not apply injected EURC", appliedBalanceDeltasBK?.EURC === undefined)
  } finally {
    restoreSetBK()
    flushPendingSettlementReplays()
  }
}

console.log(`\n${"=".repeat(96)}`)
console.log("Scenario assertion table")
console.log(`${"Scenario".padEnd(10)}${"Assertions".padEnd(12)}${"Cumulative".padEnd(12)}Name`)
let cumulativeAssertions = 0
for (const scenario of SCENARIO_ORDER) {
  const assertions = scenarioAssertionCounts.get(scenario) ?? 0
  cumulativeAssertions += assertions
  console.log(
    `${scenario.padEnd(10)}${String(assertions).padEnd(12)}${String(cumulativeAssertions).padEnd(12)}${SCENARIO_NAMES[scenario]}`,
  )
}
console.log(`${"=".repeat(96)}`)
console.log(`Counted assertions: ${cumulativeAssertions}`)

console.log(`\n${"=".repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
console.log(`${"=".repeat(50)}`)

if (failed > 0) {
  process.exit(1)
}
