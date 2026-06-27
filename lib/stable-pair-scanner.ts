// lib/stable-pair-scanner.ts
// Scanner de pares stablecoin — gera relatório JSON para agentes votarem
// Analisa: spread, slippage, liquidez, arbitragem, batch mínimo, lucro esperado

import { NETWORKS, TRADING_PAIRS, type NetworkKey, type TokenSymbol } from './real-swap-executor'
import { stableStability } from './stable-stability'
import { volatilityTracker } from './volatility-tracker'
import { gasPriceOracle } from './gas-price-oracle'
import { FOREIGN_STABLES, getStablesComLiquidez, temLiquidezMinima, estimarSpread, alertaRegulatorio, usdToForeign } from './stablecoins-internacionais'

export interface StablePairInfo {
  pair: string
  network: NetworkKey
  fromToken: string
  toToken: string
  // Métricas de custo
  gasCost: number
  gasRoundTrip: number
  spreadEstimate: number       // 0.0005 = 0.05%
  slippageEstimate: number     // 0.001 = 0.1%
  // Métricas de mercado
  currentPrice: number
  volumeRank: 'high' | 'medium' | 'low'
  // Viabilidade
  batchMinimo: number
  lucroPorBatch: number
  score: number                // 0-100
  // Oportunidade
  microTrend?: { delta: number; direction: 'up' | 'down'; strength: number }
  arbitragemCrossChain?: { chainB: string; spreadPct: number; batchMin: number }
  // Recomendação
  recomendacao: 'AGORA' | 'MONITORAR' | 'IGNORAR'
  motivo: string
}

const GAS_COSTS: Record<string, number> = {
  polygon: 0.014, base: 0.006, arbitrum: 0.040, ethereum: 1.50, arc: 0.006, sepolia: 0.003,
}

class StablePairScanner {
  private cache: StablePairInfo[] = []
  private lastScan = 0

  /** Scaneia todos os pares stablecoin em todas as redes */
  async scan(): Promise<StablePairInfo[]> {
    const now = Date.now()
    if (now - this.lastScan < 60_000) return this.cache

    const results: StablePairInfo[] = []
    const microTrends = await stableStability.scanAll()
    const trendMap = new Map<string, (typeof microTrends)[0]>()
    for (const t of microTrends) trendMap.set(`${t.network}:${t.pair}`, t)

    for (const [networkKey, net] of Object.entries(NETWORKS)) {
      if ((net as any).isTestnet && networkKey !== 'arc') continue
      const pairs = (TRADING_PAIRS as any)[networkKey] || []
      const gasCost = GAS_COSTS[networkKey] ?? 0.01
      // Rede com gas muito caro (>$0.05) não compensa micro-trades
      if (gasCost > 0.05) continue

      for (const pair of pairs) {
        const fromIsStable = isStableToken(pair.from)
        const toIsStable = isStableToken(pair.to)
        if (!fromIsStable || !toIsStable) continue
        if (pair.from === pair.to) continue

        const pairKey = `${pair.from}→${pair.to}`
        const trend = trendMap.get(`${networkKey}:${pairKey}`)

        // ── Spread estimado por rede e liquidez ──
        const volumeRank = this.estimateVolume(networkKey as NetworkKey, pairKey)
        const spreadEstimate = volumeRank === 'high' ? 0.0003   // 0.03% — par super líquido
          : volumeRank === 'medium' ? 0.0005                     // 0.05%
          : 0.001                                                 // 0.1% — baixa liquidez
        const slippageEstimate = spreadEstimate * 2 // slippage ≈ 2× spread

        // ── Batch mínimo viável ──
        // M_break = ((G/V + 1 + S) / (1 - S)) - 1
        // Rearranjando: V_min = G / ((1+vol_min)(1-2S) - 1)
        const volMin = 0.0005 // assume movimento mínimo de 0.05% para stables
        const denom = (1 + volMin) * (1 - 2 * spreadEstimate) - 1
        const batchMinimo = denom > 0 ? Math.ceil(gasCost * 2 / denom) : 0
        const batchSugerido = batchMinimo > 0 ? Math.max(batchMinimo, 5) : 0

        // ── Lucro estimado ──
        const amplitude = trend?.amplitude ? trend.amplitude / 100 : 0.0008 // usa amplitude real ou 0.08%
        const lucroBruto = batchSugerido * amplitude
        const custoGas = gasCost * 2
        const custoSpread = batchSugerido * spreadEstimate * 2
        const lucroPorBatch = lucroBruto - custoGas - custoSpread

        // ── Score 0-100 ──
        let score = 0
        if (lucroPorBatch > 0) {
          score = 30 // base
          if (volumeRank === 'high') score += 20  // baixo spread
          else if (volumeRank === 'medium') score += 10
          if (trend && trend.viabilidade > 30) score += 20 // micro-trend ativa
          if (batchMinimo <= 10) score += 15      // batch pequeno = rápido
          if (gasCost <= 0.01) score += 15         // gas barato
        } else if (batchMinimo <= 30) {
          score = 10 // monitorar — pode ficar viável com mais volatilidade
        }

        // ── Arbitragem cross-chain ──
        const arb = await this.detectCrossChainArb(networkKey as NetworkKey, pair.from, pair.to)

        // ── Recomendação ──
        let recomendacao: StablePairInfo['recomendacao'] = 'IGNORAR'
        let motivo = ''
        if (score >= 60 && lucroPorBatch > 0.01) {
          recomendacao = 'AGORA'
          motivo = `Lucro $${lucroPorBatch.toFixed(3)}/batch com $${batchSugerido}`
        } else if (score >= 30) {
          recomendacao = 'MONITORAR'
          motivo = `Precisa de batch $${batchMinimo} ou mais volatilidade`
        } else {
          motivo = `Batch mínimo $${batchMinimo} inviável (gas $${gasCost.toFixed(3)})`
        }

        results.push({
          pair: pairKey,
          network: networkKey as NetworkKey,
          fromToken: pair.from,
          toToken: pair.to,
          gasCost: Math.round(gasCost * 10000) / 10000,
          gasRoundTrip: Math.round(gasCost * 2 * 10000) / 10000,
          spreadEstimate,
          slippageEstimate,
          currentPrice: trend?.currentPrice ?? 1,
          volumeRank,
          batchMinimo,
          lucroPorBatch: Math.round(lucroPorBatch * 10000) / 10000,
          score,
          microTrend: trend ? {
            delta: trend.delta5m,
            direction: trend.trend === 'up' ? 'up' : trend.trend === 'down' ? 'down' : 'flat' as 'up' | 'down',
            strength: trend.viabilidade,
          } : undefined,
          arbitragemCrossChain: arb,
          recomendacao,
          motivo,
        })
      }
    }

    // ── Pares Internacionais (JPYC, BRLA, QCAD...) com gate de liquidez ──
    const internacionais = getStablesComLiquidez().filter(c => c.symbol !== 'EURC') // EURC já tá nos nativos
    for (const coin of internacionais) {
      for (const net of coin.networks) {
        const chainKey = net.chain as string
        const gasCost = GAS_COSTS[chainKey] ?? 0.01
        if (gasCost > 0.05) continue
        if (!(TRADING_PAIRS as any)[chainKey]) continue // rede sem suporte

        const spreadEstimate = estimarSpread(net.poolTvl)
        if (spreadEstimate > 0.01) continue // spread >1% → inviável

        const batchMinimo = Math.max(5, Math.ceil(gasCost * 2 / 0.0005))
        const lucroPorBatch = batchMinimo * 0.001 - gasCost * 2 - batchMinimo * spreadEstimate * 2
        const score = lucroPorBatch > 0 ? 25 + (net.poolTvl! > 50000 ? 20 : net.poolTvl! > 25000 ? 10 : 0) : 0

        const alerta = alertaRegulatorio(coin.symbol)

        results.push({
          pair: `USDC→${coin.symbol}`,
          network: chainKey as NetworkKey,
          fromToken: 'USDC',
          toToken: coin.symbol,
          gasCost: Math.round(gasCost * 10000) / 10000,
          gasRoundTrip: Math.round(gasCost * 2 * 10000) / 10000,
          spreadEstimate,
          slippageEstimate: spreadEstimate * 2,
          currentPrice: 1 / coin.forexRate,
          volumeRank: net.poolTvl! > 100000 ? 'high' : net.poolTvl! > 25000 ? 'medium' : 'low',
          batchMinimo,
          lucroPorBatch: Math.round(lucroPorBatch * 10000) / 10000,
          score: alerta ? Math.min(score, 10) : score, // regulatório reduz score
          recomendacao: alerta ? 'IGNORAR' : score >= 40 ? 'MONITORAR' : 'IGNORAR',
          motivo: alerta ?? (net.poolTvl! > 50000 ? `Pool $${(net.poolTvl!/1000).toFixed(0)}K` : 'Baixa liquidez'),
        })
      }
    }

    results.sort((a, b) => b.score - a.score || b.lucroPorBatch - a.lucroPorBatch)
    this.cache = results
    this.lastScan = now
    return results
  }

  /** Retorna relatório JSON formatado para agentes */
  getAgentReport() {
    return {
      scannedAt: this.lastScan,
      totalPairs: this.cache.length,
      oportunidades: this.cache.filter(p => p.recomendacao === 'AGORA').length,
      monitorar: this.cache.filter(p => p.recomendacao === 'MONITORAR').length,
      top3: this.cache.filter(p => p.batchMinimo > 0).slice(0, 3).map(p => ({
        pair: `${p.network}:${p.pair}`,
        score: p.score,
        batch: p.batchMinimo,
        lucro: p.lucroPorBatch,
        acao: p.recomendacao,
      })),
      pairs: this.cache,
    }
  }

  /** Detecta arbitragem cross-chain (mesmo par em redes diferentes) */
  private async detectCrossChainArb(
    network: NetworkKey, fromToken: string, toToken: string
  ): Promise<StablePairInfo['arbitragemCrossChain'] | undefined> {
    // Verifica se o mesmo par existe em outra rede com diferença de preço
    const thisPrice = await this.getPairPrice(network, fromToken, toToken)
    if (thisPrice <= 0) return undefined

    for (const [otherNet, _] of Object.entries(NETWORKS)) {
      if (otherNet === network) continue
      const pairs = (TRADING_PAIRS as any)[otherNet] || []
      const hasPair = pairs.some((p: any) => p.from === fromToken && p.to === toToken)
      if (!hasPair) continue

      const otherPrice = await this.getPairPrice(otherNet as NetworkKey, fromToken, toToken)
      if (otherPrice <= 0) continue

      const spreadPct = Math.abs(thisPrice - otherPrice) / Math.min(thisPrice, otherPrice)
      if (spreadPct > 0.001) { // >0.1% diferença = oportunidade
        const gasTotal = (GAS_COSTS[network] ?? 0.01) + (GAS_COSTS[otherNet] ?? 0.01)
        const batchMin = Math.ceil(gasTotal / spreadPct)
        if (batchMin <= 100) {
          return { chainB: otherNet, spreadPct: Math.round(spreadPct * 10000) / 100, batchMin }
        }
      }
    }
    return undefined
  }

  private async getPairPrice(network: NetworkKey, _from: string, to: string): Promise<number> {
    // Preço do token "to" é o preço de mercado (ambos ~1 USD pra stables)
    try {
      const res = await fetch(`/api/price?ids=${getCoinId(to)}`)
      const data = await res.json()
      return data?.prices?.[getCoinId(to)] ?? 1
    } catch {
      return 1
    }
  }

  private estimateVolume(network: NetworkKey, pairKey: string): 'high' | 'medium' | 'low' {
    // Heurística baseada na rede e no par
    if (network === 'ethereum' || network === 'polygon') return 'high' // maior liquidez
    if (network === 'base' || network === 'arbitrum') {
      if (pairKey.includes('EURC')) return 'medium'
      return 'high'
    }
    if (network === 'arc') return 'low' // testnet
    return 'medium'
  }
}

function isStableToken(t: string): boolean {
  return ['USDC', 'USDT', 'DAI', 'EURC'].includes(t)
}

function getCoinId(symbol: string): string {
  const ids: Record<string, string> = {
    USDC: '1673723677362319868', EURC: '1673723677362320241',
    USDT: '1673723677362319971', DAI: '1673723677362320167',
  }
  return ids[symbol] || symbol.toLowerCase()
}

export const stablePairScanner = new StablePairScanner()
