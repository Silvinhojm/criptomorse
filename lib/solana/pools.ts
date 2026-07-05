import { SOLANA_CONFIG } from "./config"
import { solanaClient } from "./client"

export interface PoolInfo {
  label: string
  tokenA: string
  tokenB: string
  price: number | null
  volume24h: number | null
  tvl: number | null
}

export async function fetchPools(): Promise<PoolInfo[]> {
  const results: PoolInfo[] = []
  for (const pool of SOLANA_CONFIG.pools) {
    const a = SOLANA_CONFIG.tokens[pool.tokenA as keyof typeof SOLANA_CONFIG.tokens]
    const b = SOLANA_CONFIG.tokens[pool.tokenB as keyof typeof SOLANA_CONFIG.tokens]
    if (!a || !b) continue
    const price = await solanaClient.getTokenPrice(a.address, b.address)
    results.push({
      label: pool.label,
      tokenA: a.address,
      tokenB: b.address,
      price,
      volume24h: null,
      tvl: null,
    })
  }
  return results
}

export interface WalletSummary {
  sol: number
  usdc: number
  bp: number
}

export async function fetchWalletSummary(wallet: string): Promise<WalletSummary> {
  const [sol, usdc, bp] = await Promise.all([
    solanaClient.getBalance(wallet),
    solanaClient.getTokenBalance(wallet, SOLANA_CONFIG.tokens.USDC.address),
    solanaClient.getTokenBalance(wallet, SOLANA_CONFIG.tokens.BP.address),
  ])
  return { sol, usdc, bp }
}
