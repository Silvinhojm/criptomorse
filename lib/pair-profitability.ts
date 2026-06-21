import { TRADING_PAIRS, type NetworkKey } from './real-swap-executor'

interface PairStats {
  profitSum: number
  tradeCount: number
  winRate: number
  avgProfit: number
  lastTradeAt: number
}

export class PairProfitability {
  private ranking: Map<string, PairStats> = new Map()
  private readonly STORAGE_KEY = 'arcflow_pair_profitability'
  
  constructor() {
    this.load()
  }

  recordTrade(pair: string, profit: number, win: boolean) {
    const data = this.ranking.get(pair) || {
      profitSum: 0,
      tradeCount: 0,
      winRate: 0,
      avgProfit: 0,
      lastTradeAt: 0
    }
    
    data.profitSum += profit
    data.tradeCount++
    data.winRate = (data.winRate * (data.tradeCount - 1) + (win ? 1 : 0)) / data.tradeCount
    data.avgProfit = data.profitSum / data.tradeCount
    data.lastTradeAt = Date.now()
    
    this.ranking.set(pair, data)
    this.save()
  }

  getTopPairs(limit: number = 5): string[] {
    return [...this.ranking.entries()]
      .filter(([_, d]) => d.tradeCount >= 3)
      .sort((a, b) => b[1].avgProfit - a[1].avgProfit)
      .slice(0, limit)
      .map(([pair]) => pair)
  }

  getPairsForAnalysis(network: NetworkKey): string[] {
    const pairsDaRede = TRADING_PAIRS[network]
    if (!pairsDaRede) return []

    const top = this.getTopPairs(5).filter(p => pairsDaRede.some(pr => pr.label === p))
    if (top.length > 0) return top

    return pairsDaRede.map(p => p.label)
  }

  private save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(Object.fromEntries(this.ranking)))
    } catch (e) {
      console.warn('Failed to save pair profitability:', e)
    }
  }

  private load() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY)
      if (data) {
        this.ranking = new Map(Object.entries(JSON.parse(data)))
      }
    } catch (e) {
      console.warn('Failed to load pair profitability:', e)
    }
  }
}

export const pairProfitability = new PairProfitability()