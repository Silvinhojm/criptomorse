// Modo Grão — Microtrade batch system
// Batching: acumula sinais MR + MM e executa swap único maior
// Robô Ajustador: recalcula thresholds a cada ciclo (gas, vol, saldo)
// Target: cobre gas round-trip + margem dinâmica

import { realSwap, isArcStressMode, NETWORKS } from './real-swap-executor'
import { volatilityTracker } from './volatility-tracker'
import { gasPriceOracle } from './gas-price-oracle'

function getNetworkPair() {
  const net = realSwap.getNetworkKey() as string
  if (net === 'arc' || net === 'sepolia') return { fromToken: 'USDC', toToken: 'EURC' }
  return { fromToken: 'USDC', toToken: 'WETH' }
}

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
  testMode: boolean
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
  baseTradeUSD: 5,
  batchThreshold: 3,
  maxBatchAgeMs: 90_000,
  targetUSD: 0.05,
  stopUSD: -0.03,
  maxPositions: 2,
  cycleMs: 30_000,
  andGateTimeoutMs: 30_000,
  minConfidence: 35,
  minVolatility2h: 0.0012,
  minAmplitude: 0.002,
  minSpread: 0.004,
  // Parâmetros ajustáveis pelo robô (sobrescritos a cada ciclo)
  _gasRoundTrip: 0.028,
  _vol24h: 0,
  _ajustadoEm: 0,
}

class ModoGrao {
  private _ativo = false
  private _testMode = false
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
  private _simPrice = 0

  private getPair() { return getNetworkPair() }

  private listeners: Array<() => void> = []

  getState(): ModoGraoState {
    const total = this._wins + this._losses
    return {
      ativo: this._ativo,
      testMode: this._testMode,
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

  setTestMode(enabled: boolean) {
    this._testMode = enabled
    if (typeof window !== 'undefined') {
      localStorage.setItem('arcflow_modograo_testmode', enabled ? '1' : '0')
    }
    this.notify()
  }

  start() {
    if (this._ativo) return
    this._ativo = true
    this._lastError = null
    this._lastSignal = this._testMode ? '🧪 Modo teste (Sepolia) — volatilidade mock 0.5%' : ''
    const p = this.getPair()
    const netLabel = realSwap.getNetworkKey()
    console.log(`[ModoGrão] ▶ ${this._testMode ? '🧪 MODO TESTE' : 'Mainnet'} — ${p.toToken}/${p.fromToken} (${netLabel})`)
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
      const cycleMs = isArcStressMode() ? 10_000 : CONFIG.cycleMs
      await new Promise(r => setTimeout(r, Math.max(5_000, cycleMs - elapsed)))
    }
  }

  // ─── Robô Ajustador: recalibra thresholds dinamicamente ───
  private async ajustarAoMercado() {
    const netKey = realSwap.getNetworkKey()
    const net = NETWORKS[netKey]
    const agora = Date.now()

    // Só reajusta a cada 5 ciclos (~2.5min) ou se for testnet
    if (!net?.isTestnet && agora - CONFIG._ajustadoEm < 120_000) return

    try {
      const gasCost = await gasPriceOracle.getGasCost(netKey).catch(() => 0.005)
      CONFIG._gasRoundTrip = gasCost * 2

      const p = this.getPair()
      const vol = volatilityTracker.getVolatility(p.toToken as any)
      CONFIG._vol24h = vol.vol24h

      const usdcBal = realSwap.getBalance("USDC") || 10

      CONFIG.baseTradeUSD = Math.max(3, Math.min(10, Math.round(CONFIG._gasRoundTrip * 80)))
      if (usdcBal < CONFIG.baseTradeUSD * 2) {
        CONFIG.baseTradeUSD = Math.max(1, Math.floor(usdcBal * 0.4))
      }

      if (CONFIG._vol24h > 0.02)        CONFIG.batchThreshold = 2
      else if (CONFIG._vol24h > 0.008)  CONFIG.batchThreshold = 3
      else                               CONFIG.batchThreshold = 4

      CONFIG.targetUSD = Math.max(0.03, Math.round(CONFIG._gasRoundTrip * 2 * 100) / 100)

      if (CONFIG._vol24h > 0.02)        CONFIG.minConfidence = 40
      else if (CONFIG._vol24h > 0.008)  CONFIG.minConfidence = 30
      else                               CONFIG.minConfidence = 20

      CONFIG.minVolatility2h = Math.max(0.0005, CONFIG._gasRoundTrip * 0.03)

      if (CONFIG._vol24h > 0.02)        CONFIG.maxBatchAgeMs = 45_000
      else if (CONFIG._vol24h > 0.008)  CONFIG.maxBatchAgeMs = 90_000
      else                               CONFIG.maxBatchAgeMs = 150_000

      CONFIG._ajustadoEm = agora
      console.log(`[Grão⚙️] gas=$${gasCost.toFixed(4)} vol=${(CONFIG._vol24h*100).toFixed(2)}% ` +
        `base=$${CONFIG.baseTradeUSD} thresh=${CONFIG.batchThreshold} target=$${CONFIG.targetUSD.toFixed(2)} ` +
        `conf=${CONFIG.minConfidence} minVol=${(CONFIG.minVolatility2h*100).toFixed(2)}%`)
    } catch {
    }
  }

  private async ciclo() {
    this._cycleCount++
    const now = Date.now()

    // 0. Robô Ajustador: recalibra thresholds conforme mercado
    await this.ajustarAoMercado()

    // 1. Prices + volatility
    await Promise.all([
      volatilityTracker.collectPrice(this.getPair().fromToken as any),
      volatilityTracker.collectPrice(this.getPair().toToken as any),
    ])
    const p = this.getPair()
    const [fromPrice, toPrice] = await Promise.all([
      realSwap.fetchTokenPrice(p.fromToken as any).catch(() => 1),
      realSwap.fetchTokenPrice(p.toToken as any).catch(() => 0),
    ])
    if (toPrice <= 0) return

    const vol = this._testMode
      ? { vol24h: 0.01, vol1h: 0.005, vol4h: 0.007, dataPoints: 20, trend: 'stable' as const }
      : volatilityTracker.getVolatility(this.getPair().toToken as any)

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

    // 5. Push signals de cada agente (não executa no AND gate — acumula)
    const openCount = this._openPositions.filter(p => p.status === 'open').length
    if (openCount >= CONFIG.maxPositions) return

    const amplitude = vol.vol24h
    if (amplitude >= CONFIG.minAmplitude) {
      const mrConfidence = Math.min(80, Math.round(30 + amplitude * 600))
      if (mrConfidence >= (this._testMode ? 20 : CONFIG.minConfidence)) {
        this._pendingSignals.push({ action: 'buy', agentName: 'MeanReversion', confidence: mrConfidence, timestamp: now })
      }
    }

    const spreadPct = this._testMode
      ? 0.005
      : fromPrice > 0 ? Math.abs(toPrice - fromPrice) / fromPrice : 0
    if (spreadPct >= CONFIG.minSpread) {
      const mmConfidence = Math.min(70, Math.round(40 + spreadPct * 20))
      if (mmConfidence >= (this._testMode ? 20 : CONFIG.minConfidence)) {
        this._pendingSignals.push({ action: 'buy', agentName: 'MarketMaker', confidence: mmConfidence, timestamp: now })
      }
    }

    // 6. Verifica se deve executar batch
    const oldest = this._pendingSignals.length > 0 ? this._pendingSignals[0].timestamp : now
    const batchReady = this._pendingSignals.length >= CONFIG.batchThreshold
    const batchExpired = this._pendingSignals.length >= 2 && (now - oldest) >= CONFIG.maxBatchAgeMs
    if (batchReady || batchExpired) {
      this._lastSignal = `Batch ${this._pendingSignals.length} sinais (MR+MM) — executando $${(this._pendingSignals.length * CONFIG.baseTradeUSD).toFixed(0)}`
      await this.executarCompra()
    }
  }

  private cleanStaleSignals(now: number) {
    const before = this._pendingSignals.length
    this._pendingSignals = this._pendingSignals.filter(s => now - s.timestamp < CONFIG.andGateTimeoutMs)
  }

  private async executarCompra() {
    if (this._executando) return
    if (this._pendingSignals.length === 0) return
    this._executando = true

    const batchSize = this._pendingSignals.length
    const batchAmountUSD = batchSize * CONFIG.baseTradeUSD
    const signals = [...this._pendingSignals]
    this._pendingSignals = []

    try {
      const p = this.getPair()
      if (this._testMode) {
        const simulatedPrice = p.toToken === 'EURC' ? 0.995 + Math.random() * 0.01 : 1
        const simulatedAmount = batchAmountUSD / simulatedPrice
        this._openPositions.push({
          id: `grão-${Date.now()}`,
          boughtToken: p.toToken,
          paidToken: p.fromToken,
          amountBought: simulatedAmount,
          amountPaid: batchAmountUSD,
          entryPrice: simulatedPrice,
          entryTimestamp: Date.now(),
          targetPrice: simulatedPrice + (CONFIG.targetUSD / simulatedAmount),
          stopPrice: simulatedPrice - (CONFIG.stopUSD / simulatedAmount),
          status: 'open',
        })
        this._totalTrades++
        this._lastError = ''
        this._lastSignal = `🧪 Batch ${batchSize}sinais $${batchAmountUSD} ${p.toToken} @ $${simulatedPrice.toFixed(4)}`
        return
      }
      const result = await realSwap.executeSwap(
        p.fromToken as any,
        p.toToken as any,
        batchAmountUSD,
      )
      if (result.success && result.toAmount > 0) {
        const entryPrice = result.fromAmount / result.toAmount
        const wethBought = result.toAmount
        const targetPrice = (batchAmountUSD + CONFIG.targetUSD) / wethBought
        const stopPrice = (batchAmountUSD + CONFIG.stopUSD) / wethBought

        this._openPositions.push({
          id: `grão-${Date.now()}`,
          boughtToken: p.toToken,
          paidToken: p.fromToken,
          amountBought: wethBought,
          amountPaid: result.fromAmount,
          entryPrice,
          entryTimestamp: Date.now(),
          targetPrice,
          stopPrice,
          status: 'open',
        })
        this._totalTrades++
        this._lastSignal = `Batch ${batchSize}sinais $${batchAmountUSD} ${p.toToken} @ entry $${entryPrice.toFixed(2)}`
      } else {
        this._pendingSignals.push(...signals) // devolve sinais se falhou
        this._lastError = `Falha batch: ${result.message}`
      }
    } catch (err: any) {
      this._pendingSignals.push(...signals)
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

const modoGraoInstance = new ModoGrao()
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('arcflow_modograo_testmode')
  if (saved === '1') modoGraoInstance.setTestMode(true)
}
export const modoGrao = modoGraoInstance
