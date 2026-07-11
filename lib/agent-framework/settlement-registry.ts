export type SettlementStatus =
  | "dispatched"
  | "submitted"
  | "confirmed"
  | "failed"
  | "settled"
  | "synthetic"

export type SettlementSource =
  | "coordinator"
  | "trading-adapter"
  | "pregao"
  | "corretor"
  | "real-swap"
  | "arc-direct-swap"

export interface SettlementRecord {
  settlementId: string
  correlationId: string
  intentId?: string
  proposalId?: string
  decisionReportId?: string
  ordemId?: string
  adapter: "trading"
  status: SettlementStatus
  txHash?: string
  receiptStatus?: number
  blockNumber?: number
  gasUsed?: string
  effectiveGasPrice?: string
  gasCostNative?: string
  gasCostUsd?: number
  fromToken?: string
  toToken?: string
  amountIn?: string
  quotedAmountOut?: string
  actualAmountOut?: string
  balanceDeltas?: Record<string, string>
  slippageBps?: number
  synthetic?: boolean
  canonicalSettlement: boolean
  errorMsg?: string
  timestamp: number
  source?: SettlementSource
}

export type SettlementUpdate = Partial<SettlementRecord> & {
  correlationId?: string
  ordemId?: string
  txHash?: string
}

export type SettlementRecordListener = (record: SettlementRecord) => void

let nextSettlementId = 0

function isZeroTxHash(txHash?: string): boolean {
  if (!txHash) return false
  const normalized = txHash.toLowerCase()
  return normalized === "0x00000000" || /^0x0+$/.test(normalized)
}

function normalizeRecord(record: SettlementRecord): SettlementRecord {
  const synthetic = record.synthetic === true || isZeroTxHash(record.txHash)
  return {
    ...record,
    synthetic,
    canonicalSettlement: record.canonicalSettlement === true && !synthetic,
    status: synthetic ? "synthetic" : record.status,
  }
}

function createSettlementId(timestamp: number): string {
  nextSettlementId += 1
  return `settlement_${nextSettlementId}_${timestamp}`
}

function definedSettlementUpdate(update: SettlementUpdate): SettlementUpdate {
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  ) as SettlementUpdate
}

const RESERVED_SETTLED_ERROR = "Settlement status \"settled\" is reserved for a future verification phase"

function warnReservedSettled(
  operation: "registerPending" | "recordUpdate",
  input: Pick<SettlementUpdate, "correlationId" | "settlementId">,
): void {
  console.warn(
    `[SettlementRegistry] Rejected ${operation}: ${RESERVED_SETTLED_ERROR}` +
    ` (correlationId=${input.correlationId ?? "unknown"}, settlementId=${input.settlementId ?? "unknown"})`,
  )
}

function recordsEqual(a: SettlementRecord, b: SettlementRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Status progression order ─────────────────────────────────────────────
// settled is reserved for a future verification phase — not active in STATUS_ORDER.
const STATUS_ORDER: Record<string, number> = {
  dispatched: 0,
  submitted: 1,
  confirmed: 2,
}

function statusOrder(s: string): number {
  return STATUS_ORDER[s] ?? -1
}

/** An authoritative settlement has on-chain certainty: confirmed canonical
 *  with canonicalSettlement=true, synthetic!=true, and non-zero txHash. */
function isAuthoritative(record: SettlementRecord): boolean {
  return record.status === "confirmed" &&
    record.canonicalSettlement === true &&
    record.synthetic !== true &&
    !!record.txHash &&
    !isZeroTxHash(record.txHash)
}

/** A protected settlement cannot be status-regressed, even if not canonical. */
function isProtectedStatus(record: SettlementRecord): boolean {
  return record.status === "confirmed"
}

// ── Field merge helpers for evidence protection ──────────────────────────
type MergeDecision = "overwrite" | "enrich" | "preserve"

function decideMerge<T>(
  existingVal: T | undefined,
  incomingVal: T | undefined,
  authoritative: boolean,
  sameSettlement: boolean,
): MergeDecision {
  if (!authoritative) return "overwrite"
  if (incomingVal === undefined) return "preserve"
  if (existingVal === undefined) return "enrich"
  if (!sameSettlement) return "preserve"
  return "preserve" // same settlement but conflicting — keep existing
}

function mergeScalar<T>(
  existingVal: T | undefined,
  incomingVal: T | undefined,
  authoritative: boolean,
  sameSettlement: boolean,
): T | undefined {
  const d = decideMerge(existingVal, incomingVal, authoritative, sameSettlement)
  if (d === "overwrite") return incomingVal
  if (d === "enrich") return incomingVal
  return existingVal
}

/** Merge a settlement update into an existing record with full monotonic
 *  protection for status progression and evidence fields.
 *
 *  Status progression (ordinal):  dispatched(0) < submitted(1) < confirmed(2)
 *  - failed and synthetic are terminal / diagnostic — not on the ordinal scale.
 *  - settled is reserved for a future verification phase and is not producible
 *    or promotable in this phase.
 *  - Once authoritative (confirmed canonical), all proof fields are locked;
 *    only enrichment from the same settlement (same txHash) is accepted for
 *    fields that are still undefined.
 */
function mergeSettlementRecord(existing: SettlementRecord, definedUpdate: SettlementUpdate): SettlementRecord {
  const incomingSynthetic =
    definedUpdate.synthetic === true ||
    isZeroTxHash(definedUpdate.txHash) ||
    definedUpdate.status === "synthetic"

  const existingAuth = isAuthoritative(existing)
  const existingProtected = isProtectedStatus(existing)
  const incomingOrd = definedUpdate.status !== undefined ? statusOrder(definedUpdate.status) : -1
  const existingOrd = statusOrder(existing.status)

  const incomingTxValid = !!definedUpdate.txHash && !isZeroTxHash(definedUpdate.txHash)
  const sameTxHash = existingAuth && incomingTxValid && definedUpdate.txHash === existing.txHash
  const sameSettlement = sameTxHash

  // ── Status ────────────────────────────────────────────────────────────
  // settled is reserved for a future verification phase — never produced here.
  let status: SettlementStatus

  if (existingProtected && incomingSynthetic) {
    status = existing.status
  } else if (existingProtected && definedUpdate.status !== undefined && incomingOrd < 2) {
    // confirmed (even non-canonical) protected from submitted/dispatched
    status = existing.status
  } else if (incomingSynthetic) {
    // dispatched, submitted, failed → synthetic
    status = "synthetic"
  } else if (existing.status === "synthetic") {
    // synthetic can only be replaced by confirmed (real proof on-chain)
    status = definedUpdate.status === "confirmed" ? "confirmed" : existing.status
  } else if (existing.status === "failed") {
    // failed can be replaced by confirmed or synthetic
    if (definedUpdate.status === "confirmed" || definedUpdate.status === "synthetic") {
      status = definedUpdate.status
    } else {
      status = existing.status
    }
  } else if (definedUpdate.status !== undefined && incomingOrd < existingOrd) {
    // ordinal regression blocked (e.g. submitted → dispatched)
    status = existing.status
  } else if (definedUpdate.status !== undefined) {
    // normal progression or same status
    status = definedUpdate.status
  } else {
    status = existing.status
  }

  // ── Synthetic flag ────────────────────────────────────────────────────
  let mergedSynthetic: boolean
  if (existingProtected) {
    mergedSynthetic = existing.synthetic === true
  } else if (incomingSynthetic || status === "synthetic") {
    mergedSynthetic = true
  } else if (definedUpdate.synthetic !== undefined) {
    mergedSynthetic = definedUpdate.synthetic === true
  } else if (definedUpdate.status !== undefined && definedUpdate.status !== existing.status) {
    mergedSynthetic = definedUpdate.status === "synthetic"
  } else {
    mergedSynthetic = existing.synthetic === true
  }

  // ── Canonical settlement ──────────────────────────────────────────────
  let canonicalSettlement: boolean
  if (existingAuth) {
    canonicalSettlement = true
  } else if (definedUpdate.canonicalSettlement !== undefined) {
    canonicalSettlement = definedUpdate.canonicalSettlement === true && !mergedSynthetic
  } else {
    canonicalSettlement = existing.canonicalSettlement === true && !mergedSynthetic
  }

  // ── txHash (special — identity of the settlement) ─────────────────────
  let txHash: string | undefined
  if (existingAuth) {
    if (definedUpdate.txHash !== undefined) {
      if (definedUpdate.txHash === existing.txHash || isZeroTxHash(definedUpdate.txHash)) {
        txHash = existing.txHash
      } else {
        console.warn(`[SettlementRegistry] ⚠️ Cannot replace txHash for ${existing.correlationId}: existing ${existing.txHash} vs incoming ${definedUpdate.txHash} — preserving existing`)
        txHash = existing.txHash
      }
    } else {
      txHash = existing.txHash
    }
  } else {
    txHash = definedUpdate.txHash !== undefined ? definedUpdate.txHash : existing.txHash
  }

  // ── Evidence / identity fields (protected for authoritative records) ───
  const a = existingAuth
  const s = sameSettlement

  const blockNumber = mergeScalar(existing.blockNumber, definedUpdate.blockNumber, a, s)
  const receiptStatus = mergeScalar(existing.receiptStatus, definedUpdate.receiptStatus, a, s)
  const gasUsed = mergeScalar(existing.gasUsed, definedUpdate.gasUsed, a, s)
  const effectiveGasPrice = mergeScalar(existing.effectiveGasPrice, definedUpdate.effectiveGasPrice, a, s)
  const gasCostNative = mergeScalar(existing.gasCostNative, definedUpdate.gasCostNative, a, s)
  const gasCostUsd = mergeScalar(existing.gasCostUsd, definedUpdate.gasCostUsd, a, s)
  const fromToken = mergeScalar(existing.fromToken, definedUpdate.fromToken, a, s)
  const toToken = mergeScalar(existing.toToken, definedUpdate.toToken, a, s)
  const amountIn = mergeScalar(existing.amountIn, definedUpdate.amountIn, a, s)
  const quotedAmountOut = mergeScalar(existing.quotedAmountOut, definedUpdate.quotedAmountOut, a, s)
  const actualAmountOut = mergeScalar(existing.actualAmountOut, definedUpdate.actualAmountOut, a, s)
  const slippageBps = mergeScalar(existing.slippageBps, definedUpdate.slippageBps, a, s)
  const ordemId = mergeScalar(existing.ordemId, definedUpdate.ordemId, a, s)

  // ── errorMsg ──────────────────────────────────────────────────────────
  let errorMsg: string | undefined
  if (existingAuth) {
    errorMsg = existing.errorMsg
  } else if (status === "confirmed" && existing.status !== "confirmed") {
    errorMsg = definedUpdate.errorMsg ?? undefined
  } else {
    errorMsg = definedUpdate.errorMsg ?? existing.errorMsg
  }

  // ── balanceDeltas ─────────────────────────────────────────────────────
  let balanceDeltas: Record<string, string> | undefined
  if (!existingAuth) {
    balanceDeltas = definedUpdate.balanceDeltas
      ? { ...(existing.balanceDeltas ?? {}), ...definedUpdate.balanceDeltas }
      : existing.balanceDeltas
  } else if (!definedUpdate.balanceDeltas) {
    balanceDeltas = existing.balanceDeltas
  } else if (!existing.balanceDeltas) {
    balanceDeltas = definedUpdate.balanceDeltas
  } else if (!sameSettlement) {
    balanceDeltas = existing.balanceDeltas
  } else {
    const merged = { ...existing.balanceDeltas }
    for (const [key, value] of Object.entries(definedUpdate.balanceDeltas)) {
      if (existing.balanceDeltas[key] !== undefined && existing.balanceDeltas[key] !== value) {
        console.warn(`[SettlementRegistry] ⚠️ Conflicting balanceDelta for key ${key} in ${existing.correlationId} — preserving existing`)
      } else if (existing.balanceDeltas[key] === undefined) {
        merged[key] = value
      }
    }
    balanceDeltas = merged
  }

  // ── Timestamp — lock for authoritative records ────────────────────────
  const timestamp = existingAuth
    ? existing.timestamp
    : (definedUpdate.timestamp ?? Date.now())

  // ── Optional fields — always enrich ───────────────────────────────────
  return {
    settlementId: existing.settlementId,
    correlationId: definedUpdate.correlationId ?? existing.correlationId,
    adapter: definedUpdate.adapter ?? existing.adapter,
    status,
    canonicalSettlement,
    synthetic: mergedSynthetic,
    txHash,
    blockNumber,
    receiptStatus,
    timestamp,
    intentId: definedUpdate.intentId ?? existing.intentId,
    proposalId: definedUpdate.proposalId ?? existing.proposalId,
    decisionReportId: definedUpdate.decisionReportId ?? existing.decisionReportId,
    ordemId,
    fromToken, toToken, amountIn, quotedAmountOut, actualAmountOut,
    errorMsg,
    source: definedUpdate.source ?? existing.source,
    gasUsed, effectiveGasPrice, gasCostNative, gasCostUsd,
    slippageBps,
    balanceDeltas,
  }
}

export class SettlementRegistry {
  private records = new Map<string, SettlementRecord>()
  private byCorrelationId = new Map<string, string>()
  private byOrdemId = new Map<string, string>()
  private byTxHash = new Map<string, string>()
  private recordListener: SettlementRecordListener | null = null

  setRecordListener(listener: SettlementRecordListener | null): void {
    this.recordListener = listener
  }

  registerPending(record: SettlementRecord): SettlementRecord {
    // Reject the caller's explicit reserved status before normalizeRecord() can
    // mask it as synthetic because of synthetic=true or an all-zero txHash.
    if (record.status === "settled") {
      warnReservedSettled("registerPending", record)
      throw new RangeError(RESERVED_SETTLED_ERROR)
    }

    const normalized = normalizeRecord(record)
    this.deindex(record.settlementId)
    this.records.set(normalized.settlementId, normalized)
    this.index(normalized)
    this.notify(normalized)
    return normalized
  }

  recordUpdate(update: SettlementUpdate): SettlementRecord | null {
    const definedUpdate = definedSettlementUpdate(update)
    const existing = this.findMatchingRecord(definedUpdate)

    // Reject the entire mixed update. No evidence fields, timestamps, indexes,
    // records, or listener notifications are applied from a reserved status.
    if (definedUpdate.status === "settled") {
      warnReservedSettled("recordUpdate", definedUpdate)
      return existing ?? null
    }

    if (!existing) {
      if (!update.correlationId || !update.adapter || !update.status) return null
      const timestamp = update.timestamp ?? Date.now()
      const created = normalizeRecord({
        settlementId: update.settlementId ?? createSettlementId(timestamp),
        correlationId: update.correlationId,
        adapter: update.adapter,
        status: update.status,
        canonicalSettlement: update.canonicalSettlement === true,
        timestamp,
        intentId: update.intentId,
        proposalId: update.proposalId,
        decisionReportId: update.decisionReportId,
        ordemId: update.ordemId,
        txHash: update.txHash,
        receiptStatus: update.receiptStatus,
        blockNumber: update.blockNumber,
        gasUsed: update.gasUsed,
        effectiveGasPrice: update.effectiveGasPrice,
        gasCostNative: update.gasCostNative,
        gasCostUsd: update.gasCostUsd,
        fromToken: update.fromToken,
        toToken: update.toToken,
        amountIn: update.amountIn,
        quotedAmountOut: update.quotedAmountOut,
        actualAmountOut: update.actualAmountOut,
        balanceDeltas: update.balanceDeltas,
        slippageBps: update.slippageBps,
        synthetic: update.synthetic,
        errorMsg: update.errorMsg,
        source: update.source,
      })
      this.records.set(created.settlementId, created)
      this.index(created)
      this.notify(created)
      return created
    }

    const candidate = normalizeRecord(mergeSettlementRecord(existing, definedUpdate))

    const sameWithoutTimestamp = recordsEqual(
      { ...existing, timestamp: candidate.timestamp },
      candidate,
    )
    const merged = sameWithoutTimestamp
      ? { ...candidate, timestamp: existing.timestamp }
      : candidate

    if (recordsEqual(existing, merged)) return existing

    this.deindex(existing.settlementId)
    this.records.set(merged.settlementId, merged)
    this.index(merged)
    this.notify(merged)
    return merged
  }

  findByCorrelationId(correlationId: string): SettlementRecord | null {
    return this.findByIndex(this.byCorrelationId, correlationId)
  }

  findByOrdemId(ordemId: string): SettlementRecord | null {
    return this.findByIndex(this.byOrdemId, ordemId)
  }

  findByTxHash(txHash: string): SettlementRecord | null {
    return this.findByIndex(this.byTxHash, txHash)
  }

  listRecent(limit = 50): SettlementRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  private findMatchingRecord(update: SettlementUpdate): SettlementRecord | null {
    if (update.settlementId) {
      const byId = this.records.get(update.settlementId)
      if (byId) return byId
    }
    if (update.correlationId) {
      const byCorrelation = this.findByCorrelationId(update.correlationId)
      if (byCorrelation) return byCorrelation
    }
    if (update.ordemId) {
      const byOrder = this.findByOrdemId(update.ordemId)
      if (byOrder) return byOrder
    }
    if (update.txHash && !isZeroTxHash(update.txHash)) {
      const byTx = this.findByTxHash(update.txHash)
      if (!byTx) return null
      if (!update.correlationId || !byTx.correlationId || update.correlationId === byTx.correlationId) {
        return byTx
      }
      console.warn(`[SETTLEMENT] ⚠️ txHash correlation conflict tx:${update.txHash} existing:${byTx.correlationId} incoming:${update.correlationId}`)
    }
    return null
  }

  private findByIndex(index: Map<string, string>, key: string): SettlementRecord | null {
    const settlementId = index.get(key)
    return settlementId ? this.records.get(settlementId) ?? null : null
  }

  private index(record: SettlementRecord): void {
    this.byCorrelationId.set(record.correlationId, record.settlementId)
    if (record.ordemId) this.byOrdemId.set(record.ordemId, record.settlementId)
    if (record.txHash && !isZeroTxHash(record.txHash)) {
      const existing = this.findByTxHash(record.txHash)
      if (!existing || !existing.correlationId || existing.correlationId === record.correlationId) {
        this.byTxHash.set(record.txHash, record.settlementId)
      } else {
        console.warn(`[SETTLEMENT] ⚠️ txHash correlation conflict tx:${record.txHash} existing:${existing.correlationId} incoming:${record.correlationId}`)
      }
    }
  }

  private deindex(settlementId: string): void {
    const record = this.records.get(settlementId)
    if (!record) return
    this.byCorrelationId.delete(record.correlationId)
    if (record.ordemId) this.byOrdemId.delete(record.ordemId)
    if (record.txHash && !isZeroTxHash(record.txHash)) this.byTxHash.delete(record.txHash)
  }

  private notify(record: SettlementRecord): void {
    if (!this.recordListener) return
    try {
      this.recordListener(record)
    } catch (error) {
      console.warn("[SettlementRegistry] record listener failed:", error)
    }
  }
}
