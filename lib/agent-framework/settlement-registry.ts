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

export class SettlementRegistry {
  private records = new Map<string, SettlementRecord>()
  private byCorrelationId = new Map<string, string>()
  private byOrdemId = new Map<string, string>()
  private byTxHash = new Map<string, string>()

  registerPending(record: SettlementRecord): SettlementRecord {
    const normalized = normalizeRecord(record)
    this.deindex(record.settlementId)
    this.records.set(normalized.settlementId, normalized)
    this.index(normalized)
    return normalized
  }

  recordUpdate(update: SettlementUpdate): SettlementRecord | null {
    const existing = this.findMatchingRecord(update)

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
      return created
    }

    this.deindex(existing.settlementId)
    const merged = normalizeRecord({
      ...existing,
      ...update,
      settlementId: existing.settlementId,
      correlationId: update.correlationId ?? existing.correlationId,
      adapter: update.adapter ?? existing.adapter,
      status: update.status ?? existing.status,
      timestamp: update.timestamp ?? Date.now(),
      canonicalSettlement: update.canonicalSettlement === undefined
        ? existing.canonicalSettlement
        : update.canonicalSettlement,
    })
    this.records.set(merged.settlementId, merged)
    this.index(merged)
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
    if (update.txHash) {
      const byTx = this.findByTxHash(update.txHash)
      if (byTx) return byTx
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
    if (record.txHash) this.byTxHash.set(record.txHash, record.settlementId)
  }

  private deindex(settlementId: string): void {
    const record = this.records.get(settlementId)
    if (!record) return
    this.byCorrelationId.delete(record.correlationId)
    if (record.ordemId) this.byOrdemId.delete(record.ordemId)
    if (record.txHash) this.byTxHash.delete(record.txHash)
  }
}
