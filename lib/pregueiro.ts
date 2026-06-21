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

  // FIX: Volume vota em apenas UM par por ciclo — o melhor par volátil disponível
  // Antes: votava em todos os pares, gerando ruído
  // Agora: só vota se volume alto E escolhe o par com maior potencial
  analisarMelhorPar(pares: Array<{ from: string; to: string; par: string }>): PregueiroDecisao | null {
    const { ratio, momentum } = this.dadoMercado

    if (ratio <= 5 || momentum <= 0) return null

    // Prefere pares voláteis (stable→volatil) quando volume alto
    const volateis = pares.filter(p => isStable(p.from) && !isStable(p.to))
    if (volateis.length === 0) return null

    const best = volateis[0]
    const conf = Math.min(80, 45 + ratio * 3)
    return {
      gostou: true,
      par: best.par,
      fromToken: best.from,
      toToken: best.to,
      confianca: Math.round(conf),
      motivo: `Volume alto (${ratio.toFixed(1)}% cap) — ${best.to}`
    }
  }

  // Mantido para compatibilidade mas não usado no ciclo principal
  analisar(_par: string, from: string, to: string): PregueiroDecisao {
    const { ratio, momentum } = this.dadoMercado
    const par = `${from}→${to}`
    if (ratio > 5 && momentum > 0) {
      const conf = Math.min(80, 45 + ratio * 3)
      return { gostou: true, par, fromToken: from, toToken: to, confianca: Math.round(conf), motivo: `Volume alto (${ratio.toFixed(1)}% cap)` }
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

  async atualizarSentimento() {
    try {
      const res = await fetch("/api/market-data", { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      this.fearGreed = data.fearGreed?.value ?? 50
    } catch {}
  }

  // FIX: Sentimento agora tem DIREÇÃO clara — vota em apenas um par com direção definida
  // Antes: votava em compra E venda para o mesmo token simultaneamente
  // Agora: F&G > 65 → só compra volátil | F&G < 35 → só vende volátil
  analisarMelhorPar(pares: Array<{ from: string; to: string; par: string }>): PregueiroDecisao | null {
    const fg = this.fearGreed

    // Mercado otimista (ganância) → compra o melhor token volátil disponível
    if (fg > 65) {
      const candidatos = pares.filter(p => isStable(p.from) && !isStable(p.to))
      if (candidatos.length === 0) return null
      const best = candidatos[0]
      const conf = Math.min(75, 40 + (fg - 50) * 1.5)
      return {
        gostou: true,
        par: best.par,
        fromToken: best.from,
        toToken: best.to,
        confianca: Math.round(conf),
        motivo: `Mercado otimista — comprando ${best.to} (F&G: ${fg})`
      }
    }

    // Medo extremo → vende volátil para stable (proteção)
    if (fg < 25) {
      const candidatos = pares.filter(p => !isStable(p.from) && isStable(p.to))
      if (candidatos.length === 0) return null
      const best = candidatos[0]
      const conf = Math.min(80, 50 + (50 - fg) * 1.2)
      return {
        gostou: true,
        par: best.par,
        fromToken: best.from,
        toToken: best.to,
        confianca: Math.round(conf),
        motivo: `Medo extremo — vendendo ${best.from} (F&G: ${fg})`
      }
    }

    // Medo moderado → compra volátil (oportunidade de entrada)
    if (fg < 35) {
      const candidatos = pares.filter(p => isStable(p.from) && !isStable(p.to))
      if (candidatos.length === 0) return null
      const best = candidatos[0]
      return {
        gostou: true,
        par: best.par,
        fromToken: best.from,
        toToken: best.to,
        confianca: 55,
        motivo: `Oportunidade de compra — mercado com medo (F&G: ${fg})`
      }
    }

    // Sentimento neutro → sem voto
    return null
  }

  // Mantido para compatibilidade
  analisar(_par: string, from: string, to: string): PregueiroDecisao {
    const par = `${from}→${to}`
    return { gostou: false, par, fromToken: from, toToken: to, confianca: 0, motivo: `Sentimento neutro (F&G: ${this.fearGreed})` }
  }
}

class TáticoPregueiro {
  readonly config: PregueiroConfig = {
    nome: "Tático",
    apelido: "Pregueiro Tático",
    cor: "#fbbf24",
    icone: "⚡",
    redes: ["arc", "base", "polygon"]
  }

  private ciclos = 0

  // FIX: Tático agora escolhe UM par por ciclo (rotação cíclica)
  // Antes: votava em todos os pares estável→volátil sempre
  // Agora: rotaciona entre pares por ciclo para diversificar
  analisarMelhorPar(pares: Array<{ from: string; to: string; par: string }>): PregueiroDecisao | null {
    this.ciclos++

    const volateis = pares.filter(p => isStable(p.from) && !isStable(p.to))
    if (volateis.length === 0) return null

    // Rotaciona entre os pares voláteis a cada ciclo
    const idx = (this.ciclos - 1) % volateis.length
    const escolhido = volateis[idx]

    const confianca = this.ciclos % 3 === 0 ? 65 : 45
    const motivo = this.ciclos % 3 === 0
      ? `${escolhido.to} — entrada agressiva (ciclo ${this.ciclos})`
      : `${escolhido.to} — rotação de portfólio (ciclo ${this.ciclos})`

    return {
      gostou: true,
      par: escolhido.par,
      fromToken: escolhido.from,
      toToken: escolhido.to,
      confianca,
      motivo
    }
  }

  // Mantido para compatibilidade
  analisar(par: string, from: string, to: string, precoAtual?: number): PregueiroDecisao {
    this.ciclos++
    if (isStable(from) && !isStable(to)) {
      const confianca = this.ciclos % 3 === 0 ? 65 : 45
      return { gostou: true, par, fromToken: from, toToken: to, confianca, motivo: `${to} — rotação` }
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
  // Ativa oracle Stork na Arc Testnet para preços on-chain
  if (rede === "arc") {
    pairPriceFeed.setUseStork(true)
  } else {
    pairPriceFeed.setUseStork(false)
  }

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

  for (const redeAtual of redesParaEscalar) {
    if (!TRADING_PAIRS[redeAtual as NetworkKey]) continue
    const pairs = TRADING_PAIRS[redeAtual as NetworkKey]

    // Verifica vagas antes de processar compras
    const posAbertas = positionManager.getOpenPositions().length
    const MAX_POSICOES = 10
    const temVaga = posAbertas < MAX_POSICOES

    // Monta lista de pares para análise
    const listaPares = pairs.map(p => ({
      from: p.from,
      to: p.to,
      par: gerarParLabel(p.from, p.to)
    }))

    // ── Tendência: analisa todos os pares e vota no melhor ──
    if (tendenciaPregueiro.config.redes.includes(redeAtual as NetworkKey)) {
      let melhorTendencia: { decisao: PregueiroDecisao; score: number } | null = null

      for (const pair of pairs) {
        const par = gerarParLabel(pair.from, pair.to)
        const stats = await pairPriceFeed.getPairStats(pair.from, pair.to, isStable)
        const decisao = tendenciaPregueiro.analisar(par, pair.from, pair.to, stats.relativePrice)

        if (decisao.gostou) {
          const comprandoVolatil = isStable(pair.from) && !isStable(pair.to)
          // Não vota em compra se sem vaga
          if (comprandoVolatil && !temVaga) continue

          const score = decisao.confianca
          if (!melhorTendencia || score > melhorTendencia.score) {
            melhorTendencia = { decisao, score }
          }
        }
      }

      // Envia OK apenas para o melhor par
      if (melhorTendencia) {
        pregão.receberOK({
          pregueiro: tendenciaPregueiro.config.nome,
          rede: redeAtual,
          par: melhorTendencia.decisao.par,
          confianca: melhorTendencia.decisao.confianca,
          timestamp: Date.now(),
          fromToken: melhorTendencia.decisao.fromToken,
          toToken: melhorTendencia.decisao.toToken
        })
      }
    }

    // ── Volume: vota em apenas 1 par se volume alto ──
    if (volumePregueiro.config.redes.includes(redeAtual as NetworkKey) && temVaga) {
      const decisaoVolume = volumePregueiro.analisarMelhorPar(listaPares)
      if (decisaoVolume) {
        pregão.receberOK({
          pregueiro: volumePregueiro.config.nome,
          rede: redeAtual,
          par: decisaoVolume.par,
          confianca: decisaoVolume.confianca,
          timestamp: Date.now(),
          fromToken: decisaoVolume.fromToken,
          toToken: decisaoVolume.toToken
        })
      }
    }

    // ── Sentimento: vota em 1 par com direção clara ──
    if (sentimentoPregueiro.config.redes.includes(redeAtual as NetworkKey)) {
      const decisaoSentimento = sentimentoPregueiro.analisarMelhorPar(listaPares)
      if (decisaoSentimento) {
        const comprandoVolatil = isStable(decisaoSentimento.fromToken) && !isStable(decisaoSentimento.toToken)
        // Só bloqueia compra se sem vaga; venda sempre passa
        if (!comprandoVolatil || temVaga) {
          pregão.receberOK({
            pregueiro: sentimentoPregueiro.config.nome,
            rede: redeAtual,
            par: decisaoSentimento.par,
            confianca: decisaoSentimento.confianca,
            timestamp: Date.now(),
            fromToken: decisaoSentimento.fromToken,
            toToken: decisaoSentimento.toToken
          })
        }
      }
    }

    // ── Tático: rotaciona entre pares por ciclo ──
    if (taticoPregueiro.config.redes.includes(redeAtual as NetworkKey) && temVaga) {
      const decisaoTatico = taticoPregueiro.analisarMelhorPar(listaPares)
      if (decisaoTatico) {
        pregão.receberOK({
          pregueiro: taticoPregueiro.config.nome,
          rede: redeAtual,
          par: decisaoTatico.par,
          confianca: decisaoTatico.confianca,
          timestamp: Date.now(),
          fromToken: decisaoTatico.fromToken,
          toToken: decisaoTatico.toToken
        })
      }
    }
  }

  // 🔄 Reconcilia saldos on-chain
  for (const redeAtual of redesParaEscalar) {
    const pairs = TRADING_PAIRS[redeAtual]
    if (!pairs) continue
    const volatileTokens = [...new Set(pairs.map(p => [p.from, p.to]).flat())]
      .filter(t => !isStable(t)) as TokenSymbol[]
    await positionManager.reconcileBalances(redeAtual, volatileTokens)
  }

  // ─── Staircase ───
  await verificarStaircaseFechamento(redesParaEscalar)
}

async function verificarStaircaseFechamento(redes: NetworkKey[]) {
  staircaseCloseSent.clear()
  const posicoes = positionManager.getOpenPositions()
    .filter(p => redes.includes(p.networkKey) && p.status === "open")

  for (const pos of posicoes) {
    const currentPrice = await positionManager.fetchTokenPrice(pos.boughtToken)
    const acao = await positionManager.staircaseUpdate(pos.id, currentPrice)

    if (acao === "close") {
      if (staircaseCloseSent.has(pos.id)) continue
      staircaseCloseSent.add(pos.id)

      positionManager.closePosition(pos.id, currentPrice)

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