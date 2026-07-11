import { Reputation } from "./reputation"
import { Audit } from "./audit"
import { IntentPublisher } from "./intent-publisher"
import { OnChainIntentPublisher } from "./onchain-intent-publisher"
import { KnowledgeService } from "./knowledge-service"
import { Coordinator } from "./coordinator"
import { PolicyEngine } from "./policy-engine"
import { SettlementRegistry, type SettlementRecord } from "./settlement-registry"
import type { DecisionReport } from "./decision-report"
import type { IntentRecord } from "./intent-types"

export const frameworkReputation = new Reputation("arcflow")
export const frameworkAudit = new Audit("arcflow")
export const frameworkIntents = new OnChainIntentPublisher(new IntentPublisher("arcflow"))
export const frameworkKnowledge = new KnowledgeService()
export const frameworkPolicy = new PolicyEngine()
export const frameworkSettlementRegistry = new SettlementRegistry()
frameworkSettlementRegistry.setRecordListener(updateDecisionReportFromSettlement)
export const frameworkCoordinator = new Coordinator({ name: "ArcCoordinator", audit: frameworkAudit, policyEngine: frameworkPolicy, intentPublisher: frameworkIntents })

// ── Pending settlement replay queue ──────────────────────────────────────
// Holds settlement updates that arrived before the matching DecisionReport
// was saved. Flushed on explicit replay or next setDecisionReport.
// Each entry carries replay metadata (retryCount, timestamps, lastError).
// Bounded at MAX_PENDING_SETTLEMENT_REPLAYS — oldest entries are evicted
// with an observable warning to prevent unbounded memory growth.
const MAX_PENDING_SETTLEMENT_REPLAYS = 500
const MAX_SETTLEMENT_REPLAY_ATTEMPTS = 5
let nextReplayId = 0

type PendingSettlementReplayEntry = {
  replayId: string
  record: SettlementRecord
  retryCount: number
  firstQueuedAt: number
  lastAttemptAt?: number
  lastError?: string
}

let pendingSettlementReplays: PendingSettlementReplayEntry[] = []

type DecisionReportExecution = NonNullable<DecisionReport["execution"]>
type ReportSettlementStatus = NonNullable<DecisionReportExecution["settlementStatus"]>
const PROGRESSIVE_SETTLEMENT_STATUS_ORDER: Partial<Record<ReportSettlementStatus, number>> = {
  dispatched: 1,
  submitted: 2,
  confirmed: 3,
  settled: 4,
  reconciled: 5,
}

function isZeroTxHash(txHash?: string): boolean {
  if (!txHash) return false
  const normalized = txHash.toLowerCase()
  return normalized === "0x00000000" || /^0x0+$/.test(normalized)
}

function settlementStatusForReport(record: SettlementRecord): ReportSettlementStatus {
  if (record.status === "synthetic") return "synthetic"
  if (record.status === "failed") return "failed"
  if (record.status === "confirmed") return "confirmed"
  if (record.status === "submitted") return "submitted"
  return "dispatched"
}

function isProvisionalSettlement(record: SettlementRecord): boolean {
  return record.status === "dispatched" || record.status === "submitted" || record.status === "confirmed"
}

function isTradingReport(report: DecisionReport): boolean {
  const adapter = report.execution?.adapter?.toLowerCase()
  if (!adapter) return true
  return adapter === "tradingadapter" || adapter === "trading"
}

function isStatusRegression(current: ReportSettlementStatus | undefined, incoming: ReportSettlementStatus): boolean {
  const currentOrder = current ? PROGRESSIVE_SETTLEMENT_STATUS_ORDER[current] : undefined
  const incomingOrder = PROGRESSIVE_SETTLEMENT_STATUS_ORDER[incoming]
  return currentOrder !== undefined && incomingOrder !== undefined && incomingOrder < currentOrder
}

function shouldIgnoreTerminalOverwrite(currentExecution: DecisionReportExecution, incoming: ReportSettlementStatus): boolean {
  if (incoming !== "failed" && incoming !== "synthetic") return false
  return currentExecution.settlementStatus === "confirmed" && currentExecution.canonicalSettlement === true
}

function shouldIgnoreTerminalFlipFlop(currentExecution: DecisionReportExecution, incoming: ReportSettlementStatus): boolean {
  return currentExecution.settlementStatus === "synthetic" && incoming === "failed"
}

function findIntentRecordForSettlement(record: SettlementRecord): IntentRecord | null {
  const matchedReportId = record.decisionReportId ||
    frameworkSettlementRegistry.findByCorrelationId(record.correlationId)?.decisionReportId

  if (matchedReportId) {
    const byDecisionReportId = frameworkIntents
      .list()
      .find(intentRecord => intentRecord.decisionReport?.id === matchedReportId)
    if (byDecisionReportId) return byDecisionReportId
  }

  if (record.intentId) {
    const byIntentId = frameworkIntents.getRecord(record.intentId)
    if (byIntentId?.decisionReport) return byIntentId
  }

  const byCorrelationId = frameworkIntents.getRecord(record.correlationId)
  if (byCorrelationId?.decisionReport) return byCorrelationId

  return frameworkIntents
    .list()
    .find(intentRecord =>
      intentRecord.decisionReport?.execution?.correlationId === record.correlationId ||
      intentRecord.decisionReport?.intentId === record.correlationId
    ) ?? null
}

function updateDecisionReportFromSettlement(record: SettlementRecord): void {
  if (record.adapter !== "trading") {
    console.warn(`[SETTLEMENT] ⚠️ Ignored settlement update for non-trading adapter correlation:${record.correlationId} adapter:${record.adapter}`)
    return
  }

  const intentRecord = findIntentRecordForSettlement(record)
  const report = intentRecord?.decisionReport
  if (!intentRecord || !report?.execution) {
    console.warn(`[SETTLEMENT] ⚠️ DecisionReport not found for settlement update correlation:${record.correlationId} decisionReportId:${record.decisionReportId ?? "unknown"} — queued for replay`)
    if (!pendingSettlementReplays.some(e => e.record.settlementId === record.settlementId)) {
      if (pendingSettlementReplays.length >= MAX_PENDING_SETTLEMENT_REPLAYS) {
        const evicted = pendingSettlementReplays.shift()!
        _settlementReplayLog("evicted_queue_full", evicted.record, 0, evicted.retryCount)
      }
      const snapshot = snapshotSettlementRecord(record)
      nextReplayId++
      pendingSettlementReplays.push({
        replayId: `replay_${nextReplayId}_${Date.now()}`,
        record: snapshot,
        retryCount: 0,
        firstQueuedAt: Date.now(),
      })
    }
    return
  }

  if (!isTradingReport(report)) {
    console.warn(`[SETTLEMENT] ⚠️ Ignored settlement update for adapter mismatch correlation:${record.correlationId} reportAdapter:${report.execution.adapter}`)
    return
  }

  const synthetic = record.synthetic === true || isZeroTxHash(record.txHash)
  const incomingStatus = settlementStatusForReport(record)
  const currentStatus = report.execution.settlementStatus
  const ignoreStaleStatus = isStatusRegression(currentStatus, incomingStatus)
  const ignoreTerminalOverwrite = shouldIgnoreTerminalOverwrite(report.execution, incomingStatus)
  const ignoreTerminalFlipFlop = shouldIgnoreTerminalFlipFlop(report.execution, incomingStatus)
  const settlementStatus = ignoreStaleStatus || ignoreTerminalOverwrite || ignoreTerminalFlipFlop
    ? currentStatus
    : incomingStatus
  const canonicalSettlement = incomingStatus === "confirmed" &&
    record.canonicalSettlement === true &&
    !synthetic &&
    !isZeroTxHash(record.txHash)

  if (ignoreStaleStatus || ignoreTerminalOverwrite || ignoreTerminalFlipFlop) {
    console.warn(`[SETTLEMENT] ⚠️ Ignored stale settlement status update correlation:${record.correlationId} current:${currentStatus ?? "none"} incoming:${incomingStatus}`)
    return
  }

  const executionPatch: Partial<DecisionReportExecution> = {
    correlationId: record.correlationId,
    settlementStatus,
    isProvisional: settlementStatus === currentStatus && (ignoreStaleStatus || ignoreTerminalOverwrite)
      ? report.execution.isProvisional
      : isProvisionalSettlement(record),
    synthetic,
    canonicalSettlement,
  }

  if (record.intentId) executionPatch.intentId = record.intentId
  if (record.proposalId) executionPatch.proposalId = record.proposalId
  if (record.decisionReportId) executionPatch.decisionReportId = record.decisionReportId
  if (record.ordemId) executionPatch.ordemId = record.ordemId
  if (record.txHash) executionPatch.txHash = record.txHash
  if (record.receiptStatus !== undefined) executionPatch.receiptStatus = record.receiptStatus
  if (record.blockNumber !== undefined) executionPatch.blockNumber = record.blockNumber
  if (record.gasUsed !== undefined) executionPatch.gasUsed = record.gasUsed
  if (record.effectiveGasPrice !== undefined) executionPatch.effectiveGasPrice = record.effectiveGasPrice
  if (record.gasCostNative !== undefined) executionPatch.gasCostNative = record.gasCostNative
  if (record.gasCostUsd !== undefined) executionPatch.gasCostUsd = record.gasCostUsd
  if (record.fromToken) executionPatch.fromToken = record.fromToken
  if (record.toToken) executionPatch.toToken = record.toToken
  if (record.amountIn !== undefined) executionPatch.amountIn = record.amountIn
  if (record.actualAmountOut !== undefined) executionPatch.actualAmountOut = record.actualAmountOut
  if (record.balanceDeltas !== undefined) {
    executionPatch.balanceDeltas = {
      ...(report.execution.balanceDeltas ?? {}),
      ...record.balanceDeltas,
    }
  }
  if (record.slippageBps !== undefined) executionPatch.slippageBps = record.slippageBps
  if (record.errorMsg !== undefined) executionPatch.errorMsg = record.errorMsg

  const updatedReport: DecisionReport = {
    ...report,
    execution: {
      ...report.execution,
      ...executionPatch,
    },
  }

  if (JSON.stringify(report.execution) === JSON.stringify(updatedReport.execution)) return

  frameworkIntents.setDecisionReport(intentRecord.intent.id, updatedReport)
}

// ── Replay/sync API ───────────────────────────────────────────────────────
// Phase 2e.2f: post-save replay ensures no settlement update is lost when
// the listener fires before _saveDecisionReport completes.

/** Replay a specific settlement record into the matching DecisionReport.
 *  Uses the same merge/safety logic as the automatic listener.
 *  Idempotent and monotonic — confirmed canonical cannot be downgraded. */
export function replaySettlementToDecisionReport(record: SettlementRecord): void {
  updateDecisionReportFromSettlement(record)
}

/** Look up the latest settlement record by correlationId and replay it.
 *  Also processes any queued replays for the same correlationId item by item.
 *  Safe to call anytime — no-op if no matching record exists.
 *  Exception-safe: items that fail remain in the queue for retry. */
export function replaySettlementForCorrelationId(correlationId: string): void {
  // 1. Project the current Registry record (best-effort).
  // If the projection throws, queued items are still processed — they may
  // carry older snapshots that succeed where the latest projection failed.
  const record = frameworkSettlementRegistry.findByCorrelationId(correlationId)
  if (record) {
    try {
      updateDecisionReportFromSettlement(record)
    } catch (error) {
      _settlementReplayLog("registry_projection_failed", record, 0, 0, error)
    }
  }

  // 2. Process queued items FIFO, one at a time, removing only on success.
  // We always search by replayId to handle index shifting after splice.
  let found = true
  while (found) {
    found = false
    for (let i = 0; i < pendingSettlementReplays.length; i++) {
      const entry = pendingSettlementReplays[i]
      if (entry.record.correlationId !== correlationId) continue

      found = true
      try {
        updateDecisionReportFromSettlement(entry.record)
      } catch (error) {
        entry.retryCount++
        entry.lastAttemptAt = Date.now()
        entry.lastError = safeErrorString(error)

        if (entry.retryCount >= MAX_SETTLEMENT_REPLAY_ATTEMPTS) {
          pendingSettlementReplays.splice(i, 1)
          _settlementReplayLog("dropped_after_retry_limit", entry.record, entry.retryCount, entry.retryCount, error)
        } else {
          _settlementReplayLog("retained", entry.record, entry.retryCount, entry.retryCount, error)
        }
        // On failure, stop processing this correlationId in this call
        // but mark found=false so the while loop exits.
        found = false
        break
      }

      // Success: remove the entry and restart scan (indices shifted).
      pendingSettlementReplays.splice(i, 1)
      break
    }
  }
}

/** Flush ALL queued settlement replays regardless of correlationId.
 *  Returns the number of entries removed during this call, whether applied
 *  successfully or deliberately dropped after reaching the retry limit.
 *  Processes item by item — only removes entries on success.
 *  Failed entries remain queued for retry (up to MAX_SETTLEMENT_REPLAY_ATTEMPTS).
 *  If one entry of a correlationId fails, remaining entries of the same
 *  correlationId are skipped in this flush call but NOT removed. */
export function flushPendingSettlementReplays(): number {
  if (pendingSettlementReplays.length === 0) return 0

  const blockedCorrelationIds = new Set<string>()
  let removedCount = 0

  for (let i = 0; i < pendingSettlementReplays.length; ) {
    const entry = pendingSettlementReplays[i]
    const corrId = entry.record.correlationId

    if (blockedCorrelationIds.has(corrId)) {
      i++
      continue
    }

    try {
      updateDecisionReportFromSettlement(entry.record)
    } catch (error) {
      entry.retryCount++
      entry.lastAttemptAt = Date.now()
      entry.lastError = safeErrorString(error)

      if (entry.retryCount >= MAX_SETTLEMENT_REPLAY_ATTEMPTS) {
        pendingSettlementReplays.splice(i, 1)
        removedCount++
        _settlementReplayLog("dropped_after_retry_limit", entry.record, entry.retryCount, entry.retryCount, error)
      } else {
        _settlementReplayLog("retained", entry.record, entry.retryCount, entry.retryCount, error)
        i++
      }
      blockedCorrelationIds.add(corrId)
      continue
    }

    // Success: remove and continue without increment (next entry shifts down).
    pendingSettlementReplays.splice(i, 1)
    removedCount++
  }

  return removedCount
}

// ── Snapshot helper ────────────────────────────────────────────────────────
// Prevents mutations on the original SettlementRegistry record from affecting
// a queued replay.  Explicitly copies every potentially-mutable field.
// SettlementRecord has only ONE mutable field by reference:
//   - balanceDeltas: Record<string, string>  ← object, shallow-copied below
// All other fields are scalars (string | number | boolean | undefined) and
// are safely captured by the spread operator:
//   settlementId, correlationId, intentId, proposalId, decisionReportId,
//   ordemId, adapter, status, txHash, receiptStatus, blockNumber, gasUsed,
//   effectiveGasPrice, gasCostNative, gasCostUsd, fromToken, toToken,
//   amountIn, quotedAmountOut, actualAmountOut, slippageBps, synthetic,
//   canonicalSettlement, errorMsg, timestamp, source
// No arrays, no nested objects, no details/receipts/txHashes fields exist.

function snapshotSettlementRecord(record: SettlementRecord): SettlementRecord {
  return {
    ...record,
    balanceDeltas: record.balanceDeltas ? { ...record.balanceDeltas } : undefined,
  }
}

// ── Log helper ─────────────────────────────────────────────────────────────

function safeErrorString(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message.split("\n")[0]}`
  return `Non-Error:${String(error).slice(0, 120)}`
}

function _settlementReplayLog(
  action: string,
  record: SettlementRecord,
  attempt: number,
  retryCount: number,
  error?: unknown,
): void {
  const err = error ? `error=${safeErrorString(error)}` : ""
  console.warn(
    `[SETTLEMENT] ⚠️ Replay: action=${action}` +
    ` correlationId=${record.correlationId}` +
    ` settlementId=${record.settlementId}` +
    ` status=${record.status}` +
    ` attempt=${attempt}` +
    ` retryCount=${retryCount}` +
    (err ? ` ${err}` : ""),
  )
}

// ── Read-only diagnostics (for tests, no production caller) ────────────────

export function getPendingSettlementReplayDiagnostics(): {
  replayId: string
  settlementId: string
  correlationId: string
  status: string
  retryCount: number
  firstQueuedAt: number
  lastAttemptAt?: number
  lastError?: string
  txHash?: string
  blockNumber?: number
  balanceDeltas?: Record<string, string>
}[] {
  return pendingSettlementReplays.map(entry => ({
    replayId: entry.replayId,
    settlementId: entry.record.settlementId,
    correlationId: entry.record.correlationId,
    status: entry.record.status,
    retryCount: entry.retryCount,
    firstQueuedAt: entry.firstQueuedAt,
    lastAttemptAt: entry.lastAttemptAt,
    lastError: entry.lastError,
    txHash: entry.record.txHash,
    blockNumber: entry.record.blockNumber,
    balanceDeltas: entry.record.balanceDeltas
      ? { ...entry.record.balanceDeltas }
      : undefined,
  }))
}
