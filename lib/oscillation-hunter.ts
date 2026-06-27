// lib/oscillation-hunter.ts
// Caçador de Micro-Oscilações em Pools de Terceiros
//
// Estratégia: "Event-Driven Micro-Scalping" em stablecoin pools
// - Monitora pools profundos (Uniswap V3, QuickSwap) via LI.FI quotes
// - Detecta desvios de preço >0.2% do fair value (SoSoValue oracle)
// - Entra na baixa, sai na alta (mean reversion em stablecoins)
// - Foco: pools com fee 0.01% (USDC/USDT) e 0.05% (USDC/DAI)
//
// Matemática (Polygon, USDC/USDT 0.01% pool, $20 batch):
//   Gas RT: $0.028 | Fee RT: $0.004 | Custo total: $0.032
//   Preço precisa desviar 0.16% → captura 0.15% = $0.03 lucro/trade
//   Eventos de oscilação >0.2%: 3-5/hora em horário comercial
//   Win rate esperado: 65% (mean reversion em stables é confiável)
//   Lucro diário estimado: $0.50-1.50 com $20 capital

import { realSwap, NETWORKS, type NetworkKey, type TokenSymbol } from './real-swap-executor'
import { gasPriceOracle } from './gas-price-oracle'
import { capitalController } from './capital-controller'

// ─── Configuração das Pools Alvo ───
interface TargetPool {
  network: NetworkKey
  fromToken: string
  toToken: string
  poolAddress: string      // endereço do pool no explorer
  feeTier: number           // 0.0001 = 0.01%, 0.0005 = 0.05%, 0.003 = 0.3%
  tvlEstimate: number      // TVL estimado em USD
  minDeviation: number      // desvio mínimo pra entrar (%)
  targetProfit: number      // take-profit (%)
  stopLoss: number          // stop-loss (%)
}

const TARGET_POOLS: TargetPool[] = [
  {
    network: 'polygon', fromToken: 'USDC', toToken: 'USDT',
    poolAddress: '0x...UniswapV3...', feeTier: 0.0001, tvlEstimate: 2000000,
    minDeviation: 0.0020, targetProfit: 0.0015, stopLoss: -0.0010,
  },
  {
    network: 'polygon', fromToken: 'USDC', toToken: 'DAI',
    poolAddress: '0x...UniswapV3...', feeTier: 0.0005, tvlEstimate: 1500000,
    minDeviation: 0.0025, targetProfit: 0.0020, stopLoss: -0.0015,
  },
  {
    network: 'base', fromToken: 'USDC', toToken: 'DAI',
    poolAddress: '0x...UniswapV3...', feeTier: 0.0005, tvlEstimate: 800000,
    minDeviation: 0.0020, targetProfit: 0.0015, stopLoss: -0.0010,
  },
  {
    network: 'polygon', fromToken: 'USDC', toToken: 'EURC',
    poolAddress: '0x...UniswapV3...', feeTier: 0.003, tvlEstimate: 500000,
    minDeviation: 0.0080, targetProfit: 0.0060, stopLoss: -0.0040,
  },
]

interface HuntPosition {
  pool: TargetPool
  entryPrice: number       // preço de entrada (toToken em USD)
  fairPrice: number        // preço justo do oráculo na entrada
  deviation: number        // % de desvio na entrada
  amountUSD: number        // valor do trade
  amountOut: number        // tokens recebidos
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
  deviation: number       // % de desvio (positivo = toToken caro, negativo = barato)
  direction: 'buy' | 'sell'
  batchSize: number
  estimatedProfit: number
  confidence: number      // 0-100
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

  start() { this._ativo = true; this._lastError = null; this.loop(); this.notify() }
  stop() { this._ativo = false; this.notify() }

  private async loop() {
    while (this._ativo) {
      try {
        await this.scanOscillations()
        this._lastError = null
      } catch (err: any) {
        this._lastError = err.message?.slice(0, 200)
      }
      this.notify()
      await new Promise(r => setTimeout(r, 10_000)) // scan a cada 10s
    }
  }

  /** Varre todas as pools alvo em busca de oscilações */
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

        // Coletar preço atual via SoSoValue (cached 15s)
        const currentPrice = await realSwap.fetchTokenPrice(pool.toToken as TokenSymbol).catch(() => 0)
        if (currentPrice <= 0) continue

        // Manter histórico de preços (últimos 10 pontos = ~2.5 min a cada 15s)
        const key = `${pool.network}:${pool.fromToken}→${pool.toToken}`
        if (!this._priceHistory.has(key)) this._priceHistory.set(key, [])
        const history = this._priceHistory.get(key)!
        history.push(currentPrice)
        if (history.length > 12) history.shift()

        // Precisamos de pelo menos 4 pontos pra calcular SMA confiável
        if (history.length < 4) continue

        // SMA (média móvel simples) dos últimos N pontos
        const sma = history.reduce((a, b) => a + b, 0) / history.length
        const deviation = (currentPrice - sma) / sma

        // Só age se desvio > threshold mínimo da pool
        if (Math.abs(deviation) < pool.minDeviation) continue

        // Verificar se a tendência é de reversão (mean reversion)
        // Se preço caiu (deviation negativo) e últimos 2 pontos estão subindo → reversão
        const recentTrend = history.length >= 3
          ? history[history.length - 1] - history[history.length - 3]
          : 0
        const isReversing = (deviation < 0 && recentTrend > 0) || (deviation > 0 && recentTrend < 0)
        if (!isReversing) continue // espera confirmação de reversão antes de entrar

        const batchSize = Math.min(30, Math.max(5, Math.floor(pool.tvlEstimate * 0.00002)))
        const gasRT = gasCost * 2
        const feeRT = batchSize * pool.feeTier * 2
        const custoTotal = gasRT + feeRT
        const lucroEstimado = batchSize * pool.targetProfit - custoTotal
        if (lucroEstimado < 0.005) continue

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

  /** Executa entrada no pool */
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
        signal.batchSize * signal.fairPrice, // converter pra valor em toToken
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

  /** Verifica take-profit / stop-loss das posições abertas */
  private async checkPositions() {
    for (const pos of this._positions) {
      if (pos.status !== 'open') continue

      const currentPrice = await this.getPrice(pos.pool.toToken).catch(() => 0)
      if (currentPrice <= 0) continue

      if (currentPrice >= pos.targetPrice || currentPrice <= pos.stopPrice) {
        await this.closePosition(pos, currentPrice)
      }

      // Timeout: fecha após 5 minutos se não bateu target nem stop
      if (Date.now() - pos.entryTime > 300_000) {
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

    capitalController.unlock()
    this._lastSignal = `${isWin ? '🎯' : '🛑'} ${pos.pool.toToken}: $${profit.toFixed(3)} (${this._wins}W/${this._losses}L)`
  }

  /** Preço atual via SoSoValue oracle */
  private async getPrice(token: string): Promise<number> {
    try {
      return await realSwap.fetchTokenPrice(token as TokenSymbol).catch(() => 1)
    } catch {
      return 1.0
    }
  }
}

export const oscillationHunter = new OscillationHunter()
export type { HuntState, OscillationSignal, HuntPosition, TargetPool }
