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

function recordsEqual(a: SettlementRecord, b: SettlementRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function settlementStatusForMerge(existing: SettlementRecord, update: SettlementUpdate): SettlementStatus {
  const incomingSynthetic = update.synthetic === true || isZeroTxHash(update.txHash) || update.status === "synthetic"
  if (incomingSynthetic) return "synthetic"
  if (existing.status === "synthetic" && update.status === "failed") return "synthetic"
  return update.status ?? existing.status
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
    const normalized = normalizeRecord(record)
    this.deindex(record.settlementId)
    this.records.set(normalized.settlementId, normalized)
    this.index(normalized)
    this.notify(normalized)
    return normalized
  }

  recordUpdate(update: SettlementUpdate): SettlementRecord | null {
    const existing = this.findMatchingRecord(update)
    const definedUpdate = definedSettlementUpdate(update)

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

    const candidate = normalizeRecord({
      ...existing,
      ...definedUpdate,
      settlementId: existing.settlementId,
      correlationId: definedUpdate.correlationId ?? existing.correlationId,
      adapter: definedUpdate.adapter ?? existing.adapter,
      status: settlementStatusForMerge(existing, definedUpdate),
      timestamp: definedUpdate.timestamp ?? Date.now(),
      canonicalSettlement: update.canonicalSettlement === undefined
        ? existing.canonicalSettlement
        : update.canonicalSettlement,
      balanceDeltas: definedUpdate.balanceDeltas
        ? { ...(existing.balanceDeltas ?? {}), ...definedUpdate.balanceDeltas }
        : existing.balanceDeltas,
    })

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
