export type RejectionStage =
  | "intake"
  | "knowledge"
  | "pre_vote_policy"
  | "voting"
  | "capability"
  | "pre_exec_policy"
  | "execution_guard"

export type RejectedBy =
  | "safety_guard"
  | "deduplicator"
  | "knowledge"
  | "policy"
  | "voting"
  | "coordinator"
  | "executor"

export type RejectionCode =
  | "SAFETY_GUARD_OPEN"
  | "DUPLICATE_INTENT"
  | "KNOWLEDGE_CAN_TRADE_FALSE"
  | "PRE_VOTE_POLICY_REJECTED"
  | "VOTING_REJECTED"
  | "NO_EXECUTOR"
  | "PRE_EXEC_POLICY_REJECTED"
  | "EXECUTOR_CAN_EXECUTE_FALSE"

export interface RejectionMetadata {
  rejectedBy: RejectedBy
  rejectionCode: RejectionCode
  rejectionStage: RejectionStage
  rejectionReason: string
  sourcePath: "submitProposal" | "runCycle"
  occurredAt: number
}

export interface DecisionReport {
  id: string
  intentId: string
  agentId: string
  action: string
  params: Record<string, unknown>

  knowledge?: {
    canTrade?: boolean
    source?: "provided" | "queried" | "unavailable" | "failed"
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
    correlationId?: string
    intentId?: string
    proposalId?: string
    decisionReportId?: string
    ordemId?: string
    dispatchStatus?: "dispatched" | "failed"
    settlementStatus?: "dispatched" | "submitted" | "confirmed" | "failed" | "settled" | "reconciled" | "synthetic"
    isProvisional?: boolean
    synthetic?: boolean
    canonicalSettlement?: boolean
    receiptStatus?: number
    blockNumber?: number
    gasUsed?: string
    effectiveGasPrice?: string
    gasCostNative?: string
    gasCostUsd?: number
    fromToken?: string
    toToken?: string
    amountIn?: string
    actualAmountOut?: string
    balanceDeltas?: Record<string, string>
    slippageBps?: number
  }

  auditId?: string
  dedupSkipped?: boolean

  /** Hash on-chain da decisão (keccak256 do report JSON) */
  onChainHash?: string
  /** Tx hash da transação de âncora on-chain */
  onChainTx?: string
  /** Status da prova on-chain: pending | confirmed | failed | skipped */
  onChainStatus?: "pending" | "confirmed" | "failed" | "skipped"

  /** Quem rejeitou a proposta (ex: "policy", "knowledge", "safety", "executor") */
  rejectedBy?: string

  /** Status da avaliação Knowledge: provided | queried | failed | unavailable */
  knowledgeStatus?: "provided" | "queried" | "failed" | "unavailable"
  /** Mensagem de erro quando knowledgeStatus = "failed" */
  knowledgeError?: string

  outcome?: "approved" | "rejected"
  rejection?: RejectionMetadata
  auditStatus?: "not_attempted" | "recorded" | "write_failed"

  createdAt: number
  resolvedAt?: number
  durationMs?: number
}
