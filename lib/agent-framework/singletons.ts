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
    console.warn(`[SETTLEMENT] ⚠️ DecisionReport not found for settlement update correlation:${record.correlationId} decisionReportId:${record.decisionReportId ?? "unknown"}`)
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
