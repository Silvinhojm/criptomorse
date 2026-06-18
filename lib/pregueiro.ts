import { pregão, type OkSignal } from "./pregão"
import { TRADING_PAIRS, type NetworkKey, type TokenSymbol, isStable } from "./real-swap-executor"
import { pairPriceFeed } from "./pair-price-feed"
import { positionManager } from "./position-manager"
import { volatilityTracker } from "./volatility-tracker"

// Debounce: evita OKs duplicados do Staircase/TrailingStop/AutoClose no mesmo ciclo
const staircaseCloseSent = new Set<string>()

export interface PregueiroConfig {
  nome: string
  apelido: string
  cor: string
  icone: string
  redes: NetworkKey[]
}

export interface PregueiroDecisao {
  gostou: boolean
  par: string
  fromToken: string
  toToken: string
  confianca: number
  motivo: string
}

class TendênciaPregueiro {
  readonly config: PregueiroConfig = {
    nome: "Tendência",
    apelido: "Pregueiro da Tendência",
    cor: "#a78bfa",
    icone: "📈",
    redes: ["arc", "base", "polygon"]
  }

  private historico: Record<string, number[]> = {}

  analisar(par: string, from: string, to: string, precoAtual: number): PregueiroDecisao {
    if (!this.historico[par]) this.historico[par] = []
    const hist = this.historico[par]
    hist.push(precoAtual)
    if (hist.length > 20) hist.shift()

    if (hist.length < 3) {
      return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: "Poucos dados" }
    }

    const tendencia = hist[hist.length - 1] - hist[hist.length - 3]
    const volatilidade = hist.length > 3
      ? Math.abs(hist[hist.length - 1] - hist[hist.length - 4])
      : 0

    if (isStable(from) && !isStable(to)) {
      if (tendencia > 0.001 && volatilidade > 0.002) {
        const conf = Math.min(85, 40 + Math.abs(tendencia) * 3000)
        return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `${to} em alta (${(tendencia * 100).toFixed(3)}%)` }
      }
    }

    if (isStable(from) && isStable(to) && Math.abs(tendencia) > 0.0005) {
      const conf = Math.min(70, 30 + Math.abs(tendencia) * 5000)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Spread ${from}→${to}` }
    }

    return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: `Tendência ${tendencia > 0 ? "positiva" : "negativa"} fraca` }
  }
}

class VolumePregueiro {
  readonly config: PregueiroConfig = {
    nome: "Volume",
    apelido: "Pregueiro do Volume",
    cor: "#f97316",
    icone: "📊",
    redes: ["arc", "base", "polygon", "ethereum"]
  }

  private dadoMercado: { ratio: number; momentum: number } = { ratio: 1, momentum: 0 }

  async atualizarMercado() {
    try {
      const res = await fetch("/api/market-data", { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      const mkt = data.market ?? {}
      const vol = mkt.volume24h ?? 0
      const cap = mkt.totalMarketCap ?? 1
      const ratio = cap > 0 ? (vol / cap) * 100 : 1
      this.dadoMercado = { ratio, momentum: ratio > 5 ? 1 : ratio < 2 ? -1 : 0 }
    } catch {}
  }

  analisar(_par: string, from: string, to: string): PregueiroDecisao {
    const { ratio, momentum } = this.dadoMercado
    const par = `${from}→${to}`

    if (ratio > 5 && momentum > 0) {
      const conf = Math.min(80, 45 + ratio * 3)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Volume alto (${ratio.toFixed(1)}% cap)` }
    }

    if (ratio > 8) {
      const conf = Math.min(70, 40 + ratio * 2)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Volume muito alto (${ratio.toFixed(1)}%)` }
    }

    return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: `Volume normal (${ratio.toFixed(1)}%)` }
  }
}

class SentimentoPregueiro {
  readonly config: PregueiroConfig = {
    nome: "Sentimento",
    apelido: "Pregueiro do Sentimento",
    cor: "#22c55e",
    icone: "🧠",
    redes: ["arc", "base", "polygon", "ethereum", "arbitrum"]
  }

  private fearGreed = 50
  private ultimoSentimento: "positive" | "negative" | "neutral" = "neutral"

  async atualizarSentimento() {
    try {
      const res = await fetch("/api/market-data", { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      this.fearGreed = data.fearGreed?.value ?? 50
    } catch {}
  }

  analisar(_par: string, from: string, to: string): PregueiroDecisao {
    const par = `${from}→${to}`

    if (this.fearGreed > 65 && isStable(from)) {
      const conf = Math.min(75, 40 + (this.fearGreed - 50) * 1.5)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Mercado otimista (F&G: ${this.fearGreed})` }
    }

    if (this.fearGreed < 25 && !isStable(from) && isStable(to)) {
      const conf = Math.min(80, 50 + (50 - this.fearGreed) * 1.2)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Medo no mercado — fugindo pra stable (F&G: ${this.fearGreed})` }
    }

    if (this.fearGreed < 35 && isStable(from)) {
      return { gostou: true, par, fromToken: from, toToken: to, confianca: 55, motivo: `Mercado com medo — oportunidade de compra (F&G: ${this.fearGreed})` }
    }

    return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: `Sentimento neutro (F&G: ${this.fearGreed})` }
  }
}

class TáticoPregueiro {
  readonly config: PregueiroConfig = {
    nome: "Tático",
    apelido: "Pregueiro Tático",
    cor: "#fbbf24",
    icone: "⚡",
    redes: ["arc", "base"]
  }

  private ciclos = 0

  analisar(par: string, from: string, to: string, precoAtual?: number): PregueiroDecisao {
    this.ciclos++

    if (isStable(from) && !isStable(to)) {
      if (this.ciclos % 3 === 0) {
        return { gostou: true, par, fromToken: from, toToken: to, confianca: 65, motivo: `${to} volátil — entrada agressiva (ciclo ${this.ciclos})` }
      }
      return { gostou: true, par, fromToken: from, toToken: to, confianca: 45, motivo: `${to} — rotação de portfólio` }
    }

    if (isStable(from) && isStable(to) && precoAtual && precoAtual > 0) {
      return { gostou: true, par, fromToken: from, toToken: to, confianca: 50, motivo: `Swap stable-stable (preço: ${precoAtual})` }
    }

    return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: "Sem sinal tático" }
  }
}

export const tendenciaPregueiro = new TendênciaPregueiro()
export const volumePregueiro = new VolumePregueiro()
export const sentimentoPregueiro = new SentimentoPregueiro()
export const taticoPregueiro = new TáticoPregueiro()

export const PREGUEIROS = [tendenciaPregueiro, volumePregueiro, sentimentoPregueiro, taticoPregueiro]

function gerarParLabel(from: string, to: string): string {
  return `${from}→${to}`
}

export async function executarCicloPregueiros(rede?: string) {
  await Promise.all([
    volumePregueiro.atualizarMercado(),
    sentimentoPregueiro.atualizarSentimento()
  ])

  const redesParaEscalar: NetworkKey[] = rede ? [rede as NetworkKey] : ["arc"]

  // Limpa posições fantasmas de redes inativas a cada ciclo
  positionManager.cleanupInactiveNetworks(redesParaEscalar)

  // Alimenta o volatility tracker com preços dos tokens desta rede
  const tokensParaColetar = new Set<TokenSymbol>()
  for (const redeAtual of redesParaEscalar) {
    const pairs = TRADING_PAIRS[redeAtual]
    if (pairs) {
      for (const p of pairs) {
        tokensParaColetar.add(p.from)
        tokensParaColetar.add(p.to)
      }
    }
  }
  volatilityTracker.collectPrices([...tokensParaColetar]).catch(() => {})

  for (const pregueiro of PREGUEIROS) {
    for (const redeAtual of redesParaEscalar) {
      if (!pregueiro.config.redes.includes(redeAtual)) continue

      const pairs = TRADING_PAIRS[redeAtual as NetworkKey]
      if (!pairs) continue

      for (const pair of pairs) {
        const par = gerarParLabel(pair.from, pair.to)
        let decisao: PregueiroDecisao

        if (pregueiro instanceof TendênciaPregueiro) {
          const stats = await pairPriceFeed.getPairStats(pair.from, pair.to, isStable)
          decisao = pregueiro.analisar(par, pair.from, pair.to, stats.relativePrice)
        } else if (pregueiro instanceof TáticoPregueiro) {
          decisao = pregueiro.analisar(par, pair.from, pair.to)
        } else if (pregueiro instanceof VolumePregueiro) {
          decisao = pregueiro.analisar(par, pair.from, pair.to)
        } else if (pregueiro instanceof SentimentoPregueiro) {
          decisao = pregueiro.analisar(par, pair.from, pair.to)
        } else {
          continue
        }

        if (decisao.gostou) {
          const signal: OkSignal = {
            pregueiro: pregueiro.config.nome,
            rede: redeAtual,
            par: decisao.par,
            confianca: decisao.confianca,
            timestamp: Date.now(),
            fromToken: decisao.fromToken,
            toToken: decisao.toToken
          }
          // Máximo de 3 posições simultâneas
          const comprandoVolatil = isStable(decisao.fromToken) && !isStable(decisao.toToken)
          const MAX_POSICOES = 3
          if (comprandoVolatil && positionManager.getOpenPositions().length >= MAX_POSICOES) {
            console.log(`⏳ ${pregueiro.config.nome} — ${MAX_POSICOES} posições atingidas, aguardando vaga`)
            continue
          }
          pregão.receberOK(signal)
        }
      }
    }
  }

  // 🔄 Reconcilia saldos on-chain: cria posições órfãs para tokens não rastreados
  for (const redeAtual of redesParaEscalar) {
    const pairs = TRADING_PAIRS[redeAtual]
    if (!pairs) continue
    const volatileTokens = [...new Set(pairs.map(p => [p.from, p.to]).flat())]
      .filter(t => !isStable(t)) as TokenSymbol[]
    await positionManager.reconcileBalances(redeAtual, volatileTokens)
  }

  // ─── Staircase: verifica posições abertas e fecha se cair 2 degraus ───
  await verificarStaircaseFechamento(redesParaEscalar)
}

// Verifica posições abertas de cada rede e aciona fechamento via staircase
async function verificarStaircaseFechamento(redes: NetworkKey[]) {
  staircaseCloseSent.clear()
  const posicoes = positionManager.getOpenPositions()
    .filter(p => redes.includes(p.networkKey) && p.status === "open")

  for (const pos of posicoes) {
    const currentPrice = await positionManager.fetchTokenPrice(pos.boughtToken)

    // Níveis dinâmicos baseados na volatilidade real do token
    const levels = volatilityTracker.suggestLevels(pos.boughtToken)
    const acao = positionManager.staircaseUpdate(pos.id, currentPrice, 2, levels)

    if (levels[0] === 0 && levels[1] !== 3) {
      const perfil = volatilityTracker.getProfile(pos.boughtToken)
      console.log(`🧠 VolTracker: ${perfil}`)
    }

    if (acao === "close") {
      // Debounce: evita OKs duplicados no mesmo ciclo
      if (staircaseCloseSent.has(pos.id)) continue
      staircaseCloseSent.add(pos.id)

      // Marca como fechada imediatamente para evitar acumulação
      // Se o swap falhar, o reconcile recria a posição com o saldo residual
      positionManager.closePosition(pos.id, currentPrice)

      // Vende sempre pra USDC (mais líquido, saldo unificado)
      const stableDestino = "USDC"
      const par = gerarParLabel(pos.boughtToken, stableDestino)
      const confianca = 90

      const pregueirosVirtuais = ["Staircase", "TrailingStop", "AutoClose"]
      for (const nome of pregueirosVirtuais) {
        pregão.receberOK({
          pregueiro: nome,
          rede: pos.networkKey,
          par,
          confianca,
          timestamp: Date.now(),
          fromToken: pos.boughtToken,
          toToken: stableDestino,
        })
      }
    }
  }
}