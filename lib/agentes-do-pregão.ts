import { quantumAgent, technicalAgent, synthesisAgent } from "./multi-agent-system"
import { quantumWaveTrader } from "./quantum-wave"
import { pregão } from "./pregão"
import { NETWORKS, TRADING_PAIRS, realSwap, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { positionManager } from "./position-manager"
import { volatilityTracker } from "./volatility-tracker"
import { accountant } from "./accountant"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

// ── Sala de aula: aprendizado simulado dos votos ──
interface VotoRegistro {
  agentName: string
  fromToken: string
  toToken: string
  priceAtVote: number
  confidence: number
  action: "buy" | "sell"
  timestamp: number
  networkKey: string
}
const historicoVotos: VotoRegistro[] = []
const MIN_AVALIACAO_MS = 5 * 60 * 1000  // avalia votos com 5+ min de idade

function registrarVoto(voto: VotoRegistro) {
  historicoVotos.push(voto)
  if (historicoVotos.length > 500) historicoVotos.splice(0, 100)
  // Persiste no localStorage
  try { localStorage.setItem("arcflow_vote_history", JSON.stringify(historicoVotos.slice(-200))) } catch {}
}

async function avaliarVotosPassados(redeAtual: NetworkKey) {
  const agora = Date.now()
  const avaliados = new Set<string>()
  for (const voto of historicoVotos) {
    if (voto.networkKey !== redeAtual) continue
    if (agora - voto.timestamp < MIN_AVALIACAO_MS) continue
    const id = `${voto.agentName}_${voto.timestamp}`
    if (avaliados.has(id)) continue
    avaliados.add(id)

    const tokenVolatil = voto.action === "buy" ? voto.toToken : voto.fromToken
    if (STABLES.has(tokenVolatil)) continue  // stable-stable não avalia

    const priceAgora = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol)
    if (priceAgora <= 0 || voto.priceAtVote <= 0) continue

    let profitPercent = 0
    if (voto.action === "buy") {
      // Recomendou comprar: lucro se preço subiu
      profitPercent = ((priceAgora - voto.priceAtVote) / voto.priceAtVote) * 100
    } else {
      // Recomendou vender: lucro se preço caiu
      profitPercent = ((voto.priceAtVote - priceAgora) / voto.priceAtVote) * 100
    }

    const simulatedAmount = 5  // $5 fictício para aprendizado
    const simulatedProfit = simulatedAmount * (profitPercent / 100)

    accountant.addReport({
      id: `sim_${voto.agentName}_${voto.timestamp}`,
      agentName: voto.agentName,
      action: voto.action,
      fromToken: voto.fromToken,
      toToken: voto.toToken,
      amount: simulatedAmount,
      toAmount: simulatedAmount + simulatedProfit,
      profit: simulatedProfit,
      profitPercent,
      entryPrice: voto.priceAtVote,
      exitPrice: priceAgora,
      status: "completed",
      duration: agora - voto.timestamp,
      timestamp: agora,
      networkKey: redeAtual,
    })
  }
  if (avaliados.size > 0) {
    pregão.adicionarLog(`📚 Sala de aula: ${avaliados.size} votos avaliados — agentes aprendendo sem trade real`)
  }
  // Limpa votos já avaliados
  for (let i = historicoVotos.length - 1; i >= 0; i--) {
    if (avaliados.has(`${historicoVotos[i].agentName}_${historicoVotos[i].timestamp}`)) {
      historicoVotos.splice(i, 1)
    }
  }
}

export const AGENTES_NOMES = [
  { nome: "Quantum", icone: "🔮" },
  { nome: "Technical", icone: "📈" },
  { nome: "TrendFollower", icone: "📶" },
  { nome: "MeanReversion", icone: "🔄" },
  { nome: "QuantumTrader", icone: "⚛️" },
  { nome: "ArbitrageHunter", icone: "🎯" },
  { nome: "MarketMaker", icone: "🏦" },
  { nome: "BTCTrader", icone: "₿" },
  { nome: "Liquidator", icone: "💧" },
  { nome: "MomentumTrader", icone: "🚀" },
  { nome: "NVIDIAgent", icone: "🧠" },
  { nome: "Synthesis", icone: "🔬" },
]

export const AGENTE_CORES = [
  "#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24",
  "#fb923c", "#e879f9", "#f97316", "#22d3ee", "#f43f5e",
  "#f59e0b", "#10b981",
]

async function getTokenPrice(token: TokenSymbol): Promise<number> {
  const coinIds: Record<string, string> = {
    WETH: "ethereum", WMATIC: "matic-network", ARB: "arbitrum",
    WBTC: "bitcoin", USDC: "usd-coin", EURC: "eurc",
  }
  const coinId = coinIds[token]
  if (!coinId) return 1.0
  try {
    const res = await fetch(`/api/price?ids=${coinId}`)
    if (!res.ok) return 1.0
    const data = await res.json()
    return data[coinId] ?? 1.0
  } catch { return 1.0 }
}

export interface AgentPairVote {
  agentName: string
  pair: string
  fromToken: TokenSymbol
  toToken: TokenSymbol
  network: NetworkKey
  confidence: number
  action: "buy" | "sell"
  reason: string
}

export interface CicloResultado {
  totalPairs: number
  votes: AgentPairVote[]
  agreedPair: AgentPairVote | null
  agreeingAgents: number
  waveCollapsed: boolean
}

export async function executarCicloAgentes(rede?: string, amountUsd: number = 5): Promise<CicloResultado> {
  const redeAtual = (rede ?? "arc") as NetworkKey
  const net = NETWORKS[redeAtual]
  const pairs = TRADING_PAIRS[redeAtual]
  if (!pairs || !net) {
    console.warn(`[AGENTES] Rede ${redeAtual} não configurada`)
    return { totalPairs: 0, votes: [], agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }

  // 📚 Sala de aula: avalia votos passados contra preço atual
  await avaliarVotosPassados(redeAtual)

  // Mainnet: usar saldo real disponível (não $5 fixo)
  if (!net.isTestnet) {
    const balUSDC = realSwap.getBalance("USDC");
    const balUSDT = realSwap.getBalance("USDT");
    const balDAI  = realSwap.getBalance("DAI");
    const maiorStable = Math.max(balUSDC, balUSDT, balDAI);
    // Verificar se temos posição aberta (token volátil)
    const openPos = positionManager.getOpenPositions().find(p => p.status === "open" && p.networkKey === redeAtual);
    if (openPos) {
      const balVol = realSwap.getBalance(openPos.boughtToken as TokenSymbol);
      amountUsd = balVol > 0.1 ? balVol * 9999 : Math.max(maiorStable, 5); // preço alto força findBestPair a usar o saldo real
    } else {
      amountUsd = Math.max(maiorStable, 5);
      // Ajusta tamanho da posição pela volatilidade do par sendo negociado
      const volMult = volatilityTracker.getPositionSizeMultiplier(pairs[0]?.to ?? "USDC")
      if (volMult < 1.0) {
        const original = amountUsd
        amountUsd = Math.max(5, Math.round((amountUsd * volMult) * 100) / 100)
        pregão.adicionarLog(`🧠 VolTracker: posição ajustada $${original.toFixed(2)} → $${amountUsd.toFixed(2)} (vol mult ${volMult.toFixed(1)}x)`)
      }
    }
  }

  // 1. Broadcast quantum wave com todos os pares
  const wave = await quantumWaveTrader.broadcastIntent(amountUsd)
  const wavePairs = wave.pairs.filter(p => p.network === redeAtual)

  const votes: AgentPairVote[] = []

  // Alimenta volatility tracker com preços dos tokens da rede
  const tokensParaColetar = new Set<TokenSymbol>()
  for (const p of pairs) {
    tokensParaColetar.add(p.from); tokensParaColetar.add(p.to)
  }
  volatilityTracker.collectPrices([...tokensParaColetar]).catch(() => {})

  // 🔄 Reconcilia saldos on-chain para criar posições órfãs nesta rede
  const volatileParaRede = [...tokensParaColetar].filter(t => !STABLES.has(t))
  await positionManager.reconcileBalances(redeAtual, volatileParaRede)

  // 3. Cada agente avalia os pares

  // ── QuantumAgent: avalia cada par, escolhe o melhor ──
  const quantumScores: { wp: typeof wavePairs[0]; confidence: number }[] = []
  for (const wp of wavePairs) {
    if (wp.fromToken === wp.toToken) continue
    const result = await quantumAgent.evaluatePair(wp)
    if (result && result.confidence >= 30) {
      quantumScores.push({ wp, confidence: result.confidence })
    }
  }
  const quantumBest = quantumScores.sort((a, b) => b.confidence - a.confidence)[0]
  if (quantumBest) {
    votes.push({
      agentName: "Quantum",
      pair: quantumBest.wp.label,
      fromToken: quantumBest.wp.fromToken,
      toToken: quantumBest.wp.toToken,
      network: quantumBest.wp.network,
      confidence: quantumBest.confidence,
      action: quantumBest.wp.momentum > 0 ? "buy" : "sell",
      reason: `Onda quântica: amplitude ${(quantumBest.wp.amplitude * 100).toFixed(0)}%`,
    })
  }

  // ── TechnicalAgent: RSI real, escolhe o melhor ──
  const techScores: { wp: typeof wavePairs[0]; action: "buy" | "sell"; confidence: number }[] = []
  for (const wp of wavePairs) {
    if (wp.fromToken === wp.toToken) continue
    const mockPrices = [1.0, 1.001, 0.999, 1.002, 1.0 + wp.momentum * 10]
    const indicators = technicalAgent.calculateIndicators(mockPrices)
    const rsi = indicators.rsi
    const rsiAction: "buy" | "sell" | "hold" = rsi < 35 ? "buy" : rsi > 65 ? "sell" : "hold"
    if (rsiAction === "hold") continue
    const confidence = Math.round(40 + Math.abs(rsi - 50) * 0.8)
    techScores.push({ wp, action: rsiAction, confidence: Math.min(90, confidence) })
  }
  const techBest = techScores.sort((a, b) => b.confidence - a.confidence)[0]
  if (techBest) {
    votes.push({
      agentName: "Technical",
      pair: techBest.wp.label,
      fromToken: techBest.wp.fromToken,
      toToken: techBest.wp.toToken,
      network: techBest.wp.network,
      confidence: techBest.confidence,
      action: techBest.action,
      reason: `RSI: ${((techBest.wp.momentum * 100).toFixed(0))} — ${techBest.action === "buy" ? "sobrevendido" : "sobrecomprado"}`,
    })
  }

  // ── TrendFollower: segue a tendência (momentum) ──
  const trendPairs = wavePairs
    .filter(wp => wp.fromToken !== wp.toToken && Math.abs(wp.momentum) > 0.02)
    .sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum))
  if (trendPairs.length > 0) {
    const best = trendPairs[0]
    votes.push({
      agentName: "TrendFollower",
      pair: best.label,
      fromToken: best.fromToken,
      toToken: best.toToken,
      network: best.network,
      confidence: Math.min(90, Math.round(40 + Math.abs(best.momentum) * 500)),
      action: best.momentum > 0 ? "buy" : "sell",
      reason: `Trend ${best.momentum > 0 ? "🠕" : "🠗"} momentum ${(best.momentum * 100).toFixed(1)}%`,
    })
  }

  // ── MeanReversion: amplitude elevada = reversão. amplitude é sempre >= 0 (força
  // do sinal), então a direção da aposta vem do sinal do momentum: subiu muito →
  // aposta que vai recuar (sell); caiu muito → aposta que vai recuperar (buy).
  const meanRevPairs = wavePairs
    .filter(wp => wp.fromToken !== wp.toToken && wp.amplitude > 0.03)
    .sort((a, b) => b.amplitude - a.amplitude)
  if (meanRevPairs.length > 0) {
    const best = meanRevPairs[0]
    votes.push({
      agentName: "MeanReversion",
      pair: best.label,
      fromToken: best.fromToken,
      toToken: best.toToken,
      network: best.network,
      confidence: Math.min(90, Math.round(35 + best.amplitude * 400)),
      action: best.momentum > 0 ? "sell" : "buy",
      reason: `Reversão: amplitude ${(best.amplitude * 100).toFixed(1)}% — ${best.momentum > 0 ? "subiu, pode recuar" : "caiu, pode recuperar"}`,
    })
  }

  // ── Strategy Agents (do TradingNanopayment) ──
  // Cada um escolhe o melhor par pela sua estratégia e vota

  // ── QuantumTrader: findBestPair (direção do lucro) + wave fallback ──
  try {
    const bestPairResult = await realSwap.findBestPair(amountUsd)
    if (bestPairResult && amountUsd > 0) {
      votes.push({
        agentName: "QuantumTrader",
        pair: bestPairResult.pair.label,
        fromToken: bestPairResult.pair.from,
        toToken: bestPairResult.pair.to,
        network: redeAtual,
        confidence: Math.min(80, 40 + Math.abs(bestPairResult.expectedProfit) * 100),
        action: bestPairResult.expectedProfit >= 0 ? "buy" : "sell",
        reason: `LI.FI ${bestPairResult.pair.label} ${bestPairResult.expectedProfit >= 0 ? "+" : ""}$${bestPairResult.expectedProfit.toFixed(4)}`,
      })
    }
  } catch { /* fallback abaixo */ }
  if (!votes.some(v => v.agentName === "QuantumTrader")) {
    const waveBest = wavePairs.filter(wp => wp.fromToken !== wp.toToken)
      .sort((a, b) => b.probability * b.liquidity - a.probability * a.liquidity)[0]
    if (waveBest) {
      votes.push({
        agentName: "QuantumTrader",
        pair: waveBest.label,
        fromToken: waveBest.fromToken,
        toToken: waveBest.toToken,
        network: redeAtual,
        confidence: Math.min(90, Math.round(waveBest.probability)),
        action: waveBest.momentum > 0 ? "buy" : "sell",
        reason: `Wave: ${waveBest.label} (prob: ${waveBest.probability.toFixed(0)}%)`,
      })
    }
  }

  // ── Preços com spread COM SINAL ──
  const pairsWithPrice = await Promise.all(
    pairs.map(async p => {
      const fromPrice = await getTokenPrice(p.from)
      const toPrice = await getTokenPrice(p.to)
      const signedSpread = ((toPrice - fromPrice) / fromPrice) * 100
      return { pair: p, signedSpread, absSpread: Math.abs(signedSpread), isStableStable: STABLES.has(p.from) && STABLES.has(p.to) }
    })
  )

  // ── ArbitrageHunter: maior spread absoluto entre stables, direção correta ──
  const stableStable = pairsWithPrice.filter(p => p.isStableStable).sort((a, b) => b.absSpread - a.absSpread)
  if (stableStable.length > 0 && stableStable[0].absSpread > 0.01) {
    const best = stableStable[0]
    votes.push({
      agentName: "ArbitrageHunter",
      pair: best.pair.label,
      fromToken: best.pair.from,
      toToken: best.pair.to,
      network: redeAtual,
      confidence: Math.min(75, Math.round(30 + best.absSpread * 10)),
      action: best.signedSpread > 0 ? "sell" : "buy",
      reason: `Arbitragem ${best.pair.label} (${best.signedSpread > 0 ? "toToken caro" : "fromToken caro"}, spread ${best.absSpread.toFixed(3)}%)`,
    })
  } else {
    const waveBest = wavePairs.filter(wp => STABLES.has(wp.fromToken) && STABLES.has(wp.toToken))
      .sort((a, b) => Math.abs(b.amplitude) - Math.abs(a.amplitude))[0]
    if (waveBest) {
      votes.push({
        agentName: "ArbitrageHunter",
        pair: waveBest.label,
        fromToken: waveBest.fromToken,
        toToken: waveBest.toToken,
        network: redeAtual,
        confidence: 40,
        action: waveBest.amplitude > 0 ? "sell" : "buy",
        reason: `Onda ${waveBest.label} (amplitude ${(waveBest.amplitude * 100).toFixed(1)}%)`,
      })
    }
  }

  // ── MarketMaker: voláteis com spread com sinal ──
  const volatilePairs = pairsWithPrice.filter(p => !p.isStableStable)
  if (volatilePairs.length > 0) {
    const best = volatilePairs.sort((a, b) => b.absSpread - a.absSpread)[0]
    if (best.absSpread > 0.01) {
      votes.push({
        agentName: "MarketMaker",
        pair: best.pair.label,
        fromToken: best.pair.from,
        toToken: best.pair.to,
        network: redeAtual,
        confidence: 60,
        action: best.signedSpread > 0 ? "sell" : "buy",
        reason: `Volátil ${best.pair.label} ${best.signedSpread > 0 ? "🠕" : "🠗"} (${best.absSpread.toFixed(3)}%)`,
      })
    }
  }
  if (!votes.some(v => v.agentName === "MarketMaker")) {
    const mmWave = wavePairs.filter(wp => wp.fromToken !== wp.toToken)
      .sort((a, b) => b.volatility - a.volatility)[0]
    if (mmWave) {
      votes.push({
        agentName: "MarketMaker",
        pair: mmWave.label,
        fromToken: mmWave.fromToken,
        toToken: mmWave.toToken,
        network: redeAtual,
        confidence: 45,
        action: mmWave.momentum > 0 ? "sell" : "buy",
        reason: `Vol wave ${mmWave.label} (vol ${(mmWave.volatility * 100).toFixed(1)}%)`,
      })
    }
  }

  // ── BTCTrader: pares BTC/ETH com spread com sinal ──
  const btcEthPairs = pairsWithPrice.filter(p =>
    (p.pair.from === "WBTC" || p.pair.to === "WBTC" ||
     p.pair.from === "WETH" || p.pair.to === "WETH")
  )
  if (btcEthPairs.length > 0) {
    const best = btcEthPairs.sort((a, b) => b.absSpread - a.absSpread)[0]
    if (best.absSpread > 0.01) {
      votes.push({
        agentName: "BTCTrader",
        pair: best.pair.label,
        fromToken: best.pair.from,
        toToken: best.pair.to,
        network: redeAtual,
        confidence: 65,
        action: best.signedSpread > 0 ? "sell" : "buy",
        reason: `BTC/ETH ${best.pair.label} ${best.signedSpread > 0 ? "🠕" : "🠗"}`,
      })
    }
  }
  if (!votes.some(v => v.agentName === "BTCTrader")) {
    const btcWave = wavePairs.filter(wp =>
      (wp.fromToken === "WBTC" || wp.toToken === "WBTC" ||
       wp.fromToken === "WETH" || wp.toToken === "WETH")
    ).sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum))[0]
    if (btcWave) {
      votes.push({
        agentName: "BTCTrader",
        pair: btcWave.label,
        fromToken: btcWave.fromToken,
        toToken: btcWave.toToken,
        network: redeAtual,
        confidence: 50,
        action: btcWave.momentum > 0 ? "sell" : "buy",
        reason: `BTC/ETH wave ${btcWave.label} ${btcWave.momentum > 0 ? "🠕" : "🠗"}`,
      })
    } else {
      // Sem BTC/ETH — vota no par com maior momentum
      const anyWave = wavePairs.filter(wp => wp.fromToken !== wp.toToken)
        .sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum))[0]
      if (anyWave) {
        votes.push({
          agentName: "BTCTrader",
          pair: anyWave.label,
          fromToken: anyWave.fromToken,
          toToken: anyWave.toToken,
          network: redeAtual,
          confidence: 40,
          action: anyWave.momentum > 0 ? "sell" : "buy",
          reason: `Momentum ${anyWave.label} ${anyWave.momentum > 0 ? "🠕" : "🠗"}`,
        })
      }
    }
  }

  // ── Liquidator: maior liquidez → trade mais seguro ──
  const liquidPair = wavePairs
    .filter(wp => wp.fromToken !== wp.toToken)
    .sort((a, b) => b.liquidity - a.liquidity)[0]
  if (liquidPair) {
    votes.push({
      agentName: "Liquidator",
      pair: liquidPair.label,
      fromToken: liquidPair.fromToken,
      toToken: liquidPair.toToken,
      network: redeAtual,
      confidence: Math.round(liquidPair.liquidity * 60),
      action: liquidPair.momentum > 0 ? "buy" : "sell",
      reason: `Liquidez ${(liquidPair.liquidity * 100).toFixed(0)}% — ${liquidPair.label}`,
    })
  }

  // ── MomentumTrader: volatilidade × momentum (movimentos explosivos) ──
  const momentumPairs = wavePairs
    .filter(wp => wp.fromToken !== wp.toToken)
    .map(wp => ({ wp, score: Math.abs(wp.momentum) * wp.volatility }))
    .filter(p => p.score > 0.005)
    .sort((a, b) => b.score - a.score)
  if (momentumPairs.length > 0) {
    const best = momentumPairs[0]
    votes.push({
      agentName: "MomentumTrader",
      pair: best.wp.label,
      fromToken: best.wp.fromToken,
      toToken: best.wp.toToken,
      network: redeAtual,
      confidence: Math.min(90, Math.round(40 + best.score * 2000)),
      action: best.wp.momentum > 0 ? "buy" : "sell",
      reason: `Momento × vol = ${(best.score * 10000).toFixed(0)} — ${best.wp.momentum > 0 ? "🠕🠕" : "🠗🠗"}`,
    })
  }

  // ── NVIDIAgent: LLM decide (simplificado via wave data) ──
  const bestWavePair = wavePairs
    .filter(wp => wp.fromToken !== wp.toToken)
    .sort((a, b) => b.probability * b.liquidity - a.probability * a.liquidity)[0]
  if (bestWavePair) {
    votes.push({
      agentName: "NVIDIAgent",
      pair: bestWavePair.label,
      fromToken: bestWavePair.fromToken,
      toToken: bestWavePair.toToken,
      network: redeAtual,
      confidence: Math.min(90, Math.round(bestWavePair.probability)),
      action: bestWavePair.momentum > 0 ? "buy" : "sell",
      reason: `NIM: ondas de probabilidade — ${bestWavePair.label}`,
    })
  }

  // 📚 Sala de aula: registra votos com preço atual para aprendizado futuro
  for (const v of votes) {
    const tokenVolatil = v.action === "buy" ? v.toToken : v.fromToken
    if (STABLES.has(tokenVolatil)) continue
    const precoVoto = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol).catch(() => 0)
    if (precoVoto > 0) {
      registrarVoto({
        agentName: v.agentName,
        fromToken: v.fromToken,
        toToken: v.toToken,
        priceAtVote: precoVoto,
        confidence: v.confidence,
        action: v.action,
        timestamp: Date.now(),
        networkKey: redeAtual,
      })
    }
  }

  // 🧠 Ajusta confiança com base na volatilidade real de cada token
  for (const v of votes) {
    const volToken = v.action === "buy" ? v.toToken : v.fromToken
    const mult = volatilityTracker.getConfidenceMultiplier(volToken)
    if (mult !== 1.0) {
      const original = v.confidence
      v.confidence = Math.min(90, Math.round(v.confidence * mult))
      if (v.confidence !== original) {
        pregão.adicionarLog(`🧠 ${v.agentName}: vol ajustou confiança ${original}% → ${v.confidence}% (mult ${mult.toFixed(2)}x em ${volToken})`)
      }
    }
  }

  // Aprendizado: pondera confiança pelo score histórico do agente
  const ranking = accountant.getRanking()
  const maxScore = ranking.length > 0 ? Math.max(...ranking.map(r => r.score)) : 0
  if (maxScore > 0) {
    for (const v of votes) {
      const score = accountant.getAgentScore(v.agentName)
      if (!score || score.totalTrades < 3) continue
      const scoreRatio = score.score / maxScore // 0 a 1
      const original = v.confidence
      v.confidence = Math.min(95, Math.round(v.confidence * (0.5 + scoreRatio * 0.5)))
      if (v.confidence !== original) {
        pregão.adicionarLog(`🧠 ${v.agentName}: score ${score.score.toFixed(1)} ajustou confiança ${original}% → ${v.confidence}%`)
      }
    }
  }

  // Log votes
  for (const v of votes) {
    pregão.adicionarLog(`🗳️ ${v.agentName} → ${v.pair} (${v.confidence}%)`)
  }

  // Síntese: combina todos os votos por par
  const pairScores = new Map<string, { votes: AgentPairVote[]; totalConfidence: number }>()
  for (const v of votes) {
    const key = `${v.network}:${v.pair}`
    const existing = pairScores.get(key) || { votes: [], totalConfidence: 0 }
    existing.votes.push(v)
    existing.totalConfidence += v.confidence
    pairScores.set(key, existing)
  }

  // Synthesis: escolhe o par com maior score
  let bestPair: string | null = null
  let bestScore = 0
  for (const [key, data] of pairScores) {
    const synthesisDecision = synthesisAgent.decide(
      ...data.votes.map(v => ({
        agentName: v.agentName,
        action: v.action === "buy" ? "buy" as const : "sell" as const,
        confidence: v.confidence,
        reason: v.reason,
      })),
      { agentName: "Synthesis", action: "hold" as const, confidence: 0, reason: "" }
    )
    if (synthesisDecision.action === "hold") continue
    const score = data.totalConfidence * data.votes.length
    if (score > bestScore) {
      bestScore = score
      bestPair = key
    }
  }

  if (!bestPair) {
    pregão.adicionarLog(`🤖 ${votes.length} agentes votaram mas sem consenso (>3 no mesmo par)`)
    return { totalPairs: pairs.length, votes, agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }

  // 5. Collapse quantum wave no par vencedor
  const agentConsensus = new Map<string, { pair: typeof wavePairs[0]; confidence: number }[]>()
  const bestData = pairScores.get(bestPair)!
  const winningVotes = bestData.votes

  for (const v of winningVotes) {
    const wp = wavePairs.find(p => p.label === v.pair)
    if (!wp) continue
    const list = agentConsensus.get(v.agentName) || []
    list.push({ pair: wp, confidence: v.confidence })
    agentConsensus.set(v.agentName, list)
  }

  const collapsed = quantumWaveTrader.collapseWave(wave, agentConsensus)
  if (!collapsed) {
    return { totalPairs: pairs.length, votes, agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }

  const agreedPair = winningVotes[0]

  // 6. Se 3+ agentes concordam → enviar OK ao Pregão
  const uniqueAgents = new Set(winningVotes.map(v => v.agentName))
  if (uniqueAgents.size >= 3) {
    const agentesStr = [...uniqueAgents].join(", ")
    // Só compra volátil se não houver posição aberta
    const comprandoVolatil = STABLES.has(agreedPair.fromToken) && !STABLES.has(agreedPair.toToken)
    if (comprandoVolatil && positionManager.getOpenPositions().length > 0) {
      pregão.adicionarLog(`⏳ Agentes querem ${agreedPair.pair} mas há posição aberta — aguardando fechamento com lucro`)
    } else {
      pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} (${agreedPair.fromToken}→${agreedPair.toToken})`)
      for (const v of winningVotes) {
        pregão.receberOK({
          pregueiro: `Agente:${v.agentName}`,
          rede: v.network,
          par: v.pair,
          confianca: v.confidence,
          timestamp: Date.now(),
          fromToken: v.fromToken,
          toToken: v.toToken,
        })
      }
    }
  }

  // ── Gera OKs de venda para posições abertas (realizar lucro) ──
  const todasPosicoes = positionManager.getOpenPositions()
  pregão.adicionarLog(`🔍 Total de posições abertas: ${todasPosicoes.length}`)
  const posicoesAbertas = todasPosicoes
    .filter(p => p.networkKey === redeAtual && p.status === "open")
  pregão.adicionarLog(`🔍 Posições em ${redeAtual}: ${posicoesAbertas.length}`)
  for (const pos of posicoesAbertas) {
    const currentPrice = await positionManager.fetchTokenPrice(pos.boughtToken)
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
    const confMult = volatilityTracker.getConfidenceMultiplier(pos.boughtToken)
    const sellConfidence = Math.min(90, Math.round((30 + Math.max(0, profitPercent) * 4) * confMult))
    if (sellConfidence < 35) continue

    const sellPar = `${pos.boughtToken}→USDC`
    const vendedores = uniqueAgents.size >= 2
      ? [...uniqueAgents].slice(0, 2)
      : ["Realizador", "ProfitTaker"]
    pregão.adicionarLog(`💰 Realizando lucro: ${pos.boughtToken} (${profitPercent.toFixed(1)}% → conf ${sellConfidence}%)`)
    for (const nome of vendedores) {
      pregão.receberOK({
        pregueiro: `Agente:${nome}`,
        rede: redeAtual,
        par: sellPar,
        confianca: sellConfidence,
        timestamp: Date.now(),
        fromToken: pos.boughtToken,
        toToken: "USDC",
      })
    }
  }

  return {
    totalPairs: pairs.length,
    votes,
    agreedPair,
    agreeingAgents: uniqueAgents.size,
    waveCollapsed: true,
  }
}
