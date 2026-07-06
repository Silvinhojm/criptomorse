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
