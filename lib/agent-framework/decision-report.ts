export interface DecisionReport {
  id: string
  intentId: string
  agentId: string
  action: string
  params: Record<string, unknown>

  knowledge?: {
    liquidity: number
    gasScore: number
    routeScore: number
    marketScore: number
    riskScore: number
    expectedValue: number
    confidenceModifier: number
    warnings: string[]
    recommendations: string[]
    gasContext?: { network: string; gasPriceGwei: number; gasCostUsd: number; nativePrice: number; fallbackUsed: boolean }
  }

  voting?: {
    votes: { agentId: string; approved: boolean; confidence: number; reason: string }[]
    totalVoters: number
    approved: boolean
    confidence: number
    reason: string
    weightedConfidence: number
    minAgentsRequired: number
  }

  execution?: {
    success: boolean
    profit: number
    gasCost: number
    durationMs: number
    txHash?: string
    errorMsg?: string
    adapter: string
  }

  auditId?: string
  dedupSkipped?: boolean

  /** Hash on-chain da decisão (keccak256 do report JSON) */
  onChainHash?: string
  /** Tx hash da transação de âncora on-chain */
  onChainTx?: string
  /** Status da prova on-chain: pending | confirmed | failed | skipped */
  onChainStatus?: "pending" | "confirmed" | "failed" | "skipped"

  createdAt: number
  resolvedAt?: number
  durationMs?: number
}
