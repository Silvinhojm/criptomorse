import { quantumAgent, technicalAgent, synthesisAgent } from "./multi-agent-system"
import { quantumWaveTrader } from "./quantum-wave"
import { pregão } from "./pregão"
import { NETWORKS, TRADING_PAIRS, realSwap, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { positionManager } from "./position-manager"
import { volatilityTracker } from "./volatility-tracker"
import { accountant } from "./accountant"
import { gasPriceOracle } from "./gas-price-oracle"
import { jumperLearn } from "./jumper-learn"
import { provaoRanking } from "./provao-ranking"
import { nanopaymentSystem } from "./nanopayment-system"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])
const MAX_POSITIONS = 3

// Lucro mínimo real por trade (após gas + spread)
const MIN_PROFIT_REAL = 0.05

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
let _autoResetDone = false

function registrarVoto(voto: VotoRegistro) {
  historicoVotos.push(voto)
  if (historicoVotos.length > 500) historicoVotos.splice(0, 100)
  // Persiste no localStorage
  try { localStorage.setItem("arcflow_vote_history", JSON.stringify(historicoVotos.slice(-200))) } catch {}
}

export function limparVotos() {
  historicoVotos.length = 0
  try { localStorage.removeItem("arcflow_vote_history") } catch {}
}

async function avaliarVotosPassados(redeAtual: NetworkKey) {
  const agora = Date.now()
  const net = NETWORKS[redeAtual]
  if (net?.isTestnet) {
    for (let i = historicoVotos.length - 1; i >= 0; i--) {
      if (historicoVotos[i].networkKey === redeAtual && agora - historicoVotos[i].timestamp >= MIN_AVALIACAO_MS) {
        historicoVotos.splice(i, 1)
      }
    }
    return
  }

  const avaliados = new Set<string>()
  const results: { agentName: string; stake: number }[] = []
  for (const voto of historicoVotos) {
    if (voto.networkKey !== redeAtual) continue
    if (agora - voto.timestamp < MIN_AVALIACAO_MS) continue
    const id = `${voto.agentName}_${voto.timestamp}`
    if (avaliados.has(id)) continue
    avaliados.add(id)

    const tokenVolatil = voto.action === "buy" ? voto.toToken : voto.fromToken
    const isStablePair = STABLES.has(voto.fromToken) && STABLES.has(voto.toToken)

    const priceAgora = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol)
    if (priceAgora <= 0 || voto.priceAtVote <= 0) continue

    let profitPercent = 0
    if (isStablePair) {
      // Par estável-estável: só conta como acerto se spread > 0.1%
      // Variação de 5 minutos em stablecoins é quase sempre ruído
      const spread = Math.abs(priceAgora - voto.priceAtVote) / voto.priceAtVote * 100
      if (spread < 0.1) continue  // spread muito pequeno → neutro, sem pontuação
      profitPercent = (priceAgora - voto.priceAtVote) / voto.priceAtVote * 100
    } else if (STABLES.has(tokenVolatil)) {  // stable-stable não avalia
      continue
    } else if (voto.action === "buy") {
      profitPercent = ((priceAgora - voto.priceAtVote) / voto.priceAtVote) * 100
    } else {
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

    // Pontuação competitiva: stake baseado na confiança e pontos atuais
    const score = accountant.getAgentScore(voto.agentName)
    if (score && score.points > 0) {
      const stake = score.points * (voto.confidence / 100) * 0.15
      const isCorrect = profitPercent > 0
      results.push({
        agentName: voto.agentName,
        stake: isCorrect ? stake : -stake,
      })
    }
  }

  if (results.length > 0) {
    accountant.competitiveTransfer(results)
    const winners = results.filter(r => r.stake > 0).length
    const losers = results.filter(r => r.stake < 0).length
    pregão.adicionarLog(`🏟️ Competitivo: ${winners} ganharam pontos, ${losers} perderam`)
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
  { nome: "Morse", icone: "📻" },
]

export const AGENTE_CORES = [
  "#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24",
  "#fb923c", "#e879f9", "#f97316", "#22d3ee", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4",
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
    const body = await res.json()
    const data = body.prices ?? body
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

export function getPregãoAllowedBalance(): number {
  if (typeof window === "undefined") return Infinity
  const raw = localStorage.getItem("arcflow_pregão_allowed")
  if (!raw) return Infinity
  const n = parseFloat(raw)
  return isNaN(n) || n <= 0 ? Infinity : n
}

export function setPregãoAllowedBalance(val: number): void {
  if (typeof window === "undefined") return
  localStorage.setItem("arcflow_pregão_allowed", String(val))
}

export async function executarCicloAgentes(rede?: string, amountUsd?: number): Promise<CicloResultado> {
  const redeAtual = (rede ?? "arc") as NetworkKey
  const net = NETWORKS[redeAtual]
  const pairs = TRADING_PAIRS[redeAtual]
  if (!pairs || !net) {
    console.warn(`[AGENTES] Rede ${redeAtual} não configurada`)
    return { totalPairs: 0, votes: [], agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }

  // Auto-reset: detecta streaks corrompidas pelo sistema antigo de avaliação
  // Critério: mais da metade dos agentes com streak ≤ -10 e 0 vitórias
  if (!_autoResetDone) {
    const ranking = accountant.getRanking()
    const corrupted = ranking.filter(s => s.streak <= -10 && s.wins === 0)
    if (ranking.length >= 3 && corrupted.length >= Math.ceil(ranking.length / 2)) {
      pregão.adicionarLog(`🧹 ${corrupted.length}/${ranking.length} agentes com streak ≤ -10 e 0 vitórias — resetando scores e votos históricos`)
      accountant.resetScores()
      limparVotos()
      _autoResetDone = true
      pregão.adicionarLog(`✅ Scores resetados — agentes começam do zero com o novo sistema de avaliação`)
    }
  }

  // 📖 Jumper Learn: atualiza conhecimento dos agentes (1x por hora)
  const jumperArticles = await jumperLearn.getArticles()
  if (jumperArticles.length > 0 && Math.random() < 0.1) {
    pregão.adicionarLog(`📖 Agentes consultaram Jumper Learn: ${jumperArticles[0].title} — ${jumperArticles[0].summary.slice(0, 80)}`)
  }

  // 📚 Sala de aula: avalia votos passados contra preço atual
  await avaliarVotosPassados(redeAtual)

  // Mainnet: Pregão decide o valor por trade (usa saldo permitido + saldo real)
  if (!net.isTestnet) {
    const balUSDC = realSwap.getBalance("USDC");
    const balUSDT = realSwap.getBalance("USDT");
    const balDAI  = realSwap.getBalance("DAI");
    const maiorStable = Math.max(balUSDC, balUSDT, balDAI);
    const allowed = getPregãoAllowedBalance();
    // Usa o menor entre: saldo real da wallet, saldo permitido pelo usuário
    const saldoEfetivo = allowed === Infinity ? maiorStable : Math.min(maiorStable, allowed);
    const posAbertas = positionManager.getOpenPositions().length;
    const vagas = Math.max(1, MAX_POSITIONS - posAbertas);

    if (saldoEfetivo < 5) {
      amountUsd = 0
      pregão.adicionarLog(`⚠️ Saldo efetivo $${saldoEfetivo.toFixed(2)} abaixo do mínimo $5.00 — pulando alocação`)
    } else {
      // Valor dinâmico: divide saldo disponível pelas vagas restantes
      amountUsd = (saldoEfetivo * 0.9) / vagas;

      // Ajusta pela volatilidade do par
      const volMult = volatilityTracker.getPositionSizeMultiplier(pairs[0]?.to ?? "USDC")
      if (volMult < 1.0) {
        const original = amountUsd
        amountUsd = Math.round((amountUsd * volMult) * 100) / 100
        pregão.adicionarLog(`🧠 VolTracker: trade $${original.toFixed(2)} → $${amountUsd.toFixed(2)} (vol mult ${volMult.toFixed(1)}x)`)
      }

      pregão.adicionarLog(`💰 Pregão alocou $${amountUsd.toFixed(2)} para este trade (saldo real $${maiorStable.toFixed(2)}, permitido $${allowed === Infinity ? "∞" : allowed.toFixed(2)}, ${posAbertas}/${MAX_POSITIONS} posições ocupadas)`)
    }
  }

  // Garante valor padrão para testnet (mainnet já definiu amountUsd acima)
  if (amountUsd === undefined || amountUsd <= 0) amountUsd = 5

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

  // ── Morse: múltiplas métricas alinhadas = mensagem forte do mercado ──
  for (const wp of wavePairs) {
    if (wp.fromToken === wp.toToken) continue

    const metrics: { nome: string; alinhado: boolean; direcao: "buy" | "sell"; peso: number }[] = []

    // Métrica 1: Momentum — direção da tendência
    const momSignal = wp.momentum > 0.02 ? "buy" : wp.momentum < -0.02 ? "sell" : null
    if (momSignal) {
      metrics.push({ nome: "Momentum", alinhado: true, direcao: momSignal, peso: Math.abs(wp.momentum) })
    }

    // Métrica 2: Volatilidade — baixa = squeeze (preparando), alta = expansão (movimento acontecendo)
    const volSignal = wp.volatility > 0.6 ? (wp.momentum > 0 ? "buy" : "sell") : null
    if (volSignal) {
      metrics.push({ nome: "Bollinger", alinhado: true, direcao: volSignal, peso: wp.volatility })
    }

    // Métrica 3: Amplitude — força combinada do sinal
    const ampSignal = wp.amplitude > 0.03 ? (wp.momentum > 0 ? "buy" : "sell") : null
    if (ampSignal) {
      metrics.push({ nome: "Amplitude", alinhado: true, direcao: ampSignal, peso: wp.amplitude })
    }

    // Métrica 4: Dados — confiabilidade da leitura
    if (wp.probability > 10) {
      metrics.push({ nome: "Confiabilidade", alinhado: true, direcao: wp.momentum > 0 ? "buy" : "sell", peso: wp.probability / 100 })
    }

    if (metrics.length < 2) continue

    // Verifica alinhamento: todas as métricas apontam pra mesma direção?
    const direcoes = new Set(metrics.map(m => m.direcao))
    if (direcoes.size !== 1) continue

    const direcaoUnica = [...direcoes][0]
    const pesoTotal = metrics.reduce((s, m) => s + m.peso, 0) / metrics.length
    const confianca = Math.min(90, Math.round(30 + pesoTotal * 60))
    const metrs = metrics.map(m => m.nome).join(" · ")

    votes.push({
      agentName: "Morse",
      pair: wp.label,
      fromToken: wp.fromToken,
      toToken: wp.toToken,
      network: redeAtual,
      confidence: confianca,
      action: direcaoUnica,
      reason: `📻 ${metrs} → ${direcaoUnica === "buy" ? "⬆ COMPRA" : "⬇ VENDA"} (${metrics.length}/${metrics.length} alinhadas)`,
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

  // Pondera confiança pelos pontos competitivos
  // Agentes com mais pontos têm mais peso na decisão
  for (const v of votes) {
    const score = accountant.getAgentScore(v.agentName)
    if (!score || score.points <= 0) continue
    const pointsRatio = score.points / 500 // 0 a 1
    const original = v.confidence
    // Abaixo de 1/N da piscina → penalidade leve; acima → boost
    v.confidence = Math.min(95, Math.round(v.confidence * (0.8 + pointsRatio * 0.4)))
    if (v.confidence !== original) {
      pregão.adicionarLog(`🏟️ ${v.agentName}: ${score.points.toFixed(0)} pts (${(pointsRatio * 100).toFixed(0)}%) ajustou confiança ${original}% → ${v.confidence}%`)
    }
  }

  // Aprendizado por streak: agente perdendo perde confiança, ganhando ganha peso
  for (const v of votes) {
    const score = accountant.getAgentScore(v.agentName)
    if (!score || score.totalTrades < 3) continue
    const original = v.confidence
    const preStreak = v.confidence
    const streak = score.streak
    // Streak negativa → reduz confiança (perdeu 3x seguidas = -30%)
    // Streak positiva → aumenta um pouco (+5% por vitória consecutiva)
    const streakMult = streak < 0
      ? Math.max(0.2, 1 + streak * 0.08)
      : Math.min(1.3, 1 + streak * 0.04)
    v.confidence = Math.round(v.confidence * streakMult)
    // Streak muito negativa → confiança mínima (nunca zero, pra poder recuperar)
    // Mas só se o agente tinha convicção originalmente (> 0%)
    if (streak <= -5) {
      v.confidence = preStreak > 0 ? Math.max(15, v.confidence) : v.confidence
      pregão.adicionarLog(`📉 ${v.agentName}: ${streak} derrotas consecutivas — confiança ${preStreak > 0 ? `reduzida para ${v.confidence}%` : `permanece ${v.confidence}% (sem convicção)`}`)
    } else if (v.confidence !== original) {
      pregão.adicionarLog(`📊 ${v.agentName}: streak ${streak > 0 ? "+" : ""}${streak} ajustou confiança ${original}% → ${v.confidence}%`)
    }
  }

  // 💰 Boost M2M: agentes com saldo acumulado acima da média ganham +5% de confiança
  const earningsList = votes.map(v => nanopaymentSystem.getPerformanceEarnings(v.agentName)).filter(e => e > 0)
  const avgEarnings = earningsList.length > 0 ? earningsList.reduce((s, e) => s + e, 0) / earningsList.length : 0
  if (avgEarnings > 0) {
    for (const v of votes) {
      const agentEarnings = nanopaymentSystem.getPerformanceEarnings(v.agentName)
      if (agentEarnings >= avgEarnings) {
        const original = v.confidence
        v.confidence = Math.min(95, v.confidence + 5)
        pregão.adicionarLog(`💰 ${v.agentName}: saldo M2M $${agentEarnings.toFixed(4)} acima da média ($${avgEarnings.toFixed(4)}) — confiança ${original}% → ${v.confidence}% (+5%)`)
      }
    }
  }

  // 🗳️ Boost de Poder de Voto: agentes com alto poder no Provão (>70%) recebem confiança mínima de 25%
  const votePowerMap = new Map(provaoRanking.getVotePower().map(vp => [vp.agentName, vp.power]))
  if (votePowerMap.size > 0) {
    for (const v of votes) {
      const agentPower = votePowerMap.get(v.agentName)
      if (agentPower !== undefined && agentPower > 0.7 && v.confidence < 25) {
        pregão.adicionarLog(`🔥 ${v.agentName} tem poder de voto ${(agentPower * 100).toFixed(0)}% — confiança ${v.confidence}% → 25% (boost mínimo)`)
        v.confidence = 25
      }
    }
  }

  // Modo emergência: se todos os agentes estão abaixo de 20% há 30min+ sem trades, recupera streaks
  const allBelow20 = votes.every(v => v.confidence < 20)
  const lastTrade = accountant.getLastTradeTime()
  const idleMs = Date.now() - lastTrade
  const EMERGENCY_KEY = "arcflow_emergency_triggered"
  const emergencyTriggered = typeof window !== "undefined" ? parseInt(localStorage.getItem(EMERGENCY_KEY) || "0") : 0
  if (allBelow20 && idleMs > 30 * 60 * 1000 && Date.now() - emergencyTriggered > 60 * 60 * 1000) {
    pregão.adicionarLog(`🚨 Modo emergência: ${votes.length} agentes abaixo de 20% há ${Math.round(idleMs / 60000)}min sem trades — recuperando streaks para -3`)
    for (const score of accountant.getRanking()) {
      if (score.streak < -3) {
        const originalStreak = score.streak
        score.streak = -3
        pregão.adicionarLog(`📈 ${score.agentName}: streak ${originalStreak} → -3 (recuperação emergencial)`)
      }
    }
    if (typeof window !== "undefined") localStorage.setItem(EMERGENCY_KEY, String(Date.now()))
  }

  // Log votes
  for (const v of votes) {
    pregão.adicionarLog(`🗳️ ${v.agentName} → ${v.pair} (${v.confidence}%)`)
  }

  // 🏆 Top 3 agents decidem: todos participam, mas só o ranking define quem tem voto decisivo
  const ranking = accountant.getRanking()
  const top3Nomes = new Set(ranking.slice(0, 3).map(s => s.agentName))
  const topVotes = votes.filter(v => top3Nomes.has(v.agentName) && v.confidence > 0)

  pregão.adicionarLog(`🏆 Top 3: ${ranking.slice(0, 3).map(s => `${s.agentName}(${s.score.toFixed(0)})`).join(', ')} — ${topVotes.length} votos com confiança > 0`)

  // Verifica acordo entre os top 3
  const pairCount = new Map<string, { votes: AgentPairVote[]; count: number }>()
  for (const v of topVotes) {
    const key = `${v.network}:${v.pair}`
    const existing = pairCount.get(key) || { votes: [], count: 0 }
    existing.votes.push(v)
    existing.count++
    pairCount.set(key, existing)
  }

  let agreedPair: AgentPairVote | null = null
  let agreeingAgents: AgentPairVote[] = []
  for (const [, data] of pairCount) {
    if (data.count >= 2) {
      agreedPair = data.votes[0]
      agreeingAgents = data.votes
      break
    }
  }

  let uniqueAgents = new Set<string>()
  let agentesStr = ""

  // ⚡ Tendência Express: se Tendência vota com >70% e pelo menos 1 agente concorda, vira ordem
  if (!agreedPair || agreeingAgents.length < 2) {
    const tendenciaVotes = votes.filter(v => v.confidence > 70)
    for (const tv of tendenciaVotes) {
      const supporters = votes.filter(v =>
        v.agentName !== tv.agentName &&
        v.pair === tv.pair &&
        v.network === tv.network &&
        v.action === tv.action &&
        v.confidence > 0
      )
      if (supporters.length >= 1) {
        agreedPair = tv
        agreeingAgents = [tv, supporters[0]]
        pregão.adicionarLog(`⚡ Tendência Express: ${tv.agentName} (${tv.confidence}%) + ${supporters[0].agentName} (${supporters[0].confidence}%) em ${tv.pair} — ordem formada com peso diferenciado`)
        break
      }
    }
  }

  if (!agreedPair || agreeingAgents.length < 2) {
    pregão.adicionarLog(`🤔 Top 3 não chegou a consenso — ${topVotes.length} votos distribuídos em ${pairCount.size} pares diferentes`)
    // Ainda tenta o sistema antigo como fallback: qualquer 2+ agentes (todos, não só top 3)
    const allPairCount = new Map<string, { votes: AgentPairVote[]; count: number }>()
    for (const v of votes) {
      if (v.confidence <= 0) continue
      const key = `${v.network}:${v.pair}`
      const existing = allPairCount.get(key) || { votes: [], count: 0 }
      existing.votes.push(v)
      existing.count++
      allPairCount.set(key, existing)
    }
    for (const [, data] of allPairCount) {
      if (data.count >= 2) {
        agreedPair = data.votes[0]
        agreeingAgents = data.votes
        pregão.adicionarLog(`🔄 Fallback: ${agreeingAgents.length} agentes concordaram em ${(agreedPair as AgentPairVote).pair}`)
        break
      }
    }
    if (!agreedPair) {
      return { totalPairs: pairs.length, votes, agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
    }
  }

  uniqueAgents = new Set(agreeingAgents.map(v => v.agentName))
  agentesStr = [...uniqueAgents].join(", ")
  const comprandoVolatil = STABLES.has(agreedPair.fromToken) && !STABLES.has(agreedPair.toToken)

  const vagasRestantes = Math.max(0, MAX_POSITIONS - positionManager.getOpenPositions().length)

  if (comprandoVolatil && vagasRestantes <= 0) {
    pregão.adicionarLog(`⏳ ${MAX_POSITIONS}/${MAX_POSITIONS} posições ocupadas — ${agreedPair.pair} aguardando vaga`)
  } else if (comprandoVolatil && !net.isTestnet) {
    const gasCost = await gasPriceOracle.getGasCost(redeAtual)
    const balFrom = realSwap.getBalance(agreedPair.fromToken as TokenSymbol)
    const valorFinal = Math.min(amountUsd * 0.9, balFrom)

    // Busca volatilidade 24h real do token via volatility tracker
    const volData = volatilityTracker.getVolatility(agreedPair.toToken as TokenSymbol)
    const vol24h = Math.max(volData.vol24h, 0.005) // mínimo 0.5%
    const avgConfidence = agreeingAgents.reduce((s: number, v: any) => s + v.confidence, 0) / agreeingAgents.length

    // Retorno esperado = confiança média dos agentes × volatilidade 24h
    const expectedReturn = (avgConfidence / 100) * vol24h

    // Custos
    const spreadPct = 0.005 // 0.5% fixo

    // Trade mínimo viável: precisa cobrir gas + spread + $0.05 de lucro real
    const minViableTrade = (MIN_PROFIT_REAL + gasCost) / Math.max(0.001, expectedReturn - spreadPct)

    if (minViableTrade > 0 && valorFinal < minViableTrade) {
      pregão.adicionarLog(`⏳ Mercado pouco volátil — trade de $${valorFinal.toFixed(2)} não cobre custos (precisa ~$${minViableTrade.toFixed(2)}). Retorno esperado ${(expectedReturn * 100).toFixed(2)}% com ${(vol24h * 100).toFixed(1)}% vol`)
    } else {
      pregão.adicionarLog(`✅ Trade viável: retorno esperado ${(expectedReturn * 100).toFixed(2)}% cobre gas + spread + $${MIN_PROFIT_REAL.toFixed(2)}`)
      if (vol24h >= 0.02) {
        pregão.adicionarLog(`📈 Mercado volátil (${(vol24h * 100).toFixed(1)}%) — condições favoráveis`)
      }
      pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} (${agreedPair.fromToken}→${agreedPair.toToken})`)
      for (const v of agreeingAgents) {
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
  } else {
    // Testnet ou stable-stable: envia OKs sem verificação de gas
    pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} (${agreedPair.fromToken}→${agreedPair.toToken})`)
    for (const v of agreeingAgents) {
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

    // Staircase rule: only sell at a loss if stop loss (-15%)
    // Otherwise, only sell if position has seen profit
    const STOP_LOSS = -15
    if (profitPercent > STOP_LOSS && (pos.peakProfitPercent ?? 0) <= 0) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: ${profitPercent.toFixed(1)}% sem nunca ter lucrado — Staircase segura (hold)`)
      continue
    }

    // Sanity check: lucro irreal (> 100%) indica entryPrice quebrado
    if (profitPercent > 100) {
      pregão.adicionarLog(`⚠️ ${pos.boughtToken}: profit ${profitPercent.toFixed(1)}% irreal — entryPrice corrompido ($${pos.entryPrice.toFixed(4)}), pulando venda`)
      continue
    }

    // Só vende se lucro estimado cobrir gas (dinâmico via oracle)
    const gasCost = await gasPriceOracle.getGasCost(redeAtual)
    const positionValueUSD = pos.amountBought * currentPrice
    const profitUSD = positionValueUSD * (profitPercent / 100)
    const minProfit = gasCost * 3
    if (profitUSD < minProfit && profitPercent > 0) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: lucro $${profitUSD.toFixed(2)} não cobre gas ($${gasCost.toFixed(4)} × 3 = $${minProfit.toFixed(2)}) — segurando`)
      continue
    }

    // Variação 24h como meta de lucro: só se aplica quando lucro é positivo
    // Se está no prejuízo, o stop loss decide a venda
    if (profitPercent > 0) {
      const { change24h, variation24h } = await positionManager.fetchTokenChange24h(pos.boughtToken as TokenSymbol)
      const profitTarget = variation24h * 0.9
      if (profitPercent < profitTarget) {
        pregão.adicionarLog(`📊 ${pos.boughtToken}: ${profitPercent.toFixed(1)}% < meta ${profitTarget.toFixed(1)}% (90% da variação 24h=${variation24h.toFixed(1)}%, change=${change24h.toFixed(1)}%) — segurando`)
        continue
      }
    }

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
