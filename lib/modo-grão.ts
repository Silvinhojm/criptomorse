// Modo Grão — Microtrade batch system
// Batching: acumula sinais MR + MM e executa swap único maior
// Robô Ajustador: recalcula thresholds a cada ciclo (gas, vol, saldo)
// Target: cobre gas round-trip + margem dinâmica

import { realSwap, isArcStressMode, NETWORKS, type NetworkKey } from './real-swap-executor'
import { volatilityTracker } from './volatility-tracker'
import { gasPriceOracle } from './gas-price-oracle'
import { capitalController } from './capital-controller'

function getNetworkPair(): { fromToken: string; toToken: string; isStable: boolean } {
  const net = realSwap.getNetworkKey() as string
  if (net === 'arc' || net === 'sepolia') return { fromToken: 'USDC', toToken: 'EURC', isStable: true }
  // Se WETH vol abaixo do break-even, migra pra EURC (stablecoin arbitrage)
  const volWeth = volatilityTracker.getVolatility('WETH' as any).vol24h
  const gasEstimate = CONFIG._gasRoundTrip || 0.03
  const spreadDex = 0.003
  const M_break_weth = ((gasEstimate / 20 + 1 + spreadDex) / (1 - spreadDex)) - 1
  if (volWeth < M_break_weth) {
    return { fromToken: 'USDC', toToken: 'EURC', isStable: true }
  }
  return { fromToken: 'USDC', toToken: 'WETH', isStable: false }
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

  // ─── Robô Ajustador: matemática exata de break-even ───
  // Fórmula: V × [(1+M)×(1−S) − (1+S)] − G = 0
  //   M_break = ((G/V + 1 + S) / (1 − S)) − 1
  //   V_min   = G / ((1−S)×(1+vol) − (1+S))
  private async ajustarAoMercado() {
    const netKey = realSwap.getNetworkKey() as NetworkKey
    const net = NETWORKS[netKey]
    const agora = Date.now()

    if (!net?.isTestnet && agora - CONFIG._ajustadoEm < 120_000) return

    try {
      const gasCost = await gasPriceOracle.getGasCost(netKey).catch(() => 0.005)
      CONFIG._gasRoundTrip = gasCost * 2

      const p = this.getPair()
      const vol = volatilityTracker.getVolatility(p.toToken as any)
      CONFIG._vol24h = vol.vol24h

      const usdcBal = realSwap.getBalance("USDC") || 10

      // ── Spread estimado: DEX=0.3% (se disponível) ou LI.FI=0.5% ──
      const isStablePair = p.toToken === 'EURC' || p.toToken === 'USDC'
      const spreadEstimate = isStablePair ? 0.0005             // EURC: spread ~0.05%
        : net && !net.isTestnet ? 0.003                         // DEX (Uniswap V2): 0.3%
        : 0.005                                                 // LI.FI: 0.5%

      // ── Batch mínimo viável: V_min que faz vol ≥ break-even ──
      // Rearranjo: V_min = G / ((1−S)² * (1+vol) − (1+S)*(1−S))
      // Simplificado: V_min ≈ G / ((1+vol)(1−2S) − 1)
      const denom = (1 + CONFIG._vol24h) * (1 - 2 * spreadEstimate) - 1
      const V_min = denom > 0 ? Math.ceil(CONFIG._gasRoundTrip / denom) : 99999

      if (V_min < 3) {
        CONFIG.baseTradeUSD = 3
        CONFIG.batchThreshold = 2
      } else if (V_min <= 10) {
        CONFIG.baseTradeUSD = Math.max(3, Math.ceil(V_min / 2))
        CONFIG.batchThreshold = 2
      } else if (V_min <= 25) {
        CONFIG.baseTradeUSD = Math.min(Math.ceil(V_min / 4), 8)
        CONFIG.batchThreshold = 4
      } else {
        CONFIG.baseTradeUSD = Math.min(Math.ceil(V_min / 6), 10)
        CONFIG.batchThreshold = 5
      }

      // ── targetUSD: gas + V × spread × 2 (entrada+saída) + margem ──
      const spreadCost = CONFIG.baseTradeUSD * CONFIG.batchThreshold * spreadEstimate * 2
      CONFIG.targetUSD = Math.max(0.03, Math.ceil((CONFIG._gasRoundTrip + spreadCost + 0.01) * 100) / 100)

      // ── minConfidence: vol alta → exige mais ──
      CONFIG.minConfidence = CONFIG._vol24h > 0.02 ? 40 : CONFIG._vol24h > 0.008 ? 30 : isStablePair ? 15 : 20

      // ── minVolatility2h: gas/valor — só entra se mercado paga ──
      CONFIG.minVolatility2h = Math.max(0.0003, CONFIG._gasRoundTrip / (CONFIG.baseTradeUSD * CONFIG.batchThreshold))

      // ── minAmplitude: stablecoin precisa de muito menos movimento ──
      CONFIG.minAmplitude = isStablePair ? 0.0001 : Math.max(0.001, CONFIG._gasRoundTrip * 0.1)

      // ── maxBatchAgeMs: mais rápido se viável ──
      CONFIG.maxBatchAgeMs = V_min < 15 ? 45_000 : V_min < 30 ? 90_000 : 150_000

      CONFIG._ajustadoEm = agora
      const viavel = CONFIG._vol24h >= CONFIG.minVolatility2h
      console.log(`[Grão⚙️] ${viavel ? '✓' : '✗'} ${p.toToken} gas=$${gasCost.toFixed(4)} vol=${(CONFIG._vol24h*100).toFixed(2)}% ` +
        `spread=${(spreadEstimate*100).toFixed(2)}% Vmin=$${V_min} ` +
        `batch=${CONFIG.batchThreshold}×$${CONFIG.baseTradeUSD}=$${CONFIG.baseTradeUSD*CONFIG.batchThreshold} ` +
        `target=$${CONFIG.targetUSD.toFixed(2)} minVol=${(CONFIG.minVolatility2h*100).toFixed(2)}%`)
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
      if (!capitalController.canExecute('grao', batchAmountUSD, `${p.fromToken}→${p.toToken}`)) {
        this._pendingSignals.push(...signals) // devolve sinais
        this._lastSignal = '⏳ Capital ocupado por outro método — aguardando'
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
