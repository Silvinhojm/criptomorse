import { positionManager } from "./position-manager"
import { volatilityTracker } from "./volatility-tracker"
import { pregão } from "./pregão"
import {
  TRADING_PAIRS,
  type NetworkKey,
  type TokenSymbol,
  isStable,
} from "./real-swap-executor"
import type { QuantumPair } from "./quantum-wave"

// ── Configurações do Grid Adaptativo ──
const MAX_GRID_LEVELS = 15
const RED_LINE_MULTIPLIER = 2.2
const ADAPT_THRESHOLD = 0.6
const ADAPT_SPEED = 0.12
const JUMP_COOLDOWN_MS = 180000
const STORAGE_KEY = "arcflow_adaptive_grid_state"
const PERF_KEY = "arcflow_grid_performance"
const GAS_ESTIMATE_GRID: Record<string, number> = { polygon: 0.005, base: 0.003, arc: 0.001, ethereum: 0.50, arbitrum: 0.01 }
const SPREAD_PCT = 0.005

export interface GridTradeRecord {
  token: TokenSymbol
  direction: "buy" | "sell"
  amount: number
  triggerPrice: number
  exitPrice: number
  grossProfit: number
  gasCost: number
  netProfit: number
  timestamp: number
  network: NetworkKey
}

export interface GridPerformanceSummary {
  totalTrades: number
  grossProfit: number
  gasCost: number
  netProfit: number
  winRate: number
  wins: number
  losses: number
  perToken: Record<string, { trades: number; netProfit: number }>
  lastTradeAt: number | null
}

const MIN_NET_PROFIT_PER_TRADE = 0.001

// Spacing por volatilidade (vol1h)
function getSpacing(vol1h: number): number {
  if (vol1h < 0.003) return 0.0025
  if (vol1h < 0.005) return 0.003
  if (vol1h < 0.01) return 0.005
  if (vol1h < 0.02) return 0.008
  if (vol1h < 0.04) return 0.012
  return 0.015
}

function spacingMinimoLucrativo(amount: number, gasCost: number, spreadPct: number): number {
  const custoTotal = gasCost + amount * spreadPct + MIN_NET_PROFIT_PER_TRADE
  return Math.max(0.003, custoTotal / amount)
}

interface GridLevel {
  id: string
  token: TokenSymbol
  direction: "buy" | "sell"
  triggerPrice: number
  amount: number
  pairLabel: string
  pairFrom: TokenSymbol
  pairTo: TokenSymbol
  status: "pending" | "executed" | "completed"
  createdAt: number
  executedAt?: number
}

interface AdaptiveGridState {
  token: TokenSymbol
  network: NetworkKey
  levels: GridLevel[]
  centerPrice: number
  spacing: number
  lastInitPrice: number
  createdAt: number
  lastJumpAt: number
  adaptCount: number
  driftHistory: number[]
  waveBias: number
}

function loadState(): Record<string, AdaptiveGridState> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveState(state: Record<string, AdaptiveGridState>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

class AdaptiveGridTrading {
  private state: Record<string, AdaptiveGridState> = {}

  private key(token: TokenSymbol, network: NetworkKey): string {
    return `${network}:${token}`
  }

  async init(network: NetworkKey) {
    this.state = loadState()
    this.cleanStaleGrids(network)
    const pairs = TRADING_PAIRS[network] || []
    const volatileTokens = [
      ...new Set(pairs.flatMap(p => [p.from, p.to])),
    ].filter(t => !isStable(t))

    for (const token of volatileTokens) {
      const k = this.key(token, network)
      if (this.state[k]?.lastInitPrice > 0) continue

      const price = await positionManager.fetchTokenPrice(token)
      if (price <= 0) continue

      const volData = volatilityTracker.getVolatility(token)
      const gasEst = GAS_ESTIMATE_GRID[network] ?? 0.005
      const spacing = Math.max(getSpacing(volData.vol1h), spacingMinimoLucrativo(5, gasEst, SPREAD_PCT))
      const buyPair = pairs.find(p => isStable(p.from) && p.to === token)
      const sellPair = pairs.find(p => p.from === token && isStable(p.to))
      if (!buyPair || !sellPair) continue

      const levels = this.buildLevels(token, price, spacing, buyPair.label, buyPair.from, buyPair.to)

      this.state[k] = {
        token,
        network,
        levels,
        centerPrice: price,
        spacing,
        lastInitPrice: price,
        createdAt: Date.now(),
        lastJumpAt: Date.now(),
        adaptCount: 0,
        driftHistory: [],
        waveBias: 0,
      }

      pregão.adicionarLog(
        `📐 Grid Adaptativo ${token}: ${MAX_GRID_LEVELS} níveis, espaçamento ${(spacing * 100).toFixed(2)}%, centro $${price.toFixed(4)} (vol ${(volData.vol1h * 100).toFixed(2)}%)`
      )
    }
    saveState(this.state)
  }

  private buildLevels(
    token: TokenSymbol,
    center: number,
    spacing: number,
    pairLabel: string,
    pairFrom: TokenSymbol,
    pairTo: TokenSymbol,
  ): GridLevel[] {
    const levels: GridLevel[] = []
    const nPerSide = Math.floor(MAX_GRID_LEVELS / 2)
    const amount = 5

    for (let i = nPerSide; i >= 1; i--) {
      levels.push({
        id: `grid_buy_${token}_${i}_${Date.now()}`,
        token,
        direction: "buy",
        triggerPrice: center * (1 - spacing * i),
        amount,
        pairLabel,
        pairFrom,
        pairTo,
        status: "pending",
        createdAt: Date.now(),
      })
    }
    for (let i = 1; i <= nPerSide; i++) {
      levels.push({
        id: `grid_sell_${token}_${i}_${Date.now()}`,
        token,
        direction: "sell",
        triggerPrice: center * (1 + spacing * i),
        amount,
        pairLabel: `${token}→${pairFrom}`,
        pairFrom: token,
        pairTo: pairFrom,
        status: "pending",
        createdAt: Date.now(),
      })
    }

    return levels
  }

  private recenter(token: TokenSymbol, network: NetworkKey, newCenter: number) {
    const k = this.key(token, network)
    const g = this.state[k]
    if (!g) return

    const volData = volatilityTracker.getVolatility(token)
    const gasEst = GAS_ESTIMATE_GRID[network] ?? 0.005
    g.spacing = Math.max(getSpacing(volData.vol1h), spacingMinimoLucrativo(5, gasEst, SPREAD_PCT))
    g.centerPrice = newCenter

    const nPerSide = Math.floor(MAX_GRID_LEVELS / 2)
    const buyPair = TRADING_PAIRS[network]?.find(p => isStable(p.from) && p.to === token)
    const sellPair = TRADING_PAIRS[network]?.find(p => p.from === token && isStable(p.to))

    const freshLevels = this.buildLevels(
      token, newCenter, g.spacing,
      buyPair?.label ?? `${buyPair?.from}→${token}`,
      buyPair?.from ?? "USDC" as TokenSymbol,
      token,
    )

    // Preserva níveis executados da grid antiga que ainda têm posição aberta
    const executed = g.levels.filter(l => l.status === "executed")
    for (const ex of executed) {
      const pos = positionManager.getOpenPositions()
        .find(p => p.boughtToken === token && p.networkKey === network && p.status === "open")
      if (pos) {
        freshLevels.push(ex)
      }
    }

    g.levels = freshLevels
    g.adaptCount++
    saveState(this.state)

    pregão.adicionarLog(
      `🔄 Grid ${token} re-centralizado: $${newCenter.toFixed(4)} (escala ${(g.spacing * 100).toFixed(2)}%)`
    )
  }

  async checkLevels(network: NetworkKey): Promise<{ votes: GridLevel[] }> {
    this.cleanStaleGrids(network)
    const triggered: GridLevel[] = []

    for (const [k, g] of Object.entries(this.state)) {
      if (g.network !== network) continue

      const currentPrice = await positionManager
        .fetchTokenPrice(g.token)
        .catch(() => 0)
      if (currentPrice <= 0) continue

      // ── Drift: detecta se o preço está consistentemente de um lado ──
      const pos = currentPrice > g.centerPrice ? 1 : -1
      g.driftHistory.push(pos)
      if (g.driftHistory.length > 10) g.driftHistory.shift()

      const driftSum = g.driftHistory.reduce((s, v) => s + v, 0)
      const driftRatio = Math.abs(driftSum) / g.driftHistory.length
      const driftDir = driftSum > 0 ? 1 : -1

      if (driftRatio >= ADAPT_THRESHOLD && g.driftHistory.length >= 5) {
        const distance = currentPrice - g.centerPrice
        const driftAmount = distance * ADAPT_SPEED
        const newCenter = g.centerPrice + driftAmount * driftDir
        const prevCenter = g.centerPrice

        this.recenter(g.token, network, newCenter)
        g.driftHistory = []

        pregão.adicionarLog(
          `🧭 Grid ${g.token} derivou: centro $${prevCenter.toFixed(4)} → $${newCenter.toFixed(4)} (preço atual $${currentPrice.toFixed(4)})`
        )
      }

      // ── Red Line: preço escapou do grid ──
      const outerLevel = g.spacing * Math.floor(MAX_GRID_LEVELS / 2)
      const maxDist = Math.abs(currentPrice - g.centerPrice) / g.centerPrice
      const jumpThreshold = outerLevel * RED_LINE_MULTIPLIER

      if (maxDist > jumpThreshold && Date.now() - g.lastJumpAt > JUMP_COOLDOWN_MS) {
        const oldCenter = g.centerPrice
        g.lastJumpAt = Date.now()
        this.recenter(g.token, network, currentPrice)

        pregão.adicionarLog(
          `🔴 RED LINE ${g.token}: preço $${currentPrice.toFixed(4)} fugiu ${(maxDist * 100).toFixed(1)}% do centro $${oldCenter.toFixed(4)} (limite ${(jumpThreshold * 100).toFixed(1)}%) — pulando grid`
        )

        // Cria nível catch-up na direção do salto
        const catchUpLevel: GridLevel = {
          id: `${k}_catchup_${Date.now()}`,
          token: g.token,
          direction: driftDir > 0 ? "sell" : "buy",
          triggerPrice: currentPrice * (1 + driftDir * g.spacing * 0.5),
          amount: 5,
          pairLabel: driftDir > 0 ? `${g.token}→USDC` : `USDC→${g.token}`,
          pairFrom: driftDir > 0 ? g.token : "USDC" as TokenSymbol,
          pairTo: driftDir > 0 ? "USDC" as TokenSymbol : g.token,
          status: "pending",
          createdAt: Date.now(),
        }
        g.levels.push(catchUpLevel)
        pregão.adicionarLog(
          `🎯 Catch-up ${driftDir > 0 ? "VENDA" : "COMPRA"} ${g.token} @ $${catchUpLevel.triggerPrice.toFixed(4)}`
        )
      }

      // ── Checa níveis ──
      const openPositions = positionManager
        .getOpenPositions()
        .filter(p => p.networkKey === network && p.status === "open")

      for (const level of g.levels) {
        if (level.status !== "pending") continue

        const isBuy = level.direction === "buy"
        const tokenOpen = openPositions.filter(p => p.boughtToken === g.token).length
        if (isBuy && tokenOpen >= Math.floor(MAX_GRID_LEVELS / 2)) continue

        const hit = isBuy
          ? currentPrice <= level.triggerPrice
          : currentPrice >= level.triggerPrice

        if (hit) {
          level.status = "executed"
          level.executedAt = Date.now()
          triggered.push(level)

          pregão.adicionarLog(
            `📊 Grid ${isBuy ? "🟢 COMPRA" : "🔴 VENDA"} ${level.pairLabel} @ $${level.triggerPrice.toFixed(4)} (atual $${currentPrice.toFixed(4)})`
          )

          // 🔥 ENVIA OK DIRETO AO PREGÃO (pula pipeline de agentes)
          const gridConfidence = isBuy ? 80 : 85
          const dirLabel = isBuy ? "Compra" : "Venda"
          
          pregão.receberOK({
            pregueiro: `Grid:${dirLabel}`,
            rede: network,
            par: level.pairLabel,
            confianca: gridConfidence,
            timestamp: Date.now(),
            fromToken: level.pairFrom,
            toToken: level.pairTo,
          })
          
          pregão.adicionarLog(`📐 Grid OK enviado: ${level.pairLabel} (${gridConfidence}%)`)

          // Registra performance estimada (metade do round-trip por perna)
          const grossEst = level.amount * g.spacing * 0.5
          const gasEst = GAS_ESTIMATE_GRID[network] ?? 0.005
          const spreadEst = level.amount * SPREAD_PCT
          this.recordGridTrade({
            token: g.token,
            direction: isBuy ? "buy" : "sell",
            amount: level.amount,
            triggerPrice: level.triggerPrice,
            exitPrice: currentPrice,
            grossProfit: grossEst,
            gasCost: gasEst + spreadEst,
            netProfit: grossEst - gasEst - spreadEst,
            timestamp: Date.now(),
            network,
          })

          // Auto-rebalance: cria nível complementar
          const complement: GridLevel = {
            id: `${k}_${isBuy ? "sell" : "buy"}_re_${Date.now()}`,
            token: g.token,
            direction: isBuy ? "sell" : "buy",
            triggerPrice: currentPrice * (1 + (isBuy ? 1 : -1) * g.spacing * 1.5),
            amount: 5,
            pairLabel: isBuy ? `${g.token}→USDC` : `USDC→${g.token}`,
            pairFrom: isBuy ? g.token : "USDC" as TokenSymbol,
            pairTo: isBuy ? "USDC" as TokenSymbol : g.token,
            status: "pending",
            createdAt: Date.now(),
          }
          g.levels.push(complement)
          pregão.adicionarLog(
            `🔄 Rebalance: novo nível ${isBuy ? "VENDA" : "COMPRA"} ${g.token} @ $${complement.triggerPrice.toFixed(4)}`
          )
        }
      }
    }

    saveState(this.state)
    return { votes: triggered }
  }

  private isGridStale(g: AdaptiveGridState): boolean {
    const maxPendingAge = 24 * 60 * 60 * 1000
    const pending = g.levels.filter(l => l.status === "pending")
    if (pending.length === 0) return true
    const allOld = pending.every(l => Date.now() - l.createdAt > maxPendingAge)
    return allOld
  }

  private cleanStaleGrids(network: NetworkKey) {
    for (const [k, g] of Object.entries(this.state)) {
      if (g.network !== network) continue
      if (this.isGridStale(g)) {
        pregão.adicionarLog(`🧹 Grid ${g.token} obsoleto — reinicializando`)
        delete this.state[k]
      }
    }
    saveState(this.state)
  }

  onPositionClosed(boughtToken: TokenSymbol, profitPercent: number, network: NetworkKey) {
    if (profitPercent <= 0) return
    const k = this.key(boughtToken, network)
    const g = this.state[k]
    if (!g) return

    const filled = g.levels.filter(l => l.status === "executed").length
    if (filled >= MAX_GRID_LEVELS * 2) return

    const lastExec = g.levels
      .filter(l => l.status === "executed")
      .sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0))[0]

    const newAmount = lastExec?.amount ?? 5
    const buyPair = TRADING_PAIRS[network]?.find(p => isStable(p.from) && p.to === boughtToken)

    if (profitPercent > 0) {
      const buyLevel: GridLevel = {
        id: `${k}_buy_re_${Date.now()}`,
        token: boughtToken,
        direction: "buy",
        triggerPrice: g.centerPrice * (1 - g.spacing),
        amount: newAmount,
        pairLabel: buyPair?.label ?? `USDC→${boughtToken}`,
        pairFrom: buyPair?.from ?? "USDC" as TokenSymbol,
        pairTo: boughtToken,
        status: "pending",
        createdAt: Date.now(),
      }
      g.levels.push(buyLevel)
      pregão.adicionarLog(
        `🔄 Grid rebalance: nova COMPRA ${boughtToken} @ $${buyLevel.triggerPrice.toFixed(4)}`
      )
    }
    saveState(this.state)
  }

  getLevels(token: TokenSymbol, network: NetworkKey): GridLevel[] {
    return this.state[this.key(token, network)]?.levels ?? []
  }

  getGridInfo(token: TokenSymbol, network: NetworkKey) {
    const g = this.state[this.key(token, network)]
    if (!g) return null
    const executed = g.levels.filter(l => l.status === "executed").length
    const pending = g.levels.filter(l => l.status === "pending").length
    return {
      centerPrice: g.centerPrice,
      spacing: g.spacing,
      adaptCount: g.adaptCount,
      levelCount: g.levels.length,
      executedCount: executed,
      pendingCount: pending,
      age: Date.now() - g.createdAt,
      lastJumpAgo: Date.now() - g.lastJumpAt,
    }
  }

  // Status de saúde do grid para os agentes
  getGridHealth(token: TokenSymbol, network: NetworkKey): "active" | "jumped" | "stale" | "none" {
    const g = this.state[this.key(token, network)]
    if (!g) return "none"
    const jumpAgo = Date.now() - g.lastJumpAt
    const pending = g.levels.filter(l => l.status === "pending").length
    if (jumpAgo < 60000) return "jumped"
    if (pending === 0) return "stale"
    return "active"
  }

  getActiveTokens(network: NetworkKey): TokenSymbol[] {
    return Object.values(this.state)
      .filter(g => g.network === network)
      .map(g => g.token)
  }

  // Recebe dados da onda quântica para ajustar viés do grid
  setWaveData(wavePairs: QuantumPair[], network: NetworkKey) {
    for (const wp of wavePairs) {
      if (wp.network !== network) continue
      const volToken = !isStable(wp.toToken) ? wp.toToken : (!isStable(wp.fromToken) ? wp.fromToken : null)
      if (!volToken) continue
      const k = this.key(volToken as TokenSymbol, network)
      const g = this.state[k]
      if (!g) continue
      const newBias = Math.max(-0.005, Math.min(0.005, wp.momentum * 0.003))
      if (Math.abs(newBias - g.waveBias) > 0.001) {
        g.waveBias = newBias
        // Reforça a direção do grid com novos níveis conforme a onda
        if (Math.abs(newBias) > 0.002) {
          const extra: GridLevel = {
            id: `${k}_wave_${newBias > 0 ? "sell" : "buy"}_${Date.now()}`,
            token: g.token,
            direction: newBias > 0 ? "sell" : "buy",
            triggerPrice: g.centerPrice * (1 + newBias * (newBias > 0 ? 3 : -3)),
            amount: 5,
            pairLabel: newBias > 0 ? `${g.token}→USDC` : `USDC→${g.token}`,
            pairFrom: newBias > 0 ? g.token : "USDC" as TokenSymbol,
            pairTo: newBias > 0 ? "USDC" as TokenSymbol : g.token,
            status: "pending",
            createdAt: Date.now(),
          }
          g.levels.push(extra)
          pregão.adicionarLog(
            `🌊 Onda ${newBias > 0 ? "↗ SOBE" : "↘ DESCE"} ${g.token} (momentum ${wp.momentum.toFixed(2)}) — nível extra ${newBias > 0 ? "VENDA" : "COMPRA"} @ $${extra.triggerPrice.toFixed(4)}`
          )
        }
      }
    }
    saveState(this.state)
  }

  clear(token: TokenSymbol, network: NetworkKey) {
    delete this.state[this.key(token, network)]
    saveState(this.state)
  }

  // ── Performance Tracking ──

  private loadPerformance(): GridTradeRecord[] {
    if (typeof window === "undefined") return []
    try {
      return JSON.parse(localStorage.getItem(PERF_KEY) || "[]")
    } catch { return [] }
  }

  private savePerformance(trades: GridTradeRecord[]) {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem(PERF_KEY, JSON.stringify(trades.slice(-500)))
    } catch {}
  }

  recordGridTrade(record: GridTradeRecord) {
    const trades = this.loadPerformance()
    trades.push(record)
    this.savePerformance(trades)
  }

  getPerformance(): GridPerformanceSummary {
    const trades = this.loadPerformance()
    if (trades.length === 0) {
      return { totalTrades: 0, grossProfit: 0, gasCost: 0, netProfit: 0, winRate: 0, wins: 0, losses: 0, perToken: {}, lastTradeAt: null }
    }
    const wins = trades.filter(t => t.netProfit > 0).length
    const losses = trades.filter(t => t.netProfit <= 0).length
    const grossProfit = trades.reduce((s, t) => s + t.grossProfit, 0)
    const gasCost = trades.reduce((s, t) => s + t.gasCost, 0)
    const netProfit = trades.reduce((s, t) => s + t.netProfit, 0)
    const perToken: Record<string, { trades: number; netProfit: number }> = {}
    for (const t of trades) {
      if (!perToken[t.token]) perToken[t.token] = { trades: 0, netProfit: 0 }
      perToken[t.token].trades++
      perToken[t.token].netProfit += t.netProfit
    }
    return {
      totalTrades: trades.length,
      grossProfit,
      gasCost,
      netProfit,
      winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      wins,
      losses,
      perToken,
      lastTradeAt: trades[trades.length - 1]?.timestamp ?? null,
    }
  }

  getTradeHistory(limit = 20): GridTradeRecord[] {
    return this.loadPerformance().slice(-limit).reverse()
  }
}

export const gridTrader = new AdaptiveGridTrading()