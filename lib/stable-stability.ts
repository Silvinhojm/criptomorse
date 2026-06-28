// lib/stable-stability.ts
// Detector de micro-movimentos em stablecoins (0.05%–0.15%)
// Usado pelos agentes para identificar janelas de lucro em pares S→S
//
// Estratégia: "grão em grão a galinha enche o papo"
// Spread 10× menor que voláteis, slippage 10× menor, movimentos previsíveis

import { realSwap, NETWORKS, TRADING_PAIRS, isStable, type NetworkKey, type TokenSymbol } from './real-swap-executor'
import { volatilityTracker } from './volatility-tracker'

const STABLES: Set<TokenSymbol> = new Set(["USDC", "USDT", "DAI", "EURC"])

export interface MicroTrend {
  pair: string           // "USDC→EURC"
  network: NetworkKey
  fromToken: string
  toToken: string
  currentPrice: number   // preço atual do toToken em USD
  price5m: number[]      // últimos 5 minutos (1 ponto/30s = 10 pontos)
  delta5m: number        // mudança % nos últimos 5min
  delta1m: number        // mudança % no último minuto
  trend: 'up' | 'down' | 'flat'
  amplitude: number      // amplitude máxima no período (%)
  viabilidade: number    // 0-100 — quão explorável é esse micro-movimento
  batchSugerido: number  // batch size recomendado ($)
  lucroEstimado: number  // lucro líquido estimado por batch ($)
}

interface PricePoint { price: number; timestamp: number }

const HISTORY_MS = 300_000 // 5 minutos
const SAMPLE_MS  = 10_000  // 1 amostra a cada 10s (micro-movimentos duram 10-15s)
const MAX_SAMPLES = HISTORY_MS / SAMPLE_MS // 30 amostras

class StableStability {
  private prices: Map<string, PricePoint[]> = new Map() // key: "network:fromToken→toToken"
  private lastReport: MicroTrend[] = []
  private lastReportTime = 0

  /** Coleta preço atual e atualiza histórico */
  async collect(network: NetworkKey, fromToken: string, toToken: string): Promise<void> {
    const key = `${network}:${fromToken}→${toToken}`
    if (!this.prices.has(key)) this.prices.set(key, [])

    try {
      const price = await realSwap.fetchTokenPrice(toToken as TokenSymbol).catch(() => 0)
      if (price <= 0) return

      const history = this.prices.get(key)!
      const now = Date.now()

      // Só adiciona se passou SAMPLE_MS desde a última
      const last = history[history.length - 1]
      if (last && now - last.timestamp < SAMPLE_MS) return

      history.push({ price, timestamp: now })

      // Mantém só os últimos MAX_SAMPLES
      while (history.length > MAX_SAMPLES) history.shift()
    } catch {}
  }

  /** Calcula micro-tendência para um par específico */
  analyze(network: NetworkKey, fromToken: string, toToken: string): MicroTrend | null {
    const key = `${network}:${fromToken}→${toToken}`
    const history = this.prices.get(key)
    if (!history || history.length < 3) return null

    const prices = history.map(p => p.price)
    const current = prices[prices.length - 1]
    const oldest = prices[0]
    const delta5m = (current - oldest) / oldest
    const price5m = prices.slice(-Math.min(10, prices.length))

    // Delta do último minuto (~2 amostras)
    const recentSlice = prices.slice(-2)
    const delta1m = recentSlice.length >= 2
      ? (recentSlice[1] - recentSlice[0]) / recentSlice[0]
      : delta5m

    const trend: 'up' | 'down' | 'flat' =
      delta5m > 0.0003 ? 'up' : delta5m < -0.0003 ? 'down' : 'flat'

    // Amplitude = (max - min) / min no período
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const amplitude = (maxPrice - minPrice) / minPrice

    // ── Cálculo de viabilidade ──
    const net = NETWORKS[network]
    if (!net) return null

    // Gas estimado na rede
    const GAS_COSTS: Record<string, number> = {
      polygon: 0.014, base: 0.006, arbitrum: 0.04, ethereum: 1.50, arc: 0.006, sepolia: 0.003,
    }
    const gasCost = GAS_COSTS[network] ?? 0.01
    const gasRoundTrip = gasCost * 2

    // Spread estimado para stablecoin pairs (~0.03-0.1%)
    // DEX (Uniswap V2): 0.3%, mas a profundidade em stables reduz impacto
    const spread = 0.0005 // 0.05% — pares stablecoin têm liquidez profunda

    // M_break mínimo = gas_round / (batch * (1 - 2*spread) - 1)
    // Simplificado: precisamos de amplitude > gas_round / batch + 2*spread
    // batch sugerido: suficiente pra amplitude pagar gas + spread
    const batchSugerido = Math.max(3, Math.ceil(gasRoundTrip / Math.max(0.0001, amplitude - 2 * spread)))
    const lucroEstimado = (batchSugerido * amplitude) - gasRoundTrip - (batchSugerido * spread * 2)

    // Viabilidade 0-100
    let viabilidade = 0
    if (amplitude > 0.0005 && lucroEstimado > 0) {
      // Base: amplitude presente e lucro positivo
      viabilidade = 30
      // +20 se trend é clara (não flat)
      if (trend !== 'flat') viabilidade += 20
      // +20 se delta recente acelera na direção da trend
      if ((trend === 'up' && delta1m > delta5m) || (trend === 'down' && delta1m < delta5m)) viabilidade += 20
      // +15 se lucro estimado > $0.02
      if (lucroEstimado > 0.02) viabilidade += 15
      // +15 se amplitude > 0.1% (movimento claro)
      if (amplitude > 0.001) viabilidade += 15
    } else if (amplitude > 0.0002) {
      // Margem: micro movimento mas ainda detectável
      viabilidade = 15
    }

    return {
      pair: `${fromToken}→${toToken}`,
      network,
      fromToken,
      toToken,
      currentPrice: current,
      price5m,
      delta5m: Math.round(delta5m * 1e6) / 1e4,  // exibe como %
      delta1m: Math.round(delta1m * 1e6) / 1e4,
      trend,
      amplitude: Math.round(amplitude * 1e6) / 1e4,
      viabilidade: Math.min(100, viabilidade),
      batchSugerido,
      lucroEstimado: Math.round(lucroEstimado * 10000) / 10000,
    }
  }

  /** Varredura completa — gera relatório para TODOS os pares stable→stable */
  async scanAll(): Promise<MicroTrend[]> {
    const now = Date.now()
    if (now - this.lastReportTime < 10_000) return this.lastReport

    const trends: MicroTrend[] = []

    for (const [networkKey, net] of Object.entries(NETWORKS)) {
      if ((net as any).isTestnet && networkKey !== 'arc') continue
      const pairs = (TRADING_PAIRS as any)[networkKey] || []
      for (const pair of pairs) {
        if (!STABLES.has(pair.from) || !STABLES.has(pair.to)) continue // só S→S
        if (pair.from === pair.to) continue

        await this.collect(networkKey as NetworkKey, pair.from, pair.to)
        const trend = this.analyze(networkKey as NetworkKey, pair.from, pair.to)
        if (trend) trends.push(trend)
      }
    }

    // Ordena por viabilidade (maior primeiro) e depois por lucro estimado
    trends.sort((a, b) => b.viabilidade - a.viabilidade || b.lucroEstimado - a.lucroEstimado)

    this.lastReport = trends
    this.lastReportTime = now
    return trends
  }

  /** Relatório JSON para agentes votarem */
  getAgentReport(): { timestamp: number; pairs: MicroTrend[] } {
    return {
      timestamp: this.lastReportTime,
      pairs: this.lastReport,
    }
  }

  /** Top N oportunidades */
  getTopOpportunities(n = 3): MicroTrend[] {
    return this.lastReport.filter(t => t.viabilidade >= 20).slice(0, n)
  }
}

export const stableStability = new StableStability()
