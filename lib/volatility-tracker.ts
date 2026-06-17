// lib/volatility-tracker.ts
// Aprende a volatilidade real de cada token ao longo do tempo e sugere
// parâmetros inteligentes: níveis de staircase, tamanho de posição, etc.
//
// Persiste em localStorage para acumular conhecimento entre sessões.
// A cada ciclo, coleta preço dos tokens e mantém histórico rolante.

import type { TokenSymbol } from "./real-swap-executor"

const VOLATILITY_KEY = "arcflow_volatility_data"
const MAX_PRICE_HISTORY = 288 // 24h a 5min entre coletas
const PRICE_CACHE_MS = 60_000 // coleta no máximo 1x por minuto por token

interface PriceRecord {
  price: number
  timestamp: number
}

interface TokenVolatility {
  prices: PriceRecord[]
  lastCollected: number
}

interface VolatilitySnapshot {
  vol1h: number  // desvio padrão dos retornos na última hora
  vol4h: number
  vol24h: number
  dataPoints: number
  trend: "rising" | "falling" | "stable" // direção da volatilidade recente
}

interface StoredData {
  tokens: Record<string, TokenVolatility>
  lastSave: number
}

// Conjuntos de níveis de lucro pré-definidos por faixa de volatilidade horária
// Quanto maior a volatilidade, mais largos os degraus — evita fechar no "respiro" natural do preço
const LEVEL_SETS: { maxVol: number; levels: number[] }[] = [
  { maxVol: 0.003, levels: [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 100] },     // < 0.3%: muito estável (stablecoins)
  { maxVol: 0.005, levels: [0, 1.5, 3, 4.5, 6, 8, 10, 15, 20, 30, 50, 100] },    // 0.3-0.5%
  { maxVol: 0.01,  levels: [0, 2, 4, 6, 8, 10, 15, 20, 30, 50, 100] },           // 0.5-1%
  { maxVol: 0.015, levels: [0, 3, 5, 7, 10, 15, 20, 30, 50, 100] },              // 1-1.5%
  { maxVol: 0.025, levels: [0, 4, 6, 8, 10, 15, 20, 30, 50, 100] },             // 1.5-2.5%
  { maxVol: 0.04,  levels: [0, 5, 8, 11, 15, 20, 30, 50, 100] },                // 2.5-4%
  { maxVol: Infinity, levels: [0, 7, 11, 15, 20, 30, 50, 100] },                 // > 4%: altíssima vol
]

// Cache de preço USD para não bater na API a cada token no mesmo ciclo
class TokenPriceFetcher {
  private cache: Map<string, { price: number; timestamp: number }> = new Map()

  async getPrice(token: TokenSymbol): Promise<number | null> {
    const cached = this.cache.get(token)
    if (cached && Date.now() - cached.timestamp < 15_000) return cached.price

    const coinId = COIN_IDS[token]
    if (!coinId) return null

    try {
      const res = await fetch(`/api/price?ids=${coinId}`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return cached?.price ?? null
      const data = await res.json()
      const price = data[coinId]
      if (typeof price === "number" && price > 0) {
        this.cache.set(token, { price, timestamp: Date.now() })
        return price
      }
      return cached?.price ?? null
    } catch {
      return cached?.price ?? null
    }
  }
}

const COIN_IDS: Record<string, string> = {
  WETH: "ethereum", WMATIC: "matic-network", WBTC: "bitcoin",
  USDC: "usd-coin", USDT: "tether", DAI: "dai", EURC: "eurc",
  ARB: "arbitrum", SOL: "solana", POL: "matic-network",
}

class VolatilityTracker {
  private tokens: Map<string, TokenVolatility> = new Map()
  private priceFetcher = new TokenPriceFetcher()
  private dirty = false

  constructor() {
    this.load()
  }

  // Coleta preço atual de um token e armazena no histórico
  async collectPrice(token: TokenSymbol): Promise<void> {
    const now = Date.now()
    const existing = this.tokens.get(token)

    if (existing && now - existing.lastCollected < PRICE_CACHE_MS) return

    const price = await this.priceFetcher.getPrice(token)
    if (price === null || price <= 0) return

    const records = existing?.prices ?? []
    records.push({ price, timestamp: now })
    if (records.length > MAX_PRICE_HISTORY) records.shift()

    this.tokens.set(token, { prices: records, lastCollected: now })
    this.dirty = true
  }

  // Coleta preços de múltiplos tokens em paralelo
  async collectPrices(tokens: TokenSymbol[]): Promise<void> {
    await Promise.all(tokens.map(t => this.collectPrice(t)))
    if (this.dirty) this.save()
  }

  // Retorna snapshot de volatilidade para um token
  getVolatility(token: TokenSymbol): VolatilitySnapshot {
    const data = this.tokens.get(token)
    if (!data || data.prices.length < 3) {
      return { vol1h: 0, vol4h: 0, vol24h: 0, dataPoints: data?.prices.length ?? 0, trend: "stable" }
    }

    const prices = data.prices
    const now = Date.now()

    const returns1h = this._returnsInWindow(prices, now, 60 * 60 * 1000)
    const returns4h = this._returnsInWindow(prices, now, 4 * 60 * 60 * 1000)
    const returns24h = this._returnsInWindow(prices, now, 24 * 60 * 60 * 1000)

    return {
      vol1h: this._stdDev(returns1h),
      vol4h: this._stdDev(returns4h),
      vol24h: this._stdDev(returns24h),
      dataPoints: prices.length,
      trend: this._calcTrend(prices),
    }
  }

  // Sugere níveis de staircase baseados na volatilidade 1h do token
  suggestLevels(token: TokenSymbol): number[] {
    const vol = this.getVolatility(token)

    // Sem dados suficientes: volta para o padrão
    if (vol.dataPoints < 3) return [0, 3, 5, 8, 10, 15, 20, 30, 50, 100]

    const v = vol.vol1h

    // Pega o conjunto de níveis correspondente à volatilidade
    for (const set of LEVEL_SETS) {
      if (v <= set.maxVol) return set.levels
    }
    return LEVEL_SETS[LEVEL_SETS.length - 1].levels
  }

  // Multiplicador de tamanho de posição (0.3 a 1.0)
  // Alta volatilidade → posição menor para gerenciar risco
  getPositionSizeMultiplier(token: TokenSymbol): number {
    const vol = this.getVolatility(token)

    if (vol.dataPoints < 3) return 1.0
    if (vol.vol1h < 0.005) return 1.0    // < 0.5%: risco baixo, posição cheia
    if (vol.vol1h < 0.015) return 0.8    // 0.5-1.5%: médio
    if (vol.vol1h < 0.03) return 0.6     // 1.5-3%: volátil
    return 0.3                            // > 3%: muito arriscado, posição pequena
  }

  // Multiplicador de confiança para agentes (0.5 a 1.2)
  // Se a volatilidade está subindo (incerteza), reduz confiança
  // Se está estável ou caindo, mantém ou aumenta
  getConfidenceMultiplier(token: TokenSymbol): number {
    const vol = this.getVolatility(token)
    if (vol.dataPoints < 3) return 1.0

    switch (vol.trend) {
      case "rising":  return 0.7  // vol subindo → incerteza → reduz confiança
      case "falling": return 1.1  // vol caindo → mais previsível → aumenta
      case "stable":  return 1.0
    }
  }

  // Retorna diagnóstico legível para debug
  getProfile(token: TokenSymbol): string {
    const vol = this.getVolatility(token)
    const levels = this.suggestLevels(token)
    return `${token}: vol1h=${(vol.vol1h * 100).toFixed(2)}% vol4h=${(vol.vol4h * 100).toFixed(2)}% vol24h=${(vol.vol24h * 100).toFixed(2)}% | ${vol.dataPoints}pts | tendência=${vol.trend} | níveis=${levels.length} degraus | posMulti=${this.getPositionSizeMultiplier(token).toFixed(1)} | confMulti=${this.getConfidenceMultiplier(token).toFixed(1)}`
  }

  // ─── Privado ───

  private _returnsInWindow(prices: PriceRecord[], now: number, windowMs: number): number[] {
    const cutoff = now - windowMs
    const inWindow = prices.filter(p => p.timestamp >= cutoff)
    if (inWindow.length < 3) return []

    const returns: number[] = []
    for (let i = 1; i < inWindow.length; i++) {
      const prev = inWindow[i - 1].price
      if (prev > 0) returns.push((inWindow[i].price - prev) / prev)
    }
    return returns
  }

  private _stdDev(returns: number[]): number {
    if (returns.length < 2) return 0
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1)
    return Math.sqrt(variance)
  }

  private _calcTrend(prices: PriceRecord[]): "rising" | "falling" | "stable" {
    if (prices.length < 10) return "stable"

    // Compara volatilidade recente (últimos 30% dos pontos) com o restante
    const split = Math.floor(prices.length * 0.7)
    const recent = prices.slice(split)
    const older = prices.slice(0, split)

    const recentReturns = this._returnsInWindow(recent, Date.now(), 24 * 60 * 60 * 1000)
    const olderReturns = this._returnsInWindow(older, Date.now(), 24 * 60 * 60 * 1000)

    const recentVol = this._stdDev(recentReturns)
    const olderVol = this._stdDev(olderReturns)

    if (olderVol === 0) return "stable"
    const ratio = recentVol / olderVol
    if (ratio > 1.3) return "rising"
    if (ratio < 0.7) return "falling"
    return "stable"
  }

  // ─── Persistência ───

  private load(): void {
    try {
      const raw = localStorage.getItem(VOLATILITY_KEY)
      if (!raw) return
      const data: StoredData = JSON.parse(raw)
      for (const [token, td] of Object.entries(data.tokens)) {
        this.tokens.set(token, td)
      }
    } catch { /* primeiro uso ou dados corrompidos */ }
  }

  private save(): void {
    try {
      const tokens: Record<string, TokenVolatility> = {}
      for (const [token, td] of this.tokens.entries()) {
        tokens[token] = td
      }
      const data: StoredData = { tokens, lastSave: Date.now() }
      localStorage.setItem(VOLATILITY_KEY, JSON.stringify(data))
      this.dirty = false
    } catch { /* localStorage cheio ou indisponível */ }
  }

  // Limpa dados antigos (> 48h) para não acumular
  cleanStale(): void {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000
    for (const [token, td] of this.tokens.entries()) {
      const valid = td.prices.filter(p => p.timestamp >= cutoff)
      if (valid.length === 0) {
        this.tokens.delete(token)
      } else if (valid.length !== td.prices.length) {
        this.tokens.set(token, { prices: valid, lastCollected: td.lastCollected })
      }
    }
    this.dirty = true
    this.save()
  }
}

export const volatilityTracker = new VolatilityTracker()
export type { VolatilitySnapshot }
