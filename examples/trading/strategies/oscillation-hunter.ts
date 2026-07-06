// lib/oscillation-hunter.ts → examples/trading/strategies/oscillation-hunter.ts
// Estratégia: "Event-Driven Micro-Scalping" em stablecoin pools

import { realSwap, isStable, type NetworkKey, type TokenSymbol } from '../../../lib/real-swap-executor'
import { gasPriceOracle } from '../../../lib/gas-price-oracle'
import { capitalController } from '../../../lib/capital-controller'
import { getTopPools, type PoolInfo } from '../../../lib/pool-finder'

export interface TargetPool {
  network: NetworkKey
  fromToken: string
  toToken: string
  poolAddress: string
  feeTier: number
  tvlEstimate: number
  minDeviation: number
  targetProfit: number
  stopLoss: number
  dex?: string
}

const FALLBACK_POOLS: TargetPool[] = [
  { network: 'polygon', fromToken: 'USDC', toToken: 'USDT', poolAddress: '', feeTier: 0.0001, tvlEstimate: 2000000, minDeviation: 0.0015, targetProfit: 0.0012, stopLoss: -0.0010, dex: 'fallback' },
  { network: 'polygon', fromToken: 'USDC', toToken: 'DAI', poolAddress: '', feeTier: 0.0005, tvlEstimate: 1500000, minDeviation: 0.0020, targetProfit: 0.0015, stopLoss: -0.0015, dex: 'fallback' },
  { network: 'base', fromToken: 'USDC', toToken: 'DAI', poolAddress: '', feeTier: 0.0005, tvlEstimate: 800000, minDeviation: 0.0015, targetProfit: 0.0012, stopLoss: -0.0010, dex: 'fallback' },
  { network: 'polygon', fromToken: 'USDC', toToken: 'EURC', poolAddress: '', feeTier: 0.003, tvlEstimate: 500000, minDeviation: 0.0060, targetProfit: 0.0040, stopLoss: -0.0030, dex: 'fallback' },
  { network: 'arbitrum', fromToken: 'USDC', toToken: 'USDT', poolAddress: '', feeTier: 0.0001, tvlEstimate: 1000000, minDeviation: 0.0015, targetProfit: 0.0012, stopLoss: -0.0010, dex: 'fallback' },
  { network: 'arbitrum', fromToken: 'USDC', toToken: 'DAI', poolAddress: '', feeTier: 0.0005, tvlEstimate: 500000, minDeviation: 0.0020, targetProfit: 0.0015, stopLoss: -0.0015, dex: 'fallback' },
]

let TARGET_POOLS: TargetPool[] = [...FALLBACK_POOLS]

interface HuntPosition {
  pool: TargetPool
  entryPrice: number
  fairPrice: number
  deviation: number
  amountUSD: number
  amountOut: number
  entryTime: number
  targetPrice: number
  stopPrice: number
  status: 'open' | 'closed_win' | 'closed_loss'
}

interface HuntState {
  ativo: boolean
  positions: HuntPosition[]
  totalTrades: number
  wins: number
  losses: number
  totalProfitUSD: number
  lastScan: number
  lastSignal: string
  lastError: string | null
}

interface OscillationSignal {
  pool: TargetPool
  currentPrice: number
  fairPrice: number
  deviation: number
  direction: 'buy' | 'sell'
  batchSize: number
  estimatedProfit: number
  confidence: number
  timestamp: number
}

class OscillationHunter {
  private _ativo = false
  private _positions: HuntPosition[] = []
  private _totalTrades = 0
  private _wins = 0
  private _losses = 0
  private _totalProfitUSD = 0
  private _lastScan = 0
  private _lastSignal = ''
  private _lastError: string | null = null
  private _executando = false
  private _priceHistory: Map<string, number[]> = new Map()
  private _cycleCount = 0

  private listeners: Array<() => void> = []

  getState(): HuntState {
    return {
      ativo: this._ativo,
      positions: [...this._positions],
      totalTrades: this._totalTrades,
      wins: this._wins,
      losses: this._losses,
      totalProfitUSD: Math.round(this._totalProfitUSD * 100) / 100,
      lastScan: this._lastScan,
      lastSignal: this._lastSignal,
      lastError: this._lastError,
    }
  }

  onChange(cb: () => void) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(c => c !== cb) } }
  private notify() { for (const cb of this.listeners) cb() }

  start() {
    this._ativo = true
    this._lastError = null
    this._initializePools()
    this.loop()
    this.notify()
  }

  stop() {
    this._ativo = false
    this.notify()
  }

  private async _initializePools() {
    try {
      const pools = await getTopPools('polygon')
      if (pools.length > 0) {
        const converted: TargetPool[] = pools
          .filter((p: PoolInfo) => p.score >= 30)
          .map((p: PoolInfo) => ({
            network: 'polygon' as NetworkKey,
            fromToken: p.token0,
            toToken: p.token1,
            poolAddress: p.address,
            feeTier: p.fee || 0.003,
            tvlEstimate: p.tvlUSD,
            minDeviation: 0.002,
            targetProfit: 0.0015,
            stopLoss: -0.0010,
            dex: p.dex,
          }))
        converted.sort((a, b) => a.feeTier - b.feeTier)
        TARGET_POOLS = converted.slice(0, 10)
        console.log(`[OscillationHunter] ${TARGET_POOLS.length} pools reais carregadas:`,
          TARGET_POOLS.map(p => `${p.fromToken}/${p.toToken} (${p.dex} fee ${(p.feeTier*100).toFixed(2)}%)`).join(', '))
      }
    } catch (e) {
      console.warn(`[OscillationHunter] Pool Finder falhou, usando fallback (${FALLBACK_POOLS.length} pools)`)
      TARGET_POOLS = [...FALLBACK_POOLS]
    }
  }

  private async loop() {
    while (this._ativo) {
      try {
        await this.scanOscillations()
        this._lastError = null
      } catch (err: any) {
        this._lastError = err.message?.slice(0, 200)
      }
      this.notify()
      await new Promise(r => setTimeout(r, 10_000))
    }
  }

  private async scanOscillations() {
    if (this._executando) return
    this._executando = true
    this._cycleCount++

    try {
      await this.checkPositions()

      const signals: OscillationSignal[] = []
      const netKey = realSwap.getNetworkKey() as NetworkKey
      const gasCost = await gasPriceOracle.getGasCost(netKey).catch(() => 0.014)

      for (const pool of TARGET_POOLS) {
        if (pool.network !== netKey) continue
        if (this._positions.some(p => p.pool === pool && p.status === 'open')) continue

        const currentPrice = await realSwap.fetchTokenPrice(pool.toToken as TokenSymbol).catch(() => 0)
        if (currentPrice <= 0) continue

        const key = `${pool.network}:${pool.fromToken}→${pool.toToken}`
        if (!this._priceHistory.has(key)) this._priceHistory.set(key, [])
        const history = this._priceHistory.get(key)!
        history.push(currentPrice)
        if (history.length > 12) history.shift()

        if (history.length < 4) continue

        const sma = history.reduce((a, b) => a + b, 0) / history.length
        const deviation = (currentPrice - sma) / sma

        if (Math.abs(deviation) < pool.minDeviation) continue

        const recentTrend = history.length >= 2
          ? history[history.length - 1] - history[history.length - 2]
          : 0
        const isReversing = (deviation < 0 && recentTrend > 0) || (deviation > 0 && recentTrend < 0)
        if (!isReversing) continue

        const batchSize = Math.min(100, Math.max(5, Math.floor(pool.tvlEstimate * 0.00005)))
        const gasRT = gasCost * 2
        const feeRT = batchSize * pool.feeTier * 2
        const custoTotal = gasRT + feeRT
        const lucroEstimado = batchSize * pool.targetProfit - custoTotal
        const isStablePair = isStable(pool.fromToken as TokenSymbol) && isStable(pool.toToken as TokenSymbol)
        if (lucroEstimado < (isStablePair ? 0.002 : 0.005)) continue

        const direction = deviation < 0 ? 'buy' : 'sell'
        const confidence = Math.min(90, Math.round(40 + Math.abs(deviation) * 2500))

        signals.push({
          pool, currentPrice, fairPrice: sma, deviation, direction, batchSize,
          estimatedProfit: Math.round(lucroEstimado * 10000) / 10000,
          confidence, timestamp: Date.now(),
        })
      }

      signals.sort((a, b) => b.estimatedProfit - a.estimatedProfit)

      if (signals.length > 0) {
        const best = signals[0]
        this._lastSignal = `🎯 ${best.pool.toToken} desvio ${(best.deviation*100).toFixed(2)}% → ` +
          `$${best.batchSize} lucro $${best.estimatedProfit.toFixed(3)} (conf ${best.confidence})`
        console.log(`[Oscar] ${this._lastSignal}`)
        if (best.confidence >= 45) {
          await this.executeEntry(best)
        }
      }

      this._lastScan = Date.now()
    } finally {
      this._executando = false
    }
  }

  private async executeEntry(signal: OscillationSignal) {
    const requestId = `osc:${signal.pool.toToken}:${signal.deviation.toFixed(4)}`
    const approval = capitalController.request({
      id: requestId, strategy: 'oscillation',
      pair: `${signal.pool.fromToken}→${signal.pool.toToken}`,
      network: signal.pool.network,
      amountUSD: signal.batchSize, score: signal.confidence,
      estimatedProfit: signal.estimatedProfit, requestedAt: Date.now(),
    })
    if (!approval.authorized) {
      console.log(`[Oscar] ⏳ Aguardando: ${approval.reason}`)
      return
    }
    const log = (msg: string) => console.log(`[Oscar] ${msg}`)
    log(`Entrando: ${signal.direction} ${signal.pool.toToken} $${signal.batchSize} desvio ${(signal.deviation*100).toFixed(2)}%`)

    let result
    if (signal.direction === 'buy') {
      result = await realSwap.executeSwap(
        signal.pool.fromToken as TokenSymbol,
        signal.pool.toToken as TokenSymbol,
        signal.batchSize,
        (m) => log(m),
      )
    } else {
      result = await realSwap.executeSwap(
        signal.pool.toToken as TokenSymbol,
        signal.pool.fromToken as TokenSymbol,
        signal.batchSize * signal.fairPrice,
        (m) => log(m),
      )
    }

    if (result.success && result.toAmount > 0) {
      this._positions.push({
        pool: signal.pool,
        entryPrice: signal.currentPrice,
        fairPrice: signal.fairPrice,
        deviation: signal.deviation,
        amountUSD: signal.batchSize,
        amountOut: result.toAmount,
        entryTime: Date.now(),
        targetPrice: signal.currentPrice * (1 + signal.pool.targetProfit),
        stopPrice: signal.currentPrice * (1 + signal.pool.stopLoss),
        status: 'open',
      })
      this._totalTrades++
      log(`✅ Posição aberta: ${signal.pool.toToken} @ $${signal.currentPrice.toFixed(4)}`)
    } else {
      log(`❌ Falha na entrada: ${result.message}`)
    }
  }

  private async checkPositions() {
    for (const pos of this._positions) {
      if (pos.status !== 'open') continue

      const currentPrice = await this.getPrice(pos.pool.toToken).catch(() => 0)
      if (currentPrice <= 0) continue

      const isStablePair = isStable(pos.pool.fromToken as TokenSymbol) && isStable(pos.pool.toToken as TokenSymbol)

      if (!isStablePair && currentPrice <= pos.stopPrice) {
        await this.closePosition(pos, currentPrice)
      } else if (currentPrice >= pos.targetPrice) {
        await this.closePosition(pos, currentPrice)
      }

      const timeout = isStablePair ? 300_000 : 180_000
      if (Date.now() - pos.entryTime > timeout) {
        console.log(`[Oscar] ⏰ Timeout ${pos.pool.toToken} — fechando a mercado`)
        await this.closePosition(pos, currentPrice)
      }
    }
  }

  private async closePosition(pos: HuntPosition, currentPrice: number) {
    const isWin = currentPrice >= pos.targetPrice
    const log = (msg: string) => console.log(`[Oscar] ${msg}`)

    log(`${isWin ? '🎯' : '🛑'} Fechando ${pos.pool.toToken} @ $${currentPrice.toFixed(4)}`)
    const sellValue = pos.amountOut * currentPrice

    const result = await realSwap.executeSwap(
      pos.pool.toToken as TokenSymbol,
      pos.pool.fromToken as TokenSymbol,
      Math.round(sellValue * 100) / 100,
      (m) => log(m),
    )

    pos.status = isWin ? 'closed_win' : 'closed_loss'
    const profit = result.success ? result.toAmount - pos.amountUSD : -pos.amountUSD * pos.pool.targetProfit
    this._totalProfitUSD += profit
    if (profit > 0) this._wins++
    else this._losses++

    capitalController.unlock(pos.pool.toToken + ':' + pos.pool.network)
    this._lastSignal = `${isWin ? '🎯' : '🛑'} ${pos.pool.toToken}: $${profit.toFixed(3)} (${this._wins}W/${this._losses}L)`
  }

  private async getPrice(token: string): Promise<number> {
    try {
      return await realSwap.fetchTokenPrice(token as TokenSymbol).catch(() => 1)
    } catch {
      return 1.0
    }
  }
}

export const oscillationHunter = new OscillationHunter()
export type { HuntState, OscillationSignal, HuntPosition }
