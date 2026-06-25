// Modo Grão — Microtrade system (WETH/USDC on Base)
// AND gate: MeanReversion + MarketMaker must agree within 30s
// Target: $0.02, Stop: -$0.02 (1:1)
// Batch: executes when 3+ signals accumulate

import { realSwap } from './real-swap-executor'
import { volatilityTracker } from './volatility-tracker'

interface PendingSignal {
  action: 'buy'
  agentName: string
  confidence: number
  timestamp: number
}

interface GranPosition {
  id: string
  boughtToken: string
  paidToken: string
  amountBought: number
  amountPaid: number
  entryPrice: number
  entryTimestamp: number
  targetPrice: number
  stopPrice: number
  status: 'open' | 'closed' | 'stopped'
  closePrice?: number
  closeTimestamp?: number
  profitUSD?: number
}

export interface ModoGraoState {
  ativo: boolean
  openPositions: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalProfitUSD: number
  cycleCount: number
  lastSignal: string
  pendingSignals: number
  lastError: string | null
}

const CONFIG = {
  network: 'base' as const,
  fromToken: 'USDC',
  toToken: 'WETH',
  tradeAmountUSD: 3,
  targetUSD: 0.02,
  stopUSD: -0.02,
  maxPositions: 5,
  cycleMs: 30_000,
  andGateTimeoutMs: 30_000,
  minConfidence: 50,
  minVolatility2h: 0.003,
  minAmplitude: 0.005,
  minSpread: 0.001,
}

class ModoGrao {
  private _ativo = false
  private _openPositions: GranPosition[] = []
  private _pendingSignals: PendingSignal[] = []
  private _totalTrades = 0
  private _wins = 0
  private _losses = 0
  private _totalProfitUSD = 0
  private _cycleCount = 0
  private _lastSignal = ''
  private _lastError: string | null = null
  private _executando = false

  private listeners: Array<() => void> = []

  getState(): ModoGraoState {
    const total = this._wins + this._losses
    return {
      ativo: this._ativo,
      openPositions: this._openPositions.filter(p => p.status === 'open').length,
      totalTrades: this._totalTrades,
      wins: this._wins,
      losses: this._losses,
      winRate: total > 0 ? Math.round((this._wins / total) * 100) : 0,
      totalProfitUSD: Math.round(this._totalProfitUSD * 100) / 100,
      cycleCount: this._cycleCount,
      lastSignal: this._lastSignal,
      pendingSignals: this._pendingSignals.length,
      lastError: this._lastError,
    }
  }

  onChange(cb: () => void) {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(c => c !== cb) }
  }

  private notify() {
    for (const cb of this.listeners) cb()
  }

  start() {
    if (this._ativo) return
    this._ativo = true
    this._lastError = null
    this.notify()
    this.loop()
  }

  stop() {
    this._ativo = false
    this.notify()
  }

  private async loop() {
    while (this._ativo) {
      const start = Date.now()
      try {
        await this.ciclo()
        this._lastError = null
      } catch (err: any) {
        this._lastError = err.message?.slice(0, 200) ?? 'Erro desconhecido'
        console.error(`[ModoGrão] ❌ ${this._lastError}`)
      }
      this.notify()
      const elapsed = Date.now() - start
      await new Promise(r => setTimeout(r, Math.max(5_000, CONFIG.cycleMs - elapsed)))
    }
  }

  private async ciclo() {
    this._cycleCount++
    const now = Date.now()

    // 1. Prices + volatility
    await Promise.all([
      volatilityTracker.collectPrice(CONFIG.fromToken as any),
      volatilityTracker.collectPrice(CONFIG.toToken as any),
    ])
    const [fromPrice, toPrice] = await Promise.all([
      realSwap.fetchTokenPrice(CONFIG.fromToken as any).catch(() => 1),
      realSwap.fetchTokenPrice(CONFIG.toToken as any).catch(() => 0),
    ])
    if (toPrice <= 0) return

    const vol = volatilityTracker.getVolatility(CONFIG.toToken as any)

    // 2. Check positions (stop/target)
    await this.checkPositions(toPrice)
    if (!this._ativo) return

    // 3. Volatility filter
    if (vol.vol24h < CONFIG.minVolatility2h) {
      this.cleanStaleSignals(now)
      return
    }

    // 4. Clean stale signals
    this.cleanStaleSignals(now)

    // 5. MeanReversion evaluation
    const amplitude = vol.vol24h
    if (amplitude >= CONFIG.minAmplitude && this._openPositions.filter(p => p.status === 'open').length < CONFIG.maxPositions) {
      const mrConfidence = Math.min(80, Math.round(30 + amplitude * 600))
      if (mrConfidence >= CONFIG.minConfidence) {
        const mmSignal = this._pendingSignals.find(s => s.agentName === 'MarketMaker')
        if (mmSignal) {
          this._pendingSignals = this._pendingSignals.filter(s => s !== mmSignal)
          this._lastSignal = `AND gate (MR=${mrConfidence} + MM=${mmSignal.confidence})`
          await this.executarCompra()
        } else {
          this._pendingSignals.push({ action: 'buy', agentName: 'MeanReversion', confidence: mrConfidence, timestamp: now })
        }
      }
    }

    // 6. MarketMaker evaluation
    const spreadPct = fromPrice > 0 ? Math.abs(toPrice - fromPrice) / fromPrice : 0
    if (spreadPct >= CONFIG.minSpread && this._openPositions.filter(p => p.status === 'open').length < CONFIG.maxPositions) {
      const mmConfidence = Math.min(70, Math.round(40 + spreadPct * 20))
      if (mmConfidence >= CONFIG.minConfidence) {
        const mrSignal = this._pendingSignals.find(s => s.agentName === 'MeanReversion')
        if (mrSignal) {
          this._pendingSignals = this._pendingSignals.filter(s => s !== mrSignal)
          this._lastSignal = `AND gate (MM=${mmConfidence} + MR=${mrSignal.confidence})`
          await this.executarCompra()
        } else {
          this._pendingSignals.push({ action: 'buy', agentName: 'MarketMaker', confidence: mmConfidence, timestamp: now })
        }
      }
    }
  }

  private cleanStaleSignals(now: number) {
    const before = this._pendingSignals.length
    this._pendingSignals = this._pendingSignals.filter(s => now - s.timestamp < CONFIG.andGateTimeoutMs)
  }

  private async executarCompra() {
    if (this._executando) return
    this._executando = true
    try {
      const result = await realSwap.executeSwap(
        CONFIG.fromToken as any,
        CONFIG.toToken as any,
        CONFIG.tradeAmountUSD,
      )
      if (result.success && result.toAmount > 0) {
        const entryPrice = result.fromAmount / result.toAmount
        const wethBought = result.toAmount
        const targetPrice = (CONFIG.tradeAmountUSD + CONFIG.targetUSD) / wethBought
        const stopPrice = (CONFIG.tradeAmountUSD + CONFIG.stopUSD) / wethBought

        this._openPositions.push({
          id: `grão-${Date.now()}`,
          boughtToken: CONFIG.toToken,
          paidToken: CONFIG.fromToken,
          amountBought: wethBought,
          amountPaid: result.fromAmount,
          entryPrice,
          entryTimestamp: Date.now(),
          targetPrice,
          stopPrice,
          status: 'open',
        })
        this._totalTrades++
        this._lastSignal = `Compra $${CONFIG.tradeAmountUSD} ${CONFIG.toToken} @ entry $${entryPrice.toFixed(2)}`
      } else {
        this._lastError = `Falha compra: ${result.message}`
      }
    } catch (err: any) {
      this._lastError = err.message?.slice(0, 200)
    } finally {
      this._executando = false
    }
  }

  private async checkPositions(currentPrice: number) {
    for (const pos of this._openPositions) {
      if (pos.status !== 'open') continue

      if (currentPrice >= pos.targetPrice) {
        await this.fecharPosicao(pos, currentPrice, 'target')
      } else if (currentPrice <= pos.stopPrice) {
        await this.fecharPosicao(pos, currentPrice, 'stop')
      }
    }
  }

  private async fecharPosicao(pos: GranPosition, currentPrice: number, reason: string) {
    const currentValue = pos.amountBought * currentPrice
    const result = await realSwap.executeSwap(
      pos.boughtToken as any,
      pos.paidToken as any,
      Math.round(currentValue * 100) / 100,
    )

    pos.status = reason === 'target' ? 'closed' : 'stopped'
    pos.closePrice = currentPrice
    pos.closeTimestamp = Date.now()
    pos.profitUSD = result.success ? Math.round((result.toAmount - pos.amountPaid) * 100) / 100 : 0

    if (pos.profitUSD >= 0) this._wins++
    else this._losses++
    this._totalProfitUSD += pos.profitUSD
    this._lastSignal = `${reason === 'target' ? '🎯' : '🛑'} #${pos.id}: $${pos.profitUSD.toFixed(2)}`
  }
}

export const modoGrao = new ModoGrao()
