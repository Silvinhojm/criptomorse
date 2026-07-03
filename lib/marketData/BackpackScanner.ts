import { marketDataCollector, type Kline, type StockCandidate } from './MarketDataCollector'
import { labelPriceMovement } from './labelPriceMovement'
import { isUSStockMarketOpen, isStockSymbol } from './marketHours'
import { escolaRobos } from '../escola-robos'
import { parametrosRobos } from '../parametros-robos'

export interface BackpackSignal {
  symbol: string
  baseSymbol: string
  direcao: 'buy' | 'sell'
  confiancaMedia: number
  score: number
  agentes: string[]
  agentesCount: number
  ultimoPreco: number
  variacao24h: number
  tipo: 'crypto' | 'stock'
  mercadoAberto: boolean
  resumo: string
}

const CRYPTO_SYMBOLS = [
  { symbol: 'BTC_USDC', baseSymbol: 'BTC', tipo: 'crypto' as const },
  { symbol: 'ETH_USDC', baseSymbol: 'ETH', tipo: 'crypto' as const },
  { symbol: 'SOL_USDC', baseSymbol: 'SOL', tipo: 'crypto' as const },
]

const SCAN_INTERVAL_MS = 60_000

export class BackpackScanner {
  private lastScan = 0
  private signals: BackpackSignal[] = []
  private scanning = false
  private lastStockRefresh = 0
  private stockCandidates: StockCandidate[] = []
  private stockRefreshIntervalMs = 60 * 60 * 1000

  getSignals(): BackpackSignal[] {
    return this.signals
  }

  getTopSignal(): BackpackSignal | null {
    return this.signals.length > 0 ? this.signals[0] : null
  }

  private async refreshStockCandidates(): Promise<void> {
    if (Date.now() - this.lastStockRefresh < this.stockRefreshIntervalMs) return
    this.lastStockRefresh = Date.now()
    // Stock tokens return NASDAQ reference volume data in the ticker API — quoteVolume24h
    // is always 0 (unreliable). Skip liquidity filter (which checks volume) and include
    // all discovered stock candidates. Only 2 exist today (MU.US, SPCX.US) — both legit.
    const candidates = await marketDataCollector.getTopStocksByVolume(15)
    this.stockCandidates = candidates
  }

  async scan(force = false): Promise<BackpackSignal[]> {
    if (this.scanning) return this.signals
    if (!force && Date.now() - this.lastScan < SCAN_INTERVAL_MS) return this.signals

    this.scanning = true
    try {
      await this.refreshStockCandidates()

      const trackedSymbols: Array<{ symbol: string; baseSymbol: string; tipo: 'crypto' | 'stock' }> = [
        ...CRYPTO_SYMBOLS,
        ...this.stockCandidates.map(c => ({
          symbol: c.symbol,
          baseSymbol: c.baseSymbol,
          tipo: 'stock' as const,
        })),
      ]

      const results: BackpackSignal[] = []
      const endTime = Math.floor(Date.now() / 1000)
      const startTime = endTime - 24 * 3600
      const allAgents = escolaRobos.getAll().filter(a => a.status === 'aprendiz' || a.status === 'promovido')

      for (const tracked of trackedSymbols) {
        if (isStockSymbol(tracked.symbol) && !isUSStockMarketOpen()) {
          console.log(`⏸️ Mercado fechado para ${tracked.symbol} — sem sinal`)
          continue
        }

        const klines = await marketDataCollector.getKlines(tracked.symbol, '1h', startTime, endTime).catch(() => [] as Kline[])
        if (klines.length < 2) continue

        const windows = labelPriceMovement(klines, 60, tracked.symbol)
        const windowsNaoNeutros = windows.filter(w => w.label !== 'neutro')
        if (windowsNaoNeutros.length === 0) continue

        let ticker = await marketDataCollector.getTicker(tracked.symbol).catch(() => null)

        let comprasAcertaram = 0
        let vendasAcertaram = 0
        let totalCompras = 0
        let totalVendas = 0
        let confiancaMediaCompras = 0
        let confiancaMediaVendas = 0

        for (const agente of allAgents) {
          const confiancaBase = Math.max(30, Math.min(80, 50 + agente.pontos / 20))

          for (const w of windowsNaoNeutros) {
            const acertouBuy = w.label === 'alta'

            if (acertouBuy) {
              comprasAcertaram++
              confiancaMediaCompras += confiancaBase
            } else {
              vendasAcertaram++
              confiancaMediaVendas += confiancaBase
            }
          }
        }
        totalCompras = allAgents.length * (windowsNaoNeutros.filter(w => w.label === 'alta').length)
        totalVendas = allAgents.length * (windowsNaoNeutros.filter(w => w.label === 'baixa').length)

        const accRateBuy = totalCompras > 0 ? comprasAcertaram / totalCompras : 0
        const accRateSell = totalVendas > 0 ? vendasAcertaram / totalVendas : 0

        const winRate = Math.max(accRateBuy, accRateSell)
        const direcao = accRateBuy >= accRateSell ? 'buy' : 'sell'
        const confMedia = direcao === 'buy' && totalCompras > 0
          ? Math.round(confiancaMediaCompras / Math.max(1, totalCompras))
          : Math.round(confiancaMediaVendas / Math.max(1, totalVendas))

        const score = Math.round(winRate * confMedia)

        results.push({
          symbol: tracked.symbol,
          baseSymbol: tracked.baseSymbol,
          direcao,
          confiancaMedia: confMedia,
          score,
          agentes: allAgents.map(a => a.nome),
          agentesCount: allAgents.length,
          ultimoPreco: ticker?.lastPrice ?? 0,
          variacao24h: ticker?.priceChangePercent24h ?? 0,
          tipo: tracked.tipo,
          mercadoAberto: isStockSymbol(tracked.symbol) ? isUSStockMarketOpen() : true,
          resumo: this._gerarResumo(tracked.baseSymbol, direcao, winRate, confMedia, tracked.tipo),
        })
      }

      results.sort((a, b) => b.score - a.score)
      this.signals = results
      this.lastScan = Date.now()
    } finally {
      this.scanning = false
    }

    return this.signals
  }

  private _gerarResumo(baseSymbol: string, direcao: 'buy' | 'sell', winRate: number, confMedia: number, tipo: 'crypto' | 'stock'): string {
    const emoji = direcao === 'buy' ? '🟢' : '🔴'
    const acao = tipo === 'stock' ? 'ação' : 'cripto'
    const confiancaStr = confMedia >= 70 ? 'alta confiança' : confMedia >= 50 ? 'confiança moderada' : 'baixa confiança'
    return `${emoji} ${baseSymbol} — ${acao} com sinal de ${direcao === 'buy' ? 'COMPRA' : 'VENDA'} (${(winRate * 100).toFixed(0)}% acerto, ${confiancaStr})`
  }
}

export const backpackScanner = new BackpackScanner()
