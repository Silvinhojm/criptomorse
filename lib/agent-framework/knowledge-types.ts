export interface KnowledgeRequest {
  pair: {
    from: string
    to: string
  }
  network: string
  action: "BUY" | "SELL"
  agent: string
  amount: bigint
}

export interface KnowledgeReport {
  canTrade: boolean
  reason?: string
  liquidity: number
  gasScore: number
  routeScore: number
  marketScore: number
  riskScore: number
  expectedValue: number
  confidenceModifier: number
  warnings: string[]
  recommendations: string[]
  gasContext?: {
    network: string
    gasPriceGwei: number
    nativePrice: number
    gasCostUsd: number
    fallbackUsed: boolean
  }
  sources: {
    liquidity: boolean
    route: boolean
    gas: boolean
    price: boolean
    history: boolean
    reputation: boolean
  }
  timestamp: number
}

export interface ResolvedKnowledgeContext {
  report?: KnowledgeReport
  canTrade: boolean
  modifier: number
  /** source identifies where the context came from; status identifies the operational resolution result. */
  source: "provided" | "queried" | "unavailable" | "failed"
  status: "provided" | "queried" | "unavailable" | "failed"
  warnings: string[]
  error?: string
}
