import { quantumAgent, technicalAgent } from "./multi-agent-system"
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
import { pairProfitability } from "./pair-profitability"
import { gridTrader } from "./grid-trading"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])
const MIN_TRADE_SIZE = 5 // $ mínimo por trade para cobrir gas + spread + $0.05 lucro

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
      const spread = Math.abs(priceAgora - voto.priceAtVote) / voto.priceAtVote * 100
      if (spread < 0.1) continue
      profitPercent = (priceAgora - voto.priceAtVote) / voto.priceAtVote * 100
    } else if (STABLES.has(tokenVolatil)) {
      continue
    } else if (voto.action === "buy") {
      profitPercent = ((priceAgora - voto.priceAtVote) / voto.priceAtVote) * 100
    } else {
      profitPercent = ((voto.priceAtVote - priceAgora) / voto.priceAtVote) * 100
    }

    const simulatedAmount = 5
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

// Cada robô com seus pares específicos por rede (Synthesis = meta, analisa tudo)
export const AGENTE_PARES: Record<string, string[]> = {
  "Quantum":         ["USDC→WETH", "WETH→USDC", "WMATIC→USDC", "USDC→WMATIC", "cirBTC→USDC", "USDC→cirBTC"],
  "Technical":       ["WMATIC→USDC", "USDC→WMATIC", "ARB→USDC", "USDC→ARB", "EURC→USDC", "USDC→EURC", "DAI→USDC", "USDC→DAI"],
  "TrendFollower":   ["WETH→USDC", "USDC→WETH", "WETH→WBTC", "WBTC→WETH"],
  "MeanReversion":   ["WMATIC→USDC", "USDC→DAI", "DAI→USDC", "WETH→WBTC", "WBTC→WETH"],
  "QuantumTrader":   ["USDC→WETH", "WETH→USDC", "USDC→WBTC", "WBTC→USDC"],
  "ArbitrageHunter": ["USDC→EURC", "EURC→USDC", "USDC→USDT", "USDT→USDC", "DAI→USDC", "USDC→DAI"],
  "MarketMaker":     ["USDC→EURC", "EURC→USDC", "USDC→USDT", "USDT→USDC", "USDC→WMATIC", "WMATIC→USDC"],
  "BTCTrader":       ["USDC→WETH", "WETH→USDC", "USDC→WBTC", "WBTC→USDC", "WETH→WBTC", "WBTC→WETH"],
  "Liquidator":      ["WETH→USDC", "USDC→WETH", "WMATIC→USDC", "USDC→WMATIC"],
  "MomentumTrader":  ["WETH→WBTC", "WBTC→WETH", "WETH→USDC", "USDC→WETH"],
  "NVIDIAgent":      ["USDC→WMATIC", "WMATIC→USDC", "USDC→WETH", "WETH→USDC"],
  "Synthesis":       [], // vazio = meta: analisa qualquer par
  "Morse":           ["cirBTC→USDC", "USDC→cirBTC", "mcirBTC→USDC", "USDC→mcirBTC", "EURC→cirBTC", "cirBTC→EURC", "EURC→mcirBTC", "mcirBTC→EURC"],
}

function agentAssigned(agentName: string, pairLabel: string): boolean {
  const pairs = AGENTE_PARES[agentName]
  if (!pairs) return false
  if (pairs.length === 0) return true // Synthesis: assigned to all
  return pairs.includes(pairLabel)
}

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

  const jumperArticles = await jumperLearn.getArticles()
  if (jumperArticles.length > 0 && Math.random() < 0.1) {
    pregão.adicionarLog(`📖 Agentes consultaram Jumper Learn: ${jumperArticles[0].title} — ${jumperArticles[0].summary.slice(0, 80)}`)
  }

  await avaliarVotosPassados(redeAtual)

  // Remove agentes operacionais (Grid, GridRef) do ranking competitivo
  for (const nome of ["Grid", "GridRef"]) {
    accountant.removeAgent(nome)
    for (let i = historicoVotos.length - 1; i >= 0; i--) {
      if (historicoVotos[i].agentName === nome) historicoVotos.splice(i, 1)
    }
  }

  let maxPositions = 10

  // Inicializa grid trading para a rede atual
  gridTrader.init(redeAtual)

  if (!net.isTestnet) {
    const balUSDC = realSwap.getBalance("USDC");
    const balUSDT = realSwap.getBalance("USDT");
    const balDAI  = realSwap.getBalance("DAI");
    const maiorStable = Math.max(balUSDC, balUSDT, balDAI);
    const allowed = getPregãoAllowedBalance();
    const saldoEfetivo = allowed === Infinity ? maiorStable : Math.min(maiorStable, allowed);
    const posAbertas = positionManager.getOpenPositions().length;
    maxPositions = Math.max(1, Math.floor((saldoEfetivo * 0.9) / MIN_TRADE_SIZE))
    const vagas = Math.max(1, maxPositions - posAbertas);

    if (saldoEfetivo < 5) {
      amountUsd = 0
      pregão.adicionarLog(`⚠️ Saldo efetivo $${saldoEfetivo.toFixed(2)} abaixo do mínimo $5.00 — pulando alocação`)
    } else {
      amountUsd = Math.min(MIN_TRADE_SIZE * 1.2, (saldoEfetivo * 0.9) / vagas);
      const volMult = volatilityTracker.getPositionSizeMultiplier(pairs[0]?.to ?? "USDC")
      if (volMult < 1.0) {
        const original = amountUsd
        amountUsd = Math.round((amountUsd * volMult) * 100) / 100
        pregão.adicionarLog(`🧠 VolTracker: trade $${original.toFixed(2)} → $${amountUsd.toFixed(2)} (vol mult ${volMult.toFixed(1)}x)`)
      }
      pregão.adicionarLog(`💰 Pregão alocou $${amountUsd.toFixed(2)} para este trade (saldo real $${maiorStable.toFixed(2)}, permitido $${allowed === Infinity ? "∞" : allowed.toFixed(2)}, ${posAbertas}/${maxPositions} posições ocupadas)`)
    }
  }

  if (amountUsd === undefined || amountUsd <= 0) amountUsd = 5

  // 🔥 ANÁLISE CONCENTRADA: Obtém pares prioritários
  const pairsToAnalyze = pairProfitability.getPairsForAnalysis(redeAtual)
  pregão.adicionarLog(`🎯 Analisando pares prioritários: ${pairsToAnalyze.join(', ')}`)

  const wave = await quantumWaveTrader.broadcastIntent(amountUsd)
  const wavePairs = wave.pairs.filter(p => p.network === redeAtual)

  // Alimenta o grid com dados da onda quântica
  gridTrader.setWaveData(wavePairs, redeAtual)

  const allVotes: AgentPairVote[] = []

  const tokensParaColetar = new Set<TokenSymbol>()
  for (const p of pairs) {
    tokensParaColetar.add(p.from); tokensParaColetar.add(p.to)
  }
  volatilityTracker.collectPrices([...tokensParaColetar]).catch(() => {})

  const volatileParaRede = [...tokensParaColetar].filter(t => !STABLES.has(t))
  await positionManager.reconcileBalances(redeAtual, volatileParaRede)

  // 🔥 Para cada par prioritário, só os robôs designados analisam
  for (const pairLabel of pairsToAnalyze) {
    const pair = pairs.find(p => p.label === pairLabel)
    if (!pair) continue
    
    const wavePair = wavePairs.find(wp => wp.label === pairLabel)
    if (!wavePair) continue

    const assigned = AGENTES_NOMES
      .filter(a => agentAssigned(a.nome, pairLabel))
      .map(a => a.nome)
    pregão.adicionarLog(`🔍 Analisando ${pairLabel} — ${assigned.join(", ")}`)
    const votesForPair: AgentPairVote[] = []

    // ── QuantumAgent ──
    if (agentAssigned("Quantum", pairLabel)) try {
      const result = await quantumAgent.evaluatePair(wavePair)
      if (result && result.confidence >= 30) {
        votesForPair.push({
          agentName: "Quantum",
          pair: pairLabel,
          fromToken: wavePair.fromToken,
          toToken: wavePair.toToken,
          network: redeAtual,
          confidence: result.confidence,
          action: wavePair.momentum > 0 ? "buy" : "sell",
          reason: `Onda quântica: amplitude ${(wavePair.amplitude * 100).toFixed(0)}%`,
        })
      }
    } catch (e) {
      pregão.adicionarLog(`⚠️ Quantum falhou ao analisar ${pairLabel}: ${e}`)
    }

    // ── TechnicalAgent ──
    if (agentAssigned("Technical", pairLabel)) try {
      const mockPrices = [1.0, 1.001, 0.999, 1.002, 1.0 + wavePair.momentum * 10]
      const indicators = technicalAgent.calculateIndicators(mockPrices)
      const rsi = indicators.rsi
      const rsiAction: "buy" | "sell" | "hold" = rsi < 35 ? "buy" : rsi > 65 ? "sell" : "hold"
      if (rsiAction !== "hold") {
        const confidence = Math.min(90, Math.round(40 + Math.abs(rsi - 50) * 0.8))
        if (confidence >= 30) {
          votesForPair.push({
            agentName: "Technical",
            pair: pairLabel,
            fromToken: wavePair.fromToken,
            toToken: wavePair.toToken,
            network: redeAtual,
            confidence: confidence,
            action: rsiAction,
            reason: `RSI: ${Math.round(rsi)} — ${rsiAction === "buy" ? "sobrevendido" : "sobrecomprado"}`,
          })
        }
      }
    } catch (e) {
      pregão.adicionarLog(`⚠️ Technical falhou ao analisar ${pairLabel}: ${e}`)
    }

    // ── TrendFollower ──
    if (agentAssigned("TrendFollower", pairLabel) && Math.abs(wavePair.momentum) > 0.02) {
      votesForPair.push({
        agentName: "TrendFollower",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: redeAtual,
        confidence: Math.min(90, Math.round(40 + Math.abs(wavePair.momentum) * 500)),
        action: wavePair.momentum > 0 ? "buy" : "sell",
        reason: `Trend ${wavePair.momentum > 0 ? "🠕" : "🠗"} momentum ${(wavePair.momentum * 100).toFixed(1)}%`,
      })
    }

    // ── MeanReversion ──
    if (agentAssigned("MeanReversion", pairLabel) && wavePair.amplitude > 0.03) {
      votesForPair.push({
        agentName: "MeanReversion",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: redeAtual,
        confidence: Math.min(90, Math.round(35 + wavePair.amplitude * 400)),
        action: wavePair.momentum > 0 ? "sell" : "buy",
        reason: `Reversão: amplitude ${(wavePair.amplitude * 100).toFixed(1)}% — ${wavePair.momentum > 0 ? "subiu, pode recuar" : "caiu, pode recuperar"}`,
      })
    }

    // ── ArbitrageHunter (stable-stable) ──
    const isStableStable = STABLES.has(pair.from) && STABLES.has(pair.to)
    if (agentAssigned("ArbitrageHunter", pairLabel) && isStableStable) {
      const fromPrice = await getTokenPrice(pair.from)
      const toPrice = await getTokenPrice(pair.to)
      const spread = Math.abs((toPrice - fromPrice) / fromPrice * 100)
      if (spread > 0.01) {
        votesForPair.push({
          agentName: "ArbitrageHunter",
          pair: pairLabel,
          fromToken: pair.from,
          toToken: pair.to,
          network: redeAtual,
          confidence: Math.min(75, Math.round(30 + spread * 10)),
          action: toPrice > fromPrice ? "sell" : "buy",
          reason: `Arbitragem ${pairLabel} (spread ${spread.toFixed(3)}%)`,
        })
      }
    }

    // ── MarketMaker ──
    if (agentAssigned("MarketMaker", pairLabel) && !isStableStable) {
      const fromPrice = await getTokenPrice(pair.from)
      const toPrice = await getTokenPrice(pair.to)
      const spread = Math.abs((toPrice - fromPrice) / fromPrice * 100)
      if (spread > 0.01) {
        votesForPair.push({
          agentName: "MarketMaker",
          pair: pairLabel,
          fromToken: pair.from,
          toToken: pair.to,
          network: redeAtual,
          confidence: 60,
          action: toPrice > fromPrice ? "sell" : "buy",
          reason: `Volátil ${pairLabel} ${toPrice > fromPrice ? "🠕" : "🠗"} (${spread.toFixed(3)}%)`,
        })
      }
    }

    // ── BTCTrader ──
    const isBtcEth = pair.from === "WBTC" || pair.to === "WBTC" ||
                     pair.from === "WETH" || pair.to === "WETH"
    if (agentAssigned("BTCTrader", pairLabel) && isBtcEth) {
      const fromPrice = await getTokenPrice(pair.from)
      const toPrice = await getTokenPrice(pair.to)
      const spread = Math.abs((toPrice - fromPrice) / fromPrice * 100)
      if (spread > 0.01) {
        votesForPair.push({
          agentName: "BTCTrader",
          pair: pairLabel,
          fromToken: pair.from,
          toToken: pair.to,
          network: redeAtual,
          confidence: 65,
          action: toPrice > fromPrice ? "sell" : "buy",
          reason: `BTC/ETH ${pairLabel} ${toPrice > fromPrice ? "🠕" : "🠗"}`,
        })
      }
    }

    // ── Liquidator ──
    if (agentAssigned("Liquidator", pairLabel) && wavePair.liquidity > 0.1) {
      votesForPair.push({
        agentName: "Liquidator",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: redeAtual,
        confidence: Math.round(wavePair.liquidity * 60),
        action: wavePair.momentum > 0 ? "buy" : "sell",
        reason: `Liquidez ${(wavePair.liquidity * 100).toFixed(0)}% — ${pairLabel}`,
      })
    }

    // ── MomentumTrader ──
    const momentumScore = Math.abs(wavePair.momentum) * wavePair.volatility
    if (agentAssigned("MomentumTrader", pairLabel) && momentumScore > 0.005) {
      votesForPair.push({
        agentName: "MomentumTrader",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: redeAtual,
        confidence: Math.min(90, Math.round(40 + momentumScore * 2000)),
        action: wavePair.momentum > 0 ? "buy" : "sell",
        reason: `Momento × vol = ${(momentumScore * 10000).toFixed(0)} — ${wavePair.momentum > 0 ? "🠕🠕" : "🠗🠗"}`,
      })
    }

    // ── NVIDIAgent ──
    if (agentAssigned("NVIDIAgent", pairLabel) && wavePair.probability > 10) {
      votesForPair.push({
        agentName: "NVIDIAgent",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: redeAtual,
        confidence: Math.min(90, Math.round(wavePair.probability)),
        action: wavePair.momentum > 0 ? "buy" : "sell",
        reason: `NIM: ondas de probabilidade — ${pairLabel}`,
      })
    }

    // ── SynthesisAgent (meta: analisa qualquer par) ──
    if (agentAssigned("Synthesis", pairLabel)) try {
      const indicators: { name: string; signal: "buy" | "sell"; weight: number }[] = []
      
      if (Math.abs(wavePair.momentum) > 0.02) {
        indicators.push({
          name: "Momentum",
          signal: wavePair.momentum > 0 ? "buy" : "sell",
          weight: Math.abs(wavePair.momentum) * 2
        })
      }
      
      if (wavePair.amplitude > 0.03) {
        indicators.push({
          name: "Amplitude",
          signal: wavePair.momentum > 0 ? "sell" : "buy",
          weight: wavePair.amplitude * 3
        })
      }
      
      if (wavePair.volatility > 0.4) {
        indicators.push({
          name: "Volatilidade",
          signal: wavePair.momentum > 0 ? "buy" : "sell",
          weight: wavePair.volatility
        })
      }
      
      if (wavePair.liquidity > 0.3) {
        indicators.push({
          name: "Liquidez",
          signal: wavePair.momentum > 0 ? "buy" : "sell",
          weight: wavePair.liquidity * 0.5
        })
      }
      
      if (indicators.length >= 2) {
        const buyWeight = indicators.filter(i => i.signal === "buy").reduce((s, i) => s + i.weight, 0)
        const sellWeight = indicators.filter(i => i.signal === "sell").reduce((s, i) => s + i.weight, 0)
        const totalWeight = buyWeight + sellWeight
        
        const synthesisAction: "buy" | "sell" = buyWeight > sellWeight ? "buy" : "sell"
        const confidenceRatio = Math.abs(buyWeight - sellWeight) / totalWeight
        const synthesisConfidence = Math.min(90, Math.round(30 + confidenceRatio * 50))
        
        if (synthesisConfidence >= 30) {
          const buySignals = indicators.filter(i => i.signal === "buy").length
          const sellSignals = indicators.filter(i => i.signal === "sell").length
          const synthReason = `Síntese: ${buySignals} compra, ${sellSignals} venda (${indicators.map(i => i.name).join(", ")})`
          
          votesForPair.push({
            agentName: "Synthesis",
            pair: pairLabel,
            fromToken: wavePair.fromToken,
            toToken: wavePair.toToken,
            network: redeAtual,
            confidence: synthesisConfidence,
            action: synthesisAction,
            reason: synthReason,
          })
        }
      }
    } catch (e) {
      pregão.adicionarLog(`⚠️ Synthesis falhou ao analisar ${pairLabel}: ${e}`)
    }

    // ── Morse ──
    if (agentAssigned("Morse", pairLabel)) {
      const metrics: { nome: string; alinhado: boolean; direcao: "buy" | "sell"; peso: number }[] = []

      const momSignal = wavePair.momentum > 0.02 ? "buy" : wavePair.momentum < -0.02 ? "sell" : null
      if (momSignal) {
        metrics.push({ nome: "Momentum", alinhado: true, direcao: momSignal, peso: Math.abs(wavePair.momentum) })
      }

      const volSignal = wavePair.volatility > 0.6 ? (wavePair.momentum > 0 ? "buy" : "sell") : null
      if (volSignal) {
        metrics.push({ nome: "Bollinger", alinhado: true, direcao: volSignal, peso: wavePair.volatility })
      }

      const ampSignal = wavePair.amplitude > 0.03 ? (wavePair.momentum > 0 ? "buy" : "sell") : null
      if (ampSignal) {
        metrics.push({ nome: "Amplitude", alinhado: true, direcao: ampSignal, peso: wavePair.amplitude })
      }

      if (wavePair.probability > 10) {
        metrics.push({ nome: "Confiabilidade", alinhado: true, direcao: wavePair.momentum > 0 ? "buy" : "sell", peso: wavePair.probability / 100 })
      }

      if (metrics.length >= 2) {
        const direcoes = new Set(metrics.map(m => m.direcao))
        if (direcoes.size === 1) {
          const direcaoUnica = [...direcoes][0]
          const pesoTotal = metrics.reduce((s, m) => s + m.peso, 0) / metrics.length
          const confianca = Math.min(90, Math.round(30 + pesoTotal * 60))
          const metrs = metrics.map(m => m.nome).join(" · ")
          votesForPair.push({
            agentName: "Morse",
            pair: pairLabel,
            fromToken: wavePair.fromToken,
            toToken: wavePair.toToken,
            network: redeAtual,
            confidence: confianca,
            action: direcaoUnica,
            reason: `📻 ${metrs} → ${direcaoUnica === "buy" ? "⬆ COMPRA" : "⬇ VENDA"} (${metrics.length}/${metrics.length} alinhadas)`,
          })
        }
      }
    }

    allVotes.push(...votesForPair)

    if (votesForPair.length >= 2) {
      const avgConfidence = votesForPair.reduce((s, v) => s + v.confidence, 0) / votesForPair.length
      const topConfidence = Math.max(...votesForPair.map(v => v.confidence))
      
      if (avgConfidence >= 50) {
        pregão.adicionarLog(`✅ Consenso em ${pairLabel}: ${votesForPair.length} agentes, confiança média ${avgConfidence.toFixed(1)}%, top ${topConfidence.toFixed(0)}%`)
      } else {
        pregão.adicionarLog(`⚠️ Consenso em ${pairLabel} mas confiança baixa (média ${avgConfidence.toFixed(1)}%)`)
      }
    } else {
      pregão.adicionarLog(`❌ Sem consenso em ${pairLabel}: apenas ${votesForPair.length} agentes`)
    }
  }

  // ── Grid Trading: níveis vão direto ao Pregão ──
  const gridResult = await gridTrader.checkLevels(redeAtual)
  for (const gv of gridResult.votes) {
    const gridConfidence = gv.direction === "buy" ? 80 : 85

    const balFrom = realSwap.getBalance(gv.pairFrom as TokenSymbol)
    let balFromUsd = balFrom
    if (!STABLES.has(gv.pairFrom)) {
      const fromPrice = await positionManager.fetchTokenPrice(gv.pairFrom as TokenSymbol).catch(() => 1)
      balFromUsd = balFrom * fromPrice
    }
    if (balFromUsd < 0.50) {
      pregão.adicionarLog(`⏳ Grid ${gv.direction === "buy" ? "COMPRA" : "VENDA"} ${gv.pairLabel}: saldo insuficiente de ${gv.pairFrom} ($${balFromUsd.toFixed(2)})`)
      continue
    }

    if (gv.direction === "sell") {
      const temPos = positionManager.getOpenPositions()
        .some(p => p.boughtToken === gv.token && p.networkKey === redeAtual && p.status === "open")
      if (!temPos) {
        pregão.adicionarLog(`⏳ Grid VENDA ${gv.pairLabel}: sem posição de ${gv.token} — pulando`)
        continue
      }
      const jaVendendo = pregão.getOrdensAtivas()
        .some(o => o.fromToken === gv.token && o.rede === redeAtual && o.status !== "concluido" && o.status !== "falhou")
      if (jaVendendo) {
        pregão.adicionarLog(`⏳ Grid VENDA ${gv.pairLabel}: já há ordem de venda ativa para ${gv.token} — pulando`)
        continue
      }
    }

    if (gv.direction === "buy") {
      const posAbertas = positionManager.getOpenPositions().filter(p => p.networkKey === redeAtual && p.status === "open").length
      const maiorStable = Math.max(
        realSwap.getBalance("USDC"),
        realSwap.getBalance("USDT"),
        realSwap.getBalance("DAI"),
      )
      const maxPos = Math.max(1, Math.floor((maiorStable * 0.9) / 5))
      if (posAbertas >= maxPos) {
        pregão.adicionarLog(`⏳ Grid COMPRA ${gv.pairLabel}: ${posAbertas}/${maxPos} posições — pulando`)
        continue
      }
    }

    const dirLabel = gv.direction === "buy" ? "🟢 COMPRA" : "🔴 VENDA"
    pregão.adicionarLog(`📐 Grid ${dirLabel} ${gv.pairLabel} @ $${gv.triggerPrice.toFixed(4)} (${gridConfidence}%)`)
    pregão.receberOK({
      pregueiro: `Grid:${gv.direction === "buy" ? "Compra" : "Venda"}`,
      rede: redeAtual,
      par: gv.pairLabel,
      confianca: gridConfidence,
      timestamp: Date.now(),
      fromToken: gv.pairFrom,
      toToken: gv.pairTo,
    })
  }

  // Grid awareness: se o grid está ativo num token, agentes reduzem confiança (grid cuida dos micro-movimentos)
  const tokensComGrid = gridTrader.getActiveTokens(redeAtual)
  for (const v of allVotes) {
    const tokenVol = v.action === "buy" ? v.toToken : v.fromToken
    if (!tokensComGrid.includes(tokenVol as TokenSymbol)) continue
    const saude = gridTrader.getGridHealth(tokenVol as TokenSymbol, redeAtual)
    if (saude === "active") {
      const orig = v.confidence
      v.confidence = Math.round(v.confidence * 0.7)
      pregão.adicionarLog(`🧠 Grid ativo em ${tokenVol} — ${v.agentName} reduz confiança ${orig}% → ${v.confidence}%`)
    } else if (saude === "jumped") {
      pregão.adicionarLog(`🧠 Grid ${tokenVol} saltou — ${v.agentName} mantém confiança ${v.confidence}%`)
    }
  }

  // ── Fallback ──
  let votes = allVotes
  if (allVotes.length === 0) {
    pregão.adicionarLog(`🔄 Fallback: nenhum voto nos pares prioritários — usando análise tradicional`)
    
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
    } catch { /* fallback */ }
    
    // Fallback: adiciona um voto do Synthesis se não houver outros
    if (votes.length === 0 && wavePairs.length > 0) {
      const fallbackWave = wavePairs.filter(wp => wp.fromToken !== wp.toToken)
        .sort((a, b) => b.probability - a.probability)[0]
      if (fallbackWave) {
        votes.push({
          agentName: "Synthesis",
          pair: fallbackWave.label,
          fromToken: fallbackWave.fromToken,
          toToken: fallbackWave.toToken,
          network: redeAtual,
          confidence: Math.min(60, Math.round(fallbackWave.probability)),
          action: fallbackWave.momentum > 0 ? "buy" : "sell",
          reason: `Síntese fallback: ${fallbackWave.label} (prob ${fallbackWave.probability.toFixed(0)}%)`,
        })
      }
    }
  }

  // Registra votos para aprendizado
  for (const v of votes) {
    if (v.agentName === "Grid" || v.agentName === "GridRef") continue
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

  // Ajustes de confiança
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

  for (const v of votes) {
    const score = accountant.getAgentScore(v.agentName)
    if (!score || score.points <= 0) continue
    const pointsRatio = score.points / 500
    const original = v.confidence
    v.confidence = Math.min(95, Math.round(v.confidence * (0.8 + pointsRatio * 0.4)))
    if (v.confidence !== original) {
      pregão.adicionarLog(`🏟️ ${v.agentName}: ${score.points.toFixed(0)} pts (${(pointsRatio * 100).toFixed(0)}%) ajustou confiança ${original}% → ${v.confidence}%`)
    }
  }

  for (const v of votes) {
    const score = accountant.getAgentScore(v.agentName)
    if (!score || score.totalTrades < 3) continue
    const original = v.confidence
    const preStreak = v.confidence
    const streak = score.streak
    const streakMult = streak < 0
      ? Math.max(0.2, 1 + streak * 0.08)
      : Math.min(1.3, 1 + streak * 0.04)
    v.confidence = Math.round(v.confidence * streakMult)
    if (streak <= -5) {
      v.confidence = preStreak > 0 ? Math.max(15, v.confidence) : v.confidence
      pregão.adicionarLog(`📉 ${v.agentName}: ${streak} derrotas consecutivas — confiança ${preStreak > 0 ? `reduzida para ${v.confidence}%` : `permanece ${v.confidence}% (sem convicção)`}`)
    } else if (v.confidence !== original) {
      pregão.adicionarLog(`📊 ${v.agentName}: streak ${streak > 0 ? "+" : ""}${streak} ajustou confiança ${original}% → ${v.confidence}%`)
    }
  }

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

  // Streak catastrófico: agentes com streak < -15 são recuperados para -3
  // (impede que erros do passado congelem agentes para sempre)
  const catRanking = accountant.getRanking()
  for (const score of catRanking) {
    if (score.streak < -15) {
      const originalStreak = score.streak
      score.streak = -3
      score.wins = Math.max(1, score.wins)
      pregão.adicionarLog(`🚑 ${score.agentName}: streak catastrófico ${originalStreak} → -3 (recuperação automática)`)
    }
  }

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

  for (const v of votes) {
    pregão.adicionarLog(`🗳️ ${v.agentName} → ${v.pair} (${v.confidence}%)`)
  }

  const ranking = accountant.getRanking().filter(s => s.agentName !== "Grid" && s.agentName !== "GridRef")
  const top3Nomes = new Set(ranking.slice(0, 3).map(s => s.agentName))
  const topVotes = votes.filter(v => top3Nomes.has(v.agentName) && v.confidence > 0)

  pregão.adicionarLog(`🏆 Top 3: ${ranking.slice(0, 3).map(s => `${s.agentName}(${s.score.toFixed(0)})`).join(', ')} — ${topVotes.length} votos com confiança > 0`)

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
  const vagasRestantes = Math.max(0, maxPositions - positionManager.getOpenPositions().length)

  if (comprandoVolatil && vagasRestantes <= 0) {
    pregão.adicionarLog(`⏳ ${maxPositions}/${maxPositions} posições ocupadas — ${agreedPair.pair} aguardando vaga`)
  } else if (comprandoVolatil && !net.isTestnet) {
    const gasCost = await gasPriceOracle.getGasCost(redeAtual)
    const balFrom = realSwap.getBalance(agreedPair.fromToken as TokenSymbol)
    const valorFinal = Math.min(amountUsd * 0.9, balFrom)

    const volData = volatilityTracker.getVolatility(agreedPair.toToken as TokenSymbol)
    const vol24h = Math.max(volData.vol24h, 0.005)
    const avgConfidence = agreeingAgents.reduce((s: number, v: AgentPairVote) => s + v.confidence, 0) / agreeingAgents.length

    const expectedReturn = (avgConfidence / 100) * vol24h
    const spreadPct = 0.005
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
  } else if (!net.isTestnet && STABLES.has(agreedPair.fromToken) && STABLES.has(agreedPair.toToken)) {
    const gasCost = await gasPriceOracle.getGasCost(redeAtual)
    const balFrom = realSwap.getBalance(agreedPair.fromToken as TokenSymbol)
    const valorFinal = Math.min(amountUsd * 0.9, balFrom)

    const wavePair = wavePairs.find(wp => wp.label === agreedPair.pair && wp.network === agreedPair.network)
    const spreadEsperado = Math.max((wavePair?.amplitude ?? 0.0005), 0.0005)
    const expectedReturn = (agreeingAgents.reduce((s: number, v: AgentPairVote) => s + v.confidence, 0) / agreeingAgents.length / 100) * spreadEsperado
    const spreadPct = 0.005
    const minViableTrade = (MIN_PROFIT_REAL + gasCost) / Math.max(0.001, expectedReturn - spreadPct)

    if (minViableTrade > 0 && valorFinal < minViableTrade) {
      pregão.adicionarLog(`⏳ Stable-stable ${agreedPair.pair}: retorno esperado ${(expectedReturn * 100).toFixed(3)}% não cobre gas ($${gasCost.toFixed(4)}) — precisa ~$${minViableTrade.toFixed(2)} de trade`)
    } else {
      pregão.adicionarLog(`✅ Stable-stable ${agreedPair.pair} viável: $${valorFinal.toFixed(2)} cobre gas + spread`)
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
  } else if (!STABLES.has(agreedPair.fromToken) && STABLES.has(agreedPair.toToken)) {
    // Venda volátil→stable: verifica se já temos posição aberta e se está no lucro
    const posVenda = positionManager.getOpenPositions()
      .find(p => p.boughtToken === agreedPair.fromToken && p.networkKey === redeAtual && p.status === "open")
    if (posVenda) {
      const currentPrice = await positionManager.fetchTokenPrice(posVenda.boughtToken as TokenSymbol)
      const profitPercent = ((currentPrice - posVenda.entryPrice) / posVenda.entryPrice) * 100
      if (profitPercent <= 0) {
        const label = profitPercent < 0 ? `no prejuízo (${profitPercent.toFixed(1)}%)` : `break-even (0.0%)`
        pregão.adicionarLog(`⏳ ${agreedPair.pair}: posição ${agreedPair.fromToken} ${label} — só Staircase pode fechar`)
      } else {
        pregão.adicionarLog(`💰 Venda lucrativa: ${agreedPair.pair} (${profitPercent.toFixed(1)}%)`)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
            fromToken: v.fromToken, toToken: v.toToken,
          })
        }
      }
    } else {
      // Venda sem posição aberta (ex: vender token que está na wallet mas não como posição)
      pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair}`)
      for (const v of agreeingAgents) {
        pregão.receberOK({
          pregueiro: `Agente:${v.agentName}`,
          rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
          fromToken: v.fromToken, toToken: v.toToken,
        })
      }
    }
  } else {
    // Balance check para qualquer rede (especialmente testnet)
    const balFrom = realSwap.getBalance(agreedPair.fromToken as TokenSymbol)
    let balFromUsd = balFrom
    if (!STABLES.has(agreedPair.fromToken)) {
      const fromPrice = await positionManager.fetchTokenPrice(agreedPair.fromToken as TokenSymbol).catch(() => 1)
      balFromUsd = balFrom * fromPrice
    }
    if (balFromUsd < 0.50) {
      pregão.adicionarLog(`⏳ Saldo insuficiente de ${agreedPair.fromToken}: $${balFromUsd.toFixed(2)} — ordem bloqueada`)
    } else {
      pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} (${agreedPair.fromToken}→${agreedPair.toToken})`)
      for (const v of agreeingAgents) {
        pregão.receberOK({
          pregueiro: `Agente:${v.agentName}`,
          rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
          fromToken: v.fromToken, toToken: v.toToken,
        })
      }
    }
  }

  // ── Gera OKs de venda para posições abertas ──
  const todasPosicoes = positionManager.getOpenPositions()
  pregão.adicionarLog(`🔍 Total de posições abertas: ${todasPosicoes.length}`)
  const posicoesAbertas = todasPosicoes
    .filter(p => p.networkKey === redeAtual && p.status === "open")
  pregão.adicionarLog(`🔍 Posições em ${redeAtual}: ${posicoesAbertas.length}`)
  for (const pos of posicoesAbertas) {
    const currentPrice = await positionManager.fetchTokenPrice(pos.boughtToken)
    const profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100

    // NUNCA vende no prejuízo — proteção absoluta
    if (profitPercent <= 0) {
      const label = profitPercent < 0 ? `${profitPercent.toFixed(1)}% no prejuízo` : `break-even (0.0%)`
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: ${label} — segurando (staircase decide fechamento)`)
      continue
    }

    const confMult = volatilityTracker.getConfidenceMultiplier(pos.boughtToken)
    const sellConfidence = Math.min(90, Math.round((30 + Math.max(0, profitPercent) * 4) * confMult))
    if (sellConfidence < 35) continue

    const STOP_LOSS = -15
    const MIN_MEANINGFUL_PROFIT = 1 // 1% — micro-picos não desarmam proteção
    if (profitPercent > STOP_LOSS && (pos.peakProfitPercent ?? 0) < MIN_MEANINGFUL_PROFIT) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: ${profitPercent.toFixed(1)}% (pico ${(pos.peakProfitPercent ?? 0).toFixed(2)}%) sem lucro significativo — Staircase segura (hold)`)
      continue
    }

    if (profitPercent > 100) {
      pregão.adicionarLog(`⚠️ ${pos.boughtToken}: profit ${profitPercent.toFixed(1)}% irreal — entryPrice corrompido ($${pos.entryPrice.toFixed(4)}), pulando venda`)
      continue
    }

    const gasCost = await gasPriceOracle.getGasCost(redeAtual)
    const positionValueUSD = pos.amountBought * currentPrice
    const profitUSD = positionValueUSD * (profitPercent / 100)
    const minProfit = gasCost * 3
    if (profitUSD < minProfit && profitPercent > 0) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: lucro $${profitUSD.toFixed(2)} não cobre gas ($${gasCost.toFixed(4)} × 3 = $${minProfit.toFixed(2)}) — segurando`)
      continue
    }

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
    // Dedup: verifica se grid já está vendendo este token
    const jaVendendoGrid = pregão.getOrdensAtivas()
      .some(o => o.fromToken === pos.boughtToken && o.rede === redeAtual && o.pregueiros.some(p => p.startsWith("Grid:")))
    if (jaVendendoGrid) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken}: grid já está vendendo — agente aguarda`)
      continue
    }

    pregão.adicionarLog(`💰 Realizando lucro: ${pos.boughtToken} (${profitPercent.toFixed(1)}% → conf ${sellConfidence}%)`)

    gridTrader.onPositionClosed(pos.boughtToken as TokenSymbol, profitPercent, redeAtual)

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