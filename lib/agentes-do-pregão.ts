import { quantumAgent, technicalAgent } from "./multi-agent-system"
import { quantumWaveTrader } from "./quantum-wave"
import { pregão } from "./pregão"
import { NETWORKS, TRADING_PAIRS, realSwap, type NetworkKey, type TokenSymbol } from "./real-swap-executor"
import { positionManager } from "./position-manager"
import { volatilityTracker } from "./volatility-tracker"
import { accountant } from "./accountant"
import { gasPriceOracle } from "./gas-price-oracle"
import { jumperLearn } from "./jumper-learn"
import { pairProfitability } from "./pair-profitability"
import { gridTrader } from "./grid-trading"
import { caixa, UB_CHAIN } from "./caixa"
import { professor } from "./professor"
import { parametrosRobos } from "./parametros-robos"
import { pairSector } from "./pair-sector"

const STABLES = new Set(["USDC", "USDT", "DAI", "EURC"])

// ─── Filtro de Tendência (ADX simplificado) ───
// Armazena histórico de preços para detectar tendências fortes
// Em tendência forte (>2% no período), pausa o lado perdedor do delta neutro
const PRICE_HISTORY: Map<string, { price: number; timestamp: number }[]> = new Map()
const TREND_PERIOD_MS = 10 * 60 * 1000 // 10 minutos
const TREND_THRESHOLD = 0.02 // 2%
const TREND_CHECK_INTERVAL_MS = 60_000 // verifica a cada 1 min

let ultimaVerificacaoTendencia = 0

function registrarPreco(token: string, price: number) {
  if (price <= 0) return
  const agora = Date.now()
  if (!PRICE_HISTORY.has(token)) PRICE_HISTORY.set(token, [])
  const hist = PRICE_HISTORY.get(token)!
  hist.push({ price, timestamp: agora })
  // Mantém só os últimos TREND_PERIOD_MS
  while (hist.length > 0 && agora - hist[0].timestamp > TREND_PERIOD_MS) {
    hist.shift()
  }
}

function getTrendDirection(token: string): "up" | "down" | "flat" {
  const hist = PRICE_HISTORY.get(token)
  if (!hist || hist.length < 2) return "flat"
  const oldest = hist[0]
  const newest = hist[hist.length - 1]
  const change = (newest.price - oldest.price) / oldest.price
  if (change > TREND_THRESHOLD) return "up"
  if (change < -TREND_THRESHOLD) return "down"
  return "flat"
}

function aplicarFiltroTendencia(votes: AgentPairVote[]): AgentPairVote[] {
  const agora = Date.now()
  if (agora - ultimaVerificacaoTendencia < TREND_CHECK_INTERVAL_MS) return votes
  ultimaVerificacaoTendencia = agora

  const tokensAfetados = new Set<string>()
  for (const v of votes) {
    const tokenVolatil = v.action === "buy" ? v.toToken : v.fromToken
    if (STABLES.has(tokenVolatil)) continue
    const direcao = getTrendDirection(tokenVolatil)
    if (direcao === "flat") continue
    // Se tendência forte UP → pausa vendas (não vende em tendência de alta)
    // Se tendência forte DOWN → pausa compras (não compra em tendência de baixa)
    if ((direcao === "up" && v.action === "sell") || (direcao === "down" && v.action === "buy")) {
      tokensAfetados.add(v.agentName)
    }
  }

  if (tokensAfetados.size === 0) return votes

  const filtrados = votes.filter(v => !tokensAfetados.has(v.agentName))
  const removidos = votes.length - filtrados.length
  pregão.adicionarLog(`🧭 Filtro de Tendência: ${removidos} votos removidos (${[...tokensAfetados].join(", ")} foram contra tendência forte)`)
  return filtrados
}

// ─── Modo Papel ───
const PAPER_MODE_KEY = "arcflow_paper_mode"
export function isPaperMode(): boolean {
  if (typeof window === "undefined") return false
  return localStorage.getItem(PAPER_MODE_KEY) === "true"
}
export function setPaperMode(enabled: boolean): void {
  if (typeof window === "undefined") return
  localStorage.setItem(PAPER_MODE_KEY, enabled ? "true" : "false")
}

function getMinTradeSize(network: NetworkKey): number {
  const net = NETWORKS[network]
  if (!net || net.isTestnet) return 2
  if (network === "ethereum") return 50
  if (network === "polygon") return 6.50
  if (network === "base" || network === "arbitrum") return 2
  return 20
}

function getMinProfitReal(network: NetworkKey): number {
  if (network === "ethereum") return 0.05
  return 0.002 // $0.002 já cobre gas + spread em micro-trades rápidos
}

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
const MIN_AVALIACAO_MS = 5 * 60 * 1000
let _autoResetDone = false

function registrarVoto(voto: VotoRegistro) {
  historicoVotos.push(voto)
  if (historicoVotos.length > 500) historicoVotos.splice(0, 100)
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

    // Só avalia se movimento > 0.1% (mesmo threshold do Professor)
    // Evita penalizar agentes por ruído em mercado lateral
    if (Math.abs(profitPercent) < 0.1) continue

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
      const stake = Math.min(score.points * (voto.confidence / 100) * 0.15, 20)
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

export const AGENTE_PARES: Record<string, string[]> = {
  "USDC→EURC": ["Technical", "ArbitrageHunter", "MarketMaker", "Synthesis", "Quantum", "TrendFollower", "MeanReversion"],
  "EURC→USDC": ["Technical", "ArbitrageHunter", "MarketMaker", "Synthesis", "Quantum", "TrendFollower", "MeanReversion"],
  "USDC→cirBTC": ["BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Technical", "TrendFollower", "Quantum"],
  "cirBTC→USDC": ["BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Technical", "TrendFollower", "Quantum"],
  "USDC→mcirBTC": ["BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Technical"],
  "mcirBTC→USDC": ["BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Technical"],
  "EURC→cirBTC": ["ArbitrageHunter", "MarketMaker", "BTCTrader", "Synthesis", "Technical"],
  "cirBTC→EURC": ["ArbitrageHunter", "MarketMaker", "BTCTrader", "Synthesis", "Technical"],
  "EURC→mcirBTC": ["ArbitrageHunter", "MarketMaker", "BTCTrader", "Synthesis"],
  "mcirBTC→EURC": ["ArbitrageHunter", "MarketMaker", "BTCTrader", "Synthesis"],
  "USDC→USDT": ["ArbitrageHunter", "MarketMaker", "Synthesis"],
  "USDT→USDC": ["ArbitrageHunter", "MarketMaker", "Synthesis"],
  "USDC→WMATIC": ["Technical", "TrendFollower", "MeanReversion", "Liquidator", "MomentumTrader", "Synthesis", "Quantum"],
  "WMATIC→USDC": ["Technical", "TrendFollower", "MeanReversion", "Liquidator", "MomentumTrader", "Synthesis", "Quantum"],
  "USDC→WETH": ["Technical", "TrendFollower", "MeanReversion", "BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Quantum"],
  "WETH→USDC": ["Technical", "TrendFollower", "MeanReversion", "BTCTrader", "Liquidator", "MomentumTrader", "Synthesis", "Quantum"],
  "USDC→DAI": ["ArbitrageHunter", "MarketMaker", "Synthesis"],
  "DAI→USDC": ["ArbitrageHunter", "MarketMaker", "Synthesis"],
  "USDC→EURC-base": ["ArbitrageHunter", "MarketMaker", "Synthesis", "Technical"],
  "EURC→USDC-base": ["ArbitrageHunter", "MarketMaker", "Synthesis", "Technical"],
  "USDC→WETH-base": ["Technical", "TrendFollower", "MeanReversion", "BTCTrader", "Synthesis"],
  "WETH→USDC-base": ["Technical", "TrendFollower", "MeanReversion", "BTCTrader", "Synthesis"],
}

function agentAssigned(agentName: string, pairLabel: string): boolean {
  if (agentName === "Synthesis") return true
  const pairs = AGENTE_PARES[pairLabel]
  if (!pairs) {
    const defaultAgents = ["Quantum", "Technical", "TrendFollower", "MeanReversion", "Synthesis"]
    return defaultAgents.includes(agentName)
  }
  return pairs.includes(agentName)
}

const priceFetchCache = new Map<string, { price: number; ts: number }>()
const PRICE_CACHE_TTL = 15000

async function getTokenPrice(token: TokenSymbol): Promise<number> {
  const cached = priceFetchCache.get(token)
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) return cached.price

  const coinIds: Record<string, string> = {
    WETH: "1673723677362319867", WMATIC: "1730847291434274818", ARB: "1673723677362319902",
    WBTC: "1673723677362319866", USDC: "1673723677362319870", EURC: "1673723677362320241",
    cirBTC: "1673723677362319866",
  }
  const coinId = coinIds[token]
  if (!coinId) { priceFetchCache.set(token, { price: 1.0, ts: Date.now() }); return 1.0 }
  try {
    const res = await fetch(`/api/price?ids=${coinId}`)
    if (!res.ok) return 1.0
    const body = await res.json()
    const data = body.prices ?? body
    const price = data[coinId] ?? 1.0
    priceFetchCache.set(token, { price, ts: Date.now() })
    return price
  } catch { return 1.0 }
}

async function fetchPricesBatch(tokens: TokenSymbol[]): Promise<Map<string, number>> {
  const coinIds: Record<string, string> = {
    WETH: "1673723677362319867", WMATIC: "1730847291434274818", ARB: "1673723677362319902",
    WBTC: "1673723677362319866", USDC: "1673723677362319870", EURC: "1673723677362320241",
    cirBTC: "1673723677362319866",
  }
  const needed = tokens.filter(t => {
    const cached = priceFetchCache.get(t)
    return !cached || Date.now() - cached.ts >= PRICE_CACHE_TTL
  })
  if (needed.length === 0) {
    const result = new Map<string, number>()
    for (const t of tokens) result.set(t, priceFetchCache.get(t)!.price)
    return result
  }
  const idsToFetch = needed.map(t => coinIds[t]).filter(Boolean)
  const uniqueIds = [...new Set(idsToFetch)]
  try {
    const res = await fetch(`/api/price?ids=${uniqueIds.join(",")}`)
    if (res.ok) {
      const body = await res.json()
      const prices = body.prices ?? body
      for (const t of needed) {
        const id = coinIds[t]
        if (id && prices[id] !== undefined) {
          priceFetchCache.set(t, { price: prices[id], ts: Date.now() })
        }
      }
    }
  } catch {}
  const result = new Map<string, number>()
  for (const t of tokens) {
    const cached = priceFetchCache.get(t)
    result.set(t, cached ? cached.price : 1.0)
  }
  return result
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
  const isMultiChain = !rede || rede === "all"

  // Filtra redes multi-chain: só inclui redes onde o usuário tem saldo USDC
  let chainNamesWithBalance = new Set<string>()
  if (isMultiChain) {
    try {
      const s = await caixa.getSaldo("mainnet")
      for (const [name, bal] of Object.entries(s.porRede)) {
        if (bal > 0) chainNamesWithBalance.add(name)
      }
    } catch {}
  }

  const networksToScan: NetworkKey[] = isMultiChain
    ? (Object.keys(NETWORKS) as NetworkKey[]).filter(k => {
        if (!NETWORKS[k] || NETWORKS[k].isTestnet) return false
        if (chainNamesWithBalance.size === 0) return true // fallback: todas
        const ubName = UB_CHAIN[k]
        return ubName ? chainNamesWithBalance.has(ubName) : true
      })
    : [rede as NetworkKey]
  if (networksToScan.length === 0) {
    console.warn(`[AGENTES] Nenhuma rede para scanear`)
    return { totalPairs: 0, votes: [], agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }
  const redeAtual = networksToScan[0]
  const net = NETWORKS[redeAtual]
  const pairs = TRADING_PAIRS[redeAtual] || []
  const isArc = redeAtual === "arc" && net?.isTestnet

  // 🔁 Aprendizado: intercepta receberOK de agentes em TODAS as redes
  // Cada voto vira:
  //   1. [APRENDIZADO] no log (só em testnet, mainnet vai pro Pregão)
  //   2. Palpite pro Professor (avalia após 5 min)
  //   3. Avaliação no PairSector (categorizada por rede alvo)
  // Regra: só registra palpite se o par pertence à rede atual (evita conflitos
  // cross-network onde WMATIC da Polygon seria avaliado contra preço da Arc)
  // 🔥 FIX CRÍTICO: wrapper só INTERCEPTA (não encaminha) sinais de agentes na TESTNET.
  // Em mainnet, registra aprendizado E encaminha ao pregão para execução real.
  const originalReceberOK = pregão.receberOK.bind(pregão)
  pregão.receberOK = (signal) => {
    if (signal.pregueiro.startsWith("Agente:")) {
      const nomeRobo = signal.pregueiro.replace("Agente:", "")
      if (isArc) {
        pregão.adicionarLog(`[APRENDIZADO] ${nomeRobo} → ${signal.par} (${signal.confianca}%) na ${signal.rede}`)
      }
      if (signal.direcao && signal.precoNoPalpite) {
        if (signal.rede !== redeAtual) {
          if (isArc) pregão.adicionarLog(`[APRENDIZADO] ${nomeRobo} → ${signal.par} — pulando (rede ${signal.rede} ≠ atual ${redeAtual})`)
          if (isArc) return  // só bloqueia cross-network na testnet
        }
        if (signal.rede === redeAtual || !isArc) {
          const coinIds: Record<string, number> = { WETH: 1, WMATIC: 1, ARB: 1, WBTC: 1, SOL: 1, USDC: 1, EURC: 1, cirBTC: 1, mcirBTC: 1 }
          const tokenVolatil = signal.direcao === "buy" ? signal.toToken : signal.fromToken
          if (coinIds[tokenVolatil]) {
            professor.registrarPalpite({
              roboNome: nomeRobo,
              rede: signal.rede,
              par: signal.par,
              fromToken: signal.fromToken,
              toToken: signal.toToken,
              direcao: signal.direcao,
              confianca: signal.confianca,
              precoNoPalpite: signal.precoNoPalpite,
              timestamp: Date.now(),
            })
            pairSector.registrarAvaliacao({
              par: signal.par,
              rede: signal.rede as NetworkKey,
              fromToken: signal.fromToken as TokenSymbol,
              toToken: signal.toToken as TokenSymbol,
              roboNome: nomeRobo,
              direcao: signal.direcao,
              confianca: signal.confianca,
              precoNoPalpite: signal.precoNoPalpite,
              timestamp: Date.now(),
            })
          } else if (isArc) {
            pregão.adicionarLog(`[APRENDIZADO] ${nomeRobo} → ${signal.par} — pulando avaliação (${tokenVolatil} sem price feed)`)
          }
        }
      }
      if (isArc) return  // testnet: aprendizado apenas, não executa
    }
    originalReceberOK(signal)  // mainnet: registra aprendizado + encaminha ao pregão
  }

  // Monta lista combinada de pares de todas as redes alvo
  interface PairWithNetwork { net: NetworkKey; from: TokenSymbol; to: TokenSymbol; label: string }
  const allPairs: PairWithNetwork[] = []
  for (const nk of networksToScan) {
    const ps = TRADING_PAIRS[nk]
    if (ps) {
      for (const p of ps) allPairs.push({ net: nk, ...p })
    }
  }
  const multiPairs = allPairs.length > 0 ? allPairs : pairs.map(p => ({ net: redeAtual, ...p }))

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

  // 📚 Professor avalia palpites pendentes (a cada 5 min)
  await professor.avaliarPalpites()

  // 🧹 Remove avaliações antigas de tokens sem price feed (cirBTC, mcirBTC etc.)
  pairSector.limparInvalidos()

  for (const nome of ["Grid", "GridRef"]) {
    accountant.removeAgent(nome)
    for (let i = historicoVotos.length - 1; i >= 0; i--) {
      if (historicoVotos[i].agentName === nome) historicoVotos.splice(i, 1)
    }
  // Garante pool de 500pts distribuido igualmente apos remover Grid/GridRef
  accountant.rebalancePool()
  }

  let maxPositions = 10
  gridTrader.init(redeAtual)

  if (!net.isTestnet) {
    // Multi-chain: unified balance via Circle Kit (funciona no navegador, sem CORS)
    let totalUnificado = 0
    if (isMultiChain) {
      try {
        const saldoCaixa = await caixa.getSaldo("mainnet")
        totalUnificado = saldoCaixa.totalUSD
      } catch {
        totalUnificado = 0
      }
    }
    const walletUSDC = realSwap.getBalance("USDC")
    if (isMultiChain && walletUSDC > totalUnificado) {
      pregão.adicionarLog(`📊 Unified balance $${totalUnificado.toFixed(2)} < wallet $${walletUSDC.toFixed(2)} — usando wallet como referência`)
    }
    const balUSDC = isMultiChain ? Math.max(totalUnificado, walletUSDC) : walletUSDC
    const balUSDT = isMultiChain ? 0 : realSwap.getBalance("USDT")
    const balDAI = isMultiChain ? 0 : realSwap.getBalance("DAI")
    const maiorStable = isMultiChain ? balUSDC : Math.max(balUSDC, balUSDT, balDAI)
    const allowed = getPregãoAllowedBalance();
    const saldoEfetivo = allowed === Infinity ? maiorStable : Math.min(maiorStable, allowed);
    const posAbertas = positionManager.getOpenPositions().length;
    // Usa o maior minTradeSize entre as redes alvo (garante que cabe em todas)
    const minTradeSize = Math.max(...networksToScan.map(n => getMinTradeSize(n)))
    maxPositions = Math.max(1, Math.floor((saldoEfetivo * 0.9) / minTradeSize))
    const vagas = Math.max(1, maxPositions - posAbertas);

    if (saldoEfetivo < minTradeSize) {
      amountUsd = 0
      const localUsdc = isMultiChain ? realSwap.getBalance("USDC") : saldoEfetivo
      pregão.adicionarLog(`⚠️ Saldo USDC baixo: unified $${saldoEfetivo.toFixed(2)} / local $${localUsdc.toFixed(2)} — mínimo $${minTradeSize.toFixed(2)}`)
      // Força refresh do saldo on-chain (pode estar desatualizado)
      await realSwap.refreshAllBalances().catch(() => { console.warn('[AGENTES] refreshAllBalances falhou (assíncrono)') })
      const usdcAgora = realSwap.getBalance("USDC")
      if (usdcAgora >= minTradeSize) {
        pregão.adicionarLog(`🔄 Após refresh: USDC = $${usdcAgora.toFixed(2)} — saldo suficiente`)
        // Sai do auto-reabastecimento e segue normalmente
        amountUsd = Math.min(Math.max(minTradeSize * 1.2, 2.0), (usdcAgora * 0.9) / Math.max(1, maxPositions - positionManager.getOpenPositions().length))
      } else {
        // Auto-reabastecimento: vender posições abertas ou tokens avulsos
        const posicoes = positionManager.getOpenPositions()
        const posVendiveis = posicoes.filter(p => p.networkKey === redeAtual)
        if (posVendiveis.length > 0) {
          pregão.adicionarLog(`🔄 Auto-reabastecimento: ${posVendiveis.length} posição(ões) disponíveis para venda`)
          for (const pos of posVendiveis) {
            const sellPar = `${pos.boughtToken}→USDC`
            for (const nome of ["Cleanup", "ForcarVenda", "MeanReversion"]) {
              pregão.receberOK({
                pregueiro: nome,
                rede: pos.networkKey,
                par: sellPar,
                confianca: 90,
                timestamp: Date.now(),
                fromToken: pos.boughtToken,
                toToken: "USDC",
              })
            }
            pregão.adicionarLog(`📢 Auto-sell: ${sellPar} em ${pos.networkKey} — 3 OKs injetados`)
          }
        } else {
          // Sem posições: verificar saldo de voláteis na wallet e vender
          const VOLATEIS_WALLET = ["WMATIC", "WETH", "WBTC", "ARB"]
          let vendeu = false
          for (const token of VOLATEIS_WALLET) {
            const bal = realSwap.getBalance(token as TokenSymbol)
            if (bal > 0.001) {
              const sellPar = `${token}→USDC`
              for (const nome of ["Cleanup", "ForcarVenda", "MeanReversion"]) {
                pregão.receberOK({
                  pregueiro: nome,
                  rede: redeAtual,
                  par: sellPar,
                  confianca: 90,
                  timestamp: Date.now(),
                  fromToken: token,
                  toToken: "USDC",
                })
              }
              pregão.adicionarLog(`📢 Auto-sell: ${sellPar} (${bal.toFixed(4)} ${token}) — 3 OKs injetados`)
              vendeu = true
            }
          }
          if (!vendeu) {
            pregão.adicionarLog(`💰 Deposite USDC na wallet ${realSwap.getAddress()} (Polygon) para retomar os trades`)
          }
        }
        return {
          totalPairs: 0,
          votes: [],
          agreedPair: null,
          agreeingAgents: 0,
          waveCollapsed: false,
        }
      }
    } else {
      amountUsd = Math.min(Math.max(minTradeSize * 1.2, 2.0), (saldoEfetivo * 0.9) / vagas);
      const sampleVolToken = [...new Set(multiPairs.filter(p => !STABLES.has(p.to)).map(p => p.to))][0] || "USDC"
      const volMult = volatilityTracker.getPositionSizeMultiplier(sampleVolToken)
      if (volMult < 1.0) {
        const original = amountUsd
        amountUsd = Math.round((amountUsd * volMult) * 100) / 100
        pregão.adicionarLog(`🧠 VolTracker: trade $${original.toFixed(2)} → $${amountUsd.toFixed(2)} (vol mult ${volMult.toFixed(1)}x)`)
      }
      const redeStr = isMultiChain ? `multi-chain (${networksToScan.join(", ")})` : redeAtual
      pregão.adicionarLog(`💰 Pregão alocou $${amountUsd.toFixed(2)} para este trade (saldo unificado $${maiorStable.toFixed(2)}, permitido $${allowed === Infinity ? "∞" : allowed.toFixed(2)}, ${posAbertas}/${maxPositions} posições, redes: ${redeStr})`)
    }
  }

  if (amountUsd === undefined || amountUsd <= 0) amountUsd = 5

  // 🔥 Multi-chain: usa pares de TODAS as redes alvo
  let pairsToAnalyze: { net: NetworkKey; label: string }[]
  if (net.isTestnet) {
    pairsToAnalyze = multiPairs.map(p => ({ net: p.net, label: p.label }))
  } else {
    if (isMultiChain) {
      const VOLATEIS = new Set(["WETH", "WBTC", "WMATIC", "ARB", "cirBTC", "mcirBTC"])
      pairsToAnalyze = multiPairs
        .filter(p => p.net !== "ethereum") // ignora Ethereum (gas caro para micro-trades)
        .filter(p => [...VOLATEIS].some(v => p.label.includes(v))) // só voláteis
        .map(p => ({ net: p.net, label: p.label }))
      if (pairsToAnalyze.length === 0) {
        // Fallback: todos os pares (exceto ETH) se não houver voláteis
        pairsToAnalyze = multiPairs
          .filter(p => p.net !== "ethereum")
          .map(p => ({ net: p.net, label: p.label }))
        pregão.adicionarLog(`⚠️ Nenhum par volátil disponível em multi-chain — usando todos`)
      }
    } else {
      const pairsFromProf = pairProfitability.getPairsForAnalysis(redeAtual)
      if (redeAtual !== "ethereum") {
        const VOLATEIS = new Set(["WETH", "WBTC", "WMATIC", "ARB", "cirBTC", "mcirBTC"])
        const filtered = pairsFromProf
          .filter(label => [...VOLATEIS].some(v => label.includes(v)))
          .sort((a, b) => {
            const aVol = [...VOLATEIS].some(v => a.includes(v)) ? 0 : 1
            const bVol = [...VOLATEIS].some(v => b.includes(v)) ? 0 : 1
            return aVol - bVol
          })
        pairsToAnalyze = (filtered.length > 0 ? filtered : pairsFromProf)
          .map(label => ({ net: redeAtual, label }))
      } else {
        pairsToAnalyze = pairsFromProf.map(label => ({ net: redeAtual, label }))
      }
    }
  }
  // 💰 Filtrar pares com saldo < $1 para evitar ruído
  const antesFiltro = pairsToAnalyze.length
  const tokenPrices = await Promise.all(
    [...new Set(multiPairs.map(p => p.from))].map(async (t) => {
      const price = await positionManager.fetchTokenPrice(t as TokenSymbol).catch(() => 0)
      return { token: t, usd: price }
    })
  )
  const priceMap = new Map(tokenPrices.map(p => [p.token, p.usd]))
  pairsToAnalyze = pairsToAnalyze.filter(({ net: pairNet, label }) => {
    const p = multiPairs.find(mp => mp.net === pairNet && mp.label === label)
    if (!p) return false
    const bal = realSwap.getBalance(p.from as TokenSymbol)
    if (STABLES.has(p.from)) return bal >= 1
    const price = priceMap.get(p.from) ?? 0
    return bal * price >= 1
  })
  if (pairsToAnalyze.length < antesFiltro) {
    pregão.adicionarLog(`💸 ${antesFiltro - pairsToAnalyze.length} pares filtrados por saldo < $1`)
  }
  pregão.adicionarLog(`🎯 Analisando ${pairsToAnalyze.length} pares em ${isMultiChain ? networksToScan.length + " redes" : redeAtual}: ${pairsToAnalyze.map(p => p.net + ":" + p.label).join(', ')}`)

  const wave = await quantumWaveTrader.broadcastIntent(amountUsd)
  const wavePairs = wave.pairs // mantém TODOS os pares (multi-chain)
  gridTrader.setWaveData(wavePairs, redeAtual)

  let allVotes: AgentPairVote[] = []

  const tokensParaColetar = new Set<TokenSymbol>()
  for (const p of multiPairs) {
    tokensParaColetar.add(p.from); tokensParaColetar.add(p.to)
  }
  volatilityTracker.collectPrices([...tokensParaColetar]).catch(() => { console.warn('[AGENTES] collectPrices falhou') })

  const volatileParaRede = [...tokensParaColetar].filter(t => !STABLES.has(t))
  // Reconcilia saldos em todas as redes alvo
  if (isMultiChain) {
    await Promise.all(networksToScan.map(nk => positionManager.reconcileBalances(nk, volatileParaRede)))
  } else {
    await positionManager.reconcileBalances(redeAtual, volatileParaRede)
  }

  // 🔥 Análise paralela de TODOS os pares simultaneamente (multi-chain)
  const pairResults = await Promise.all(pairsToAnalyze.map(async ({ net: pairNet, label: pairLabel }) => {
    const pair = multiPairs.find(p => p.net === pairNet && p.label === pairLabel)
    if (!pair) return { pairLabel, votes: [] }
    const wavePair = wavePairs.find(wp => wp.network === pairNet && wp.label === pairLabel)
    if (!wavePair) return { pairLabel, votes: [] }

    const assigned = AGENTES_NOMES
      .filter(a => agentAssigned(a.nome, pairLabel))
      .map(a => a.nome)
    // ── Pré-carrega preços uma única vez para todos os agentes ──
    const [pairFromPrice, pairToPrice] = await Promise.all([
      getTokenPrice(pair.from as TokenSymbol),
      getTokenPrice(pair.to as TokenSymbol),
    ])
    const spreadPct = pairFromPrice > 0 ? Math.abs((pairToPrice - pairFromPrice) / pairFromPrice * 100) : 0
    const isStableStable = STABLES.has(pair.from) && STABLES.has(pair.to)
    const isBtcEth = pair.from === "WBTC" || pair.to === "WBTC" ||
                     pair.from === "WETH" || pair.to === "WETH"

    // ── Todos os agentes em paralelo ──
    const agentEvals = await Promise.all([
      // QuantumAgent
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("Quantum", pairLabel)) return []
        const pQ = parametrosRobos.get("Quantum")
        try {
          const result = await quantumAgent.evaluatePair(wavePair)
          if (result && result.confidence >= pQ.confiancaMinima) {
            return [{
              agentName: "Quantum", pair: pairLabel, fromToken: wavePair.fromToken,
              toToken: wavePair.toToken, network: pairNet, confidence: result.confidence,
              action: wavePair.momentum > 0 ? "buy" : "sell",
              reason: `Onda quântica: amplitude ${(wavePair.amplitude * 100).toFixed(0)}%`,
            }]
          }
        } catch {
          const fallbackConfidence = Math.min(60, Math.round(pQ.confiancaMinima + Math.abs(wavePair.momentum) * 300))
          if (fallbackConfidence >= pQ.confiancaMinima) {
            return [{
              agentName: "Quantum", pair: pairLabel, fromToken: wavePair.fromToken,
              toToken: wavePair.toToken, network: pairNet, confidence: fallbackConfidence,
              action: wavePair.momentum > 0 ? "buy" : "sell",
              reason: `Quantum fallback: momentum ${(wavePair.momentum * 100).toFixed(2)}%`,
            }]
          }
        }
        return []
      })(),

      // TechnicalAgent
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("Technical", pairLabel)) return []
        try {
          const pT = parametrosRobos.get("Technical")
          const mockPrices = [1.0, 1.001, 0.999, 1.002, 1.0 + wavePair.momentum * 10]
          const indicators = technicalAgent.calculateIndicators(mockPrices)
          const rsi = indicators.rsi
          const rsiAction: "buy" | "sell" | "hold" = rsi < pT.rsiCompra ? "buy" : rsi > pT.rsiVenda ? "sell" : "hold"
          if (rsiAction !== "hold") {
            const confidence = Math.min(90, Math.round(40 + Math.abs(rsi - 50) * 0.8))
            if (confidence >= pT.confiancaMinima) {
              return [{
                agentName: "Technical", pair: pairLabel, fromToken: wavePair.fromToken,
                toToken: wavePair.toToken, network: pairNet, confidence,
                action: rsiAction,
                reason: `RSI: ${Math.round(rsi)} — ${rsiAction === "buy" ? "sobrevendido" : "sobrecomprado"}`,
              }]
            }
          }
        } catch {}
        return []
      })(),

      // TrendFollower
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("TrendFollower", pairLabel) || Math.abs(wavePair.momentum) <= parametrosRobos.get("TrendFollower").thresholdEntrada) return []
        const confidence = Math.min(80, Math.round(30 + Math.abs(wavePair.momentum) * 800))
        return [{
          agentName: "TrendFollower", pair: pairLabel, fromToken: wavePair.fromToken,
          toToken: wavePair.toToken, network: pairNet, confidence,
          action: wavePair.momentum > 0 ? "buy" : "sell",
          reason: `Trend ${wavePair.momentum > 0 ? "🠕" : "🠗"} momentum ${(wavePair.momentum * 100).toFixed(2)}%`,
        }]
      })(),

      // MeanReversion
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("MeanReversion", pairLabel) || wavePair.amplitude <= parametrosRobos.get("MeanReversion").thresholdEntrada) return []
        const confidence = Math.min(80, Math.round(30 + wavePair.amplitude * 600))
        return [{
          agentName: "MeanReversion", pair: pairLabel, fromToken: wavePair.fromToken,
          toToken: wavePair.toToken, network: pairNet, confidence,
          action: wavePair.momentum > 0 ? "sell" : "buy",
          reason: `Reversão: amplitude ${(wavePair.amplitude * 100).toFixed(2)}%`,
        }]
      })(),

      // ArbitrageHunter
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("ArbitrageHunter", pairLabel) || !isStableStable) return []
        const pAH = parametrosRobos.get("ArbitrageHunter")
        if (spreadPct > pAH.thresholdSpread) {
          return [{
            agentName: "ArbitrageHunter", pair: pairLabel, fromToken: pair.from,
            toToken: pair.to, network: pairNet,
            confidence: Math.min(75, Math.round(30 + spreadPct * 10)),
            action: pairToPrice > pairFromPrice ? "sell" : "buy",
            reason: `Arbitragem ${pairLabel} (spread ${spreadPct.toFixed(3)}%)`,
          }]
        }
        return []
      })(),

      // MarketMaker
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("MarketMaker", pairLabel)) return []
        const pMM = parametrosRobos.get("MarketMaker")
        if (spreadPct > pMM.thresholdSpread) {
          return [{
            agentName: "MarketMaker", pair: pairLabel, fromToken: pair.from,
            toToken: pair.to, network: pairNet,
            confidence: Math.min(70, Math.round(40 + spreadPct * 20)),
            action: pairToPrice > pairFromPrice ? "sell" : "buy",
            reason: `Market ${pairLabel} ${pairToPrice > pairFromPrice ? "🠕" : "🠗"} (${spreadPct.toFixed(3)}%)`,
          }]
        }
        return []
      })(),

      // BTCTrader
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("BTCTrader", pairLabel) || !isBtcEth) return []
        const pBT = parametrosRobos.get("BTCTrader")
        if (spreadPct > pBT.thresholdSpread) {
          return [{
            agentName: "BTCTrader", pair: pairLabel, fromToken: pair.from,
            toToken: pair.to, network: pairNet, confidence: 65,
            action: pairToPrice > pairFromPrice ? "sell" : "buy",
            reason: `BTC/ETH ${pairLabel} ${pairToPrice > pairFromPrice ? "🠕" : "🠗"}`,
          }]
        }
        return []
      })(),

      // Liquidator
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("Liquidator", pairLabel) || wavePair.liquidity <= parametrosRobos.get("Liquidator").thresholdLiquidez) return []
        return [{
          agentName: "Liquidator", pair: pairLabel, fromToken: wavePair.fromToken,
          toToken: wavePair.toToken, network: pairNet,
          confidence: Math.round(wavePair.liquidity * 60),
          action: wavePair.momentum > 0 ? "buy" : "sell",
          reason: `Liquidez ${(wavePair.liquidity * 100).toFixed(0)}% — ${pairLabel}`,
        }]
      })(),

      // MomentumTrader
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("MomentumTrader", pairLabel) || Math.abs(wavePair.momentum) * wavePair.volatility <= parametrosRobos.get("MomentumTrader").thresholdEntrada) return []
        const momentumScore = Math.abs(wavePair.momentum) * wavePair.volatility
        return [{
          agentName: "MomentumTrader", pair: pairLabel, fromToken: wavePair.fromToken,
          toToken: wavePair.toToken, network: pairNet,
          confidence: Math.min(90, Math.round(40 + momentumScore * 2000)),
          action: wavePair.momentum > 0 ? "buy" : "sell",
          reason: `Momento × vol = ${(momentumScore * 10000).toFixed(0)} — ${wavePair.momentum > 0 ? "🠕🠕" : "🠗🠗"}`,
        }]
      })(),

      // NVIDIAgent
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("NVIDIAgent", pairLabel) || wavePair.probability <= parametrosRobos.get("NVIDIAgent").thresholdProbabilidade) return []
        return [{
          agentName: "NVIDIAgent", pair: pairLabel, fromToken: wavePair.fromToken,
          toToken: wavePair.toToken, network: pairNet,
          confidence: Math.min(90, Math.round(wavePair.probability)),
          action: wavePair.momentum > 0 ? "buy" : "sell",
          reason: `NIM: ondas de probabilidade — ${pairLabel}`,
        }]
      })(),

      // Synthesis
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("Synthesis", pairLabel)) return []
        const pSyn = parametrosRobos.get("Synthesis")
        const synthConfidence = Math.min(65, Math.round(pSyn.confiancaMinima + 5 + Math.abs(wavePair.momentum) * 200))
        if (synthConfidence >= pSyn.confiancaMinima) {
          return [{
            agentName: "Synthesis", pair: pairLabel, fromToken: wavePair.fromToken,
            toToken: wavePair.toToken, network: pairNet, confidence: synthConfidence,
            action: wavePair.momentum > 0 ? "buy" : "sell",
            reason: `Síntese automática: momentum ${(wavePair.momentum * 100).toFixed(2)}%`,
          }]
        }
        return []
      })(),

      // Morse
      (async (): Promise<AgentPairVote[]> => {
        if (!agentAssigned("Morse", pairLabel)) return []
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
            return [{
              agentName: "Morse", pair: pairLabel, fromToken: wavePair.fromToken,
              toToken: wavePair.toToken, network: pairNet, confidence: confianca,
              action: direcaoUnica,
              reason: `📻 ${metrs} → ${direcaoUnica === "buy" ? "⬆ COMPRA" : "⬇ VENDA"} (${metrics.length}/${metrics.length} alinhadas)`,
            }]
          }
        }
        return []
      })(),
    ])

    const votesForPair: AgentPairVote[] = agentEvals.flat()

    if (votesForPair.length === 1 && votesForPair[0].confidence < 60) {
      const synthConfidence = Math.min(65, Math.round(votesForPair[0].confidence + 15))
      votesForPair.push({
        agentName: "Synthesis",
        pair: pairLabel,
        fromToken: wavePair.fromToken,
        toToken: wavePair.toToken,
        network: pairNet,
        confidence: synthConfidence,
        action: votesForPair[0].action,
        reason: `Desempate: ${votesForPair[0].agentName} sugeriu, Synthesis confirma`,
      })
    }

    return { pairLabel, votes: votesForPair }
  }))

  // ⚡ Merge dos resultados paralelos
  for (const result of pairResults) {
    allVotes.push(...result.votes)
    if (result.votes.length >= 2) {
      const pair = pairs.find(p => p.label === result.pairLabel)
      const avgConfidence = result.votes.reduce((s, v) => s + v.confidence, 0) / result.votes.length
      const topConfidence = Math.max(...result.votes.map(v => v.confidence))
      const isStablePair = pair ? (STABLES.has(pair.from) && STABLES.has(pair.to)) : false
      const MIN_CONFIDENCE = net.isTestnet && isStablePair ? 30 : 40
      
      if (avgConfidence >= MIN_CONFIDENCE) {
        pregão.adicionarLog(`✅ Consenso em ${result.pairLabel}: ${result.votes.length} agentes, confiança média ${avgConfidence.toFixed(1)}%, top ${topConfidence.toFixed(0)}%`)
      } else {
        pregão.adicionarLog(`⚠️ Consenso em ${result.pairLabel} mas confiança baixa (média ${avgConfidence.toFixed(1)}% < ${MIN_CONFIDENCE}%)`)
      }
    } else if (result.votes.length > 0) {
      pregão.adicionarLog(`❌ Sem consenso em ${result.pairLabel}: apenas ${result.votes.length} agente`)
    }
  }

  // 🔥 Blindar votos BUY+SELL simultâneos do mesmo agente no EXATO mesmo par
  // (ex: BUY USDC→WMATIC + SELL USDC→WMATIC). Não remove votos em pares invertidos
  // (BUY USDC→WMATIC + SELL WMATIC→USDC são complementares, não conflito)
  const votosRemovidos: string[] = []
  for (const v of allVotes) {
    const conflito = allVotes.find(o =>
      o.agentName === v.agentName &&
      o.network === v.network &&
      o.fromToken === v.fromToken &&
      o.toToken === v.toToken &&
      o.action !== v.action
    )
    if (conflito && !votosRemovidos.includes(v.agentName)) {
      votosRemovidos.push(v.agentName)
    }
  }
  if (votosRemovidos.length > 0) {
    const antes = allVotes.length
    allVotes = allVotes.filter(v => !votosRemovidos.includes(v.agentName))
    pregão.adicionarLog(`🧹 Blindagem: ${votosRemovidos.join(", ")} votaram BUY+SELL no exato par — ${antes - allVotes.length} votos removidos`)
  }

  // Grid trading: em multi-chain, verifica grids de TODAS as redes alvo
  if (!isMultiChain) {
    // Single-network: grid normal
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
  }

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
    
    if (votes.length === 0 && wavePairs.length > 0) {
      const fallbackWave = wavePairs.filter(wp => wp.fromToken !== wp.toToken)
        .sort((a, b) => b.probability - a.probability)[0]
      if (fallbackWave) {
        votes.push({
          agentName: "Synthesis",
          pair: fallbackWave.label,
          fromToken: fallbackWave.fromToken,
          toToken: fallbackWave.toToken,
          network: fallbackWave.network,
          confidence: Math.min(60, Math.round(fallbackWave.probability)),
          action: fallbackWave.momentum > 0 ? "buy" : "sell",
          reason: `Síntese fallback: ${fallbackWave.label} (prob ${fallbackWave.probability.toFixed(0)}%)`,
        })
      }
    }
  }

  for (const v of votes) {
    if (v.agentName === "Grid" || v.agentName === "GridRef") continue
    const tokenVolatil = v.action === "buy" ? v.toToken : v.fromToken
    if (STABLES.has(tokenVolatil)) continue
    const precoVoto = await positionManager.fetchTokenPrice(tokenVolatil as TokenSymbol).catch(() => 0)
    if (precoVoto > 0) {
      registrarPreco(tokenVolatil, precoVoto)
      registrarVoto({
        agentName: v.agentName,
        fromToken: v.fromToken,
        toToken: v.toToken,
        priceAtVote: precoVoto,
        confidence: v.confidence,
        action: v.action,
        timestamp: Date.now(),
        networkKey: v.network,
      })
    }
  }

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

  // 🧭 Filtro de Tendência: remove votos contra tendência forte
  votes = aplicarFiltroTendencia(votes)

  for (const v of votes) {
    pregão.adicionarLog(`🗳️ ${v.agentName} → ${v.pair} (${v.confidence}%)`)
  }

  const ranking = accountant.getRanking()
    .filter(s => s.agentName !== "Grid" && s.agentName !== "GridRef")
    .filter(s => votes.some(v => v.agentName === s.agentName))
  const top3Nomes = new Set(ranking.slice(0, 3).map(s => s.agentName))
  const topVotes = votes.filter(v => top3Nomes.has(v.agentName) && v.confidence > 0)

  pregão.adicionarLog(`🏆 Top 3 (${votes.length} votantes): ${ranking.slice(0, 3).map(s => `${s.agentName}(${s.score.toFixed(0)})`).join(', ')} — ${topVotes.length} votos com confiança > 0`)

  const pairCount = new Map<string, { votes: AgentPairVote[]; count: number }>()
  for (const v of topVotes) {
    const key = `${v.network}:${v.pair}`
    const existing = pairCount.get(key) || { votes: [], count: 0 }
    existing.votes.push(v)
    existing.count++
    pairCount.set(key, existing)
  }

  // 🔥 Execução paralela: encontra até 3 pares com consenso
  interface AgreedPairCandidates {
    pair: AgentPairVote
    agents: AgentPairVote[]
  }
  const candidatePairs: AgreedPairCandidates[] = []

  // 1º passada: pares com >= 2 votos diretos (pairCount = top3 consensus)
  for (const [, data] of pairCount) {
    if (data.count >= 2 && candidatePairs.length < 3) {
      candidatePairs.push({ pair: data.votes[0], agents: data.votes })
    }
  }

  // 2º passada: Tendência Express (confidence > 70 + 1 supporter)
  if (candidatePairs.length === 0) {
    const tendenciaVotes = votes.filter(v => v.confidence > 70)
    for (const tv of tendenciaVotes) {
      if (candidatePairs.length >= 3) break
      const supporters = votes.filter(v =>
        v.agentName !== tv.agentName &&
        v.pair === tv.pair &&
        v.network === tv.network &&
        v.action === tv.action &&
        v.confidence > 0
      )
      if (supporters.length >= 1) {
        candidatePairs.push({ pair: tv, agents: [tv, supporters[0]] })
        pregão.adicionarLog(`⚡ Tendência Express: ${tv.agentName} (${tv.confidence}%) + ${supporters[0].agentName} (${supporters[0].confidence}%) em ${tv.pair}`)
      }
    }
  }

  // 3º passada: fallback — qualquer par com >= 2 votos
  if (candidatePairs.length === 0) {
    pregão.adicionarLog(`🤔 Top 3 não chegou a consenso — ${topVotes.length} votos em ${pairCount.size} pares`)
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
      if (data.count >= 2 && candidatePairs.length < 3) {
        candidatePairs.push({ pair: data.votes[0], agents: data.votes })
        pregão.adicionarLog(`🔄 Fallback: ${data.votes.length} agentes concordaram em ${data.votes[0].pair}`)
      }
    }
  }

  if (candidatePairs.length === 0) {
    return { totalPairs: pairs.length, votes, agreedPair: null, agreeingAgents: 0, waveCollapsed: false }
  }

  const allUniqueAgents = new Set<string>()
  for (const cp of candidatePairs) {
    for (const v of cp.agents) allUniqueAgents.add(v.agentName)
  }

  const vagasRestantes = Math.max(0, maxPositions - positionManager.getOpenPositions().length)
  let vagasUsadas = positionManager.getOpenPositions().length
  for (const cp of candidatePairs) {
    const agreedPair = cp.pair
    const agreeingAgents = cp.agents
    const uniqueAgents = new Set(agreeingAgents.map(v => v.agentName))
    const agentesStr = [...uniqueAgents].join(", ")
    const comprandoVolatil = STABLES.has(agreedPair.fromToken) && !STABLES.has(agreedPair.toToken)

    // Pula se não há vagas para compra volátil
    if (comprandoVolatil && vagasUsadas >= vagasRestantes) {
      pregão.adicionarLog(`⏳ ${maxPositions}/${maxPositions} posições ocupadas — ${agreedPair.pair} aguardando vaga`)
      continue
    }

    if (comprandoVolatil) {
      const pairNet = agreedPair.network
      const gasCost = await gasPriceOracle.getGasCost(pairNet)
      const valorFinal = isMultiChain ? amountUsd! * 0.9 : Math.min(amountUsd! * 0.9, realSwap.getBalance(agreedPair.fromToken as TokenSymbol))

      const volData = volatilityTracker.getVolatility(agreedPair.toToken as TokenSymbol)
      const vol24h = Math.max(volData.vol24h, 0.005)
      const avgConfidence = agreeingAgents.reduce((s: number, v: AgentPairVote) => s + v.confidence, 0) / agreeingAgents.length

      const expectedReturn = (avgConfidence / 100) * vol24h
      const spreadPct = Math.max(0.001, 0.005 - vol24h * 0.04)
      const minViableTrade = (getMinProfitReal(pairNet) + gasCost) / Math.max(0.001, expectedReturn - spreadPct)
      const minSizeForCheck = getMinTradeSize(pairNet)

      const isTestnetNet = NETWORKS[pairNet]?.isTestnet ?? false
      if (isTestnetNet) {
        pregão.adicionarLog(`🧪 Testnet volatile ${agreedPair.pair}: ignorando threshold — executando`)
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} em ${pairNet} (${agreedPair.fromToken}→${agreedPair.toToken})`)
        const precoPalpite = await positionManager.fetchTokenPrice(agreedPair.toToken as TokenSymbol).catch(() => 0)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network,
            par: v.pair,
            confianca: v.confidence,
            timestamp: Date.now(),
            fromToken: v.fromToken,
            toToken: v.toToken,
            amountUsd,
            direcao: v.action,
            precoNoPalpite: precoPalpite || undefined,
          })
        }
        vagasUsadas++
      } else if (valorFinal < minSizeForCheck) {
        pregão.adicionarLog(`⏳ Trade $${valorFinal.toFixed(2)} abaixo do mínimo $${minSizeForCheck.toFixed(2)} — pulando`)
      } else if (minViableTrade > 0 && valorFinal < minViableTrade) {
        pregão.adicionarLog(`⏳ Mercado pouco volátil — trade de $${valorFinal.toFixed(2)} não cobre custos (precisa ~$${minViableTrade.toFixed(2)}). Retorno esperado ${(expectedReturn * 100).toFixed(2)}% com ${(vol24h * 100).toFixed(1)}% vol`)
      } else {
        pregão.adicionarLog(`✅ Trade viável em ${pairNet}: retorno esperado ${(expectedReturn * 100).toFixed(2)}% cobre gas + spread + $${getMinProfitReal(pairNet).toFixed(2)}`)
        if (vol24h >= 0.02) {
          pregão.adicionarLog(`📈 Mercado volátil (${(vol24h * 100).toFixed(1)}%) — condições favoráveis`)
        }
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} em ${pairNet} (${agreedPair.fromToken}→${agreedPair.toToken})`)
        const precoPalpite = await positionManager.fetchTokenPrice(agreedPair.toToken as TokenSymbol).catch(() => 0)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network,
            par: v.pair,
            confianca: v.confidence,
            timestamp: Date.now(),
            fromToken: v.fromToken,
            toToken: v.toToken,
            amountUsd,
            direcao: v.action,
            precoNoPalpite: precoPalpite || undefined,
          })
        }
        vagasUsadas++
      }
    } else if (STABLES.has(agreedPair.fromToken) && STABLES.has(agreedPair.toToken)) {
      const pairNet = agreedPair.network
      const gasCost = await gasPriceOracle.getGasCost(pairNet)
      const valorFinal = isMultiChain ? amountUsd! * 0.9 : Math.min(amountUsd! * 0.9, realSwap.getBalance(agreedPair.fromToken as TokenSymbol))

      const wavePair = wavePairs.find(wp => wp.label === agreedPair.pair && wp.network === agreedPair.network)
      const spreadEsperado = Math.max((wavePair?.amplitude ?? 0.0005), 0.0005)
      const expectedReturn = (agreeingAgents.reduce((s: number, v: AgentPairVote) => s + v.confidence, 0) / agreeingAgents.length / 100) * spreadEsperado
      const spreadPct = Math.max(0.001, 0.005 - spreadEsperado * 0.5)
      const minViableTrade = (getMinProfitReal(pairNet) + gasCost) / Math.max(0.001, expectedReturn - spreadPct)
      const retornoUsd = expectedReturn * valorFinal
      const gasThreshold = gasCost * 1.5

      const isTestnetNet = NETWORKS[pairNet]?.isTestnet ?? false
      if (isTestnetNet) {
        pregão.adicionarLog(`🧪 Testnet stable-stable ${agreedPair.pair}: ignorando threshold — executando`)
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} em ${pairNet} (${agreedPair.fromToken}→${agreedPair.toToken})`)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network,
            par: v.pair,
            confianca: v.confidence,
            timestamp: Date.now(),
            fromToken: v.fromToken,
            toToken: v.toToken,
            amountUsd,
            direcao: v.action,
          })
        }
      } else if (retornoUsd < gasThreshold) {
        pregão.adicionarLog(`⏳ Stable-stable ${agreedPair.pair}: retorno esperado $${retornoUsd.toFixed(4)} < gas threshold $${gasThreshold.toFixed(4)} (gas $${gasCost.toFixed(4)} × 1.5) — bloqueado`)
      } else if (minViableTrade > 0 && valorFinal < minViableTrade) {
        pregão.adicionarLog(`⏳ Stable-stable ${agreedPair.pair}: retorno esperado ${(expectedReturn * 100).toFixed(3)}% não cobre gas ($${gasCost.toFixed(4)}) — precisa ~$${minViableTrade.toFixed(2)} de trade`)
      } else {
        pregão.adicionarLog(`✅ Stable-stable ${agreedPair.pair} viável: $${valorFinal.toFixed(2)} cobre gas + spread`)
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} em ${pairNet} (${agreedPair.fromToken}→${agreedPair.toToken})`)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network,
            par: v.pair,
            confianca: v.confidence,
            timestamp: Date.now(),
            fromToken: v.fromToken,
            toToken: v.toToken,
            amountUsd,
            direcao: v.action,
          })
        }
      }
    } else if (!STABLES.has(agreedPair.fromToken) && STABLES.has(agreedPair.toToken)) {
      const pairNet = agreedPair.network
      const posVenda = positionManager.getOpenPositions()
        .find(p => p.boughtToken === agreedPair.fromToken && p.networkKey === pairNet && p.status === "open")
      if (posVenda) {
        const currentPrice = await positionManager.fetchTokenPrice(posVenda.boughtToken as TokenSymbol)
        const profitPercent = ((currentPrice - posVenda.entryPrice) / posVenda.entryPrice) * 100
        const idade = Date.now() - posVenda.entryTimestamp
        const staleThreshold = NETWORKS[pairNet]?.isTestnet ? 60_000 : 300_000 // testnet: 1min, mainnet: 5min
        if (profitPercent <= 0 && idade < staleThreshold) {
          const label = profitPercent < 0 ? `no prejuízo (${profitPercent.toFixed(1)}%)` : `break-even (0.0%)`
          pregão.adicionarLog(`⏳ ${agreedPair.pair}: posição ${agreedPair.fromToken} ${label} — só Staircase pode fechar`)
        } else {
          pregão.adicionarLog(`💰 Venda lucrativa: ${agreedPair.pair} (${profitPercent.toFixed(1)}%)`)
          for (const v of agreeingAgents) {
            pregão.receberOK({
              pregueiro: `Agente:${v.agentName}`,
              rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
              fromToken: v.fromToken, toToken: v.toToken,
              direcao: v.action, precoNoPalpite: currentPrice,
            })
          }
        }
      } else {
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair}`)
        const precoSell = await positionManager.fetchTokenPrice(agreedPair.fromToken as TokenSymbol).catch(() => 0)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
            fromToken: v.fromToken, toToken: v.toToken,
            direcao: v.action, precoNoPalpite: precoSell || undefined,
          })
        }
      }
    } else {
      const balSuficiente = isMultiChain || realSwap.getBalance(agreedPair.fromToken as TokenSymbol) >= 0.50
      if (!balSuficiente) {
        const balFrom = realSwap.getBalance(agreedPair.fromToken as TokenSymbol)
        let balFromUsd = balFrom
        if (!STABLES.has(agreedPair.fromToken)) {
          const fromPrice = await positionManager.fetchTokenPrice(agreedPair.fromToken as TokenSymbol).catch(() => 1)
          balFromUsd = balFrom * fromPrice
        }
        pregão.adicionarLog(`⏳ Saldo insuficiente de ${agreedPair.fromToken}: $${balFromUsd.toFixed(2)} — ordem bloqueada`)
      } else {
        pregão.adicionarLog(`🤖 ${uniqueAgents.size} agentes (${agentesStr}) → ${agreedPair.pair} (${agreedPair.fromToken}→${agreedPair.toToken})`)
        const tokenVol = STABLES.has(agreedPair.toToken) ? agreedPair.fromToken : agreedPair.toToken
        const precoOutros = await positionManager.fetchTokenPrice(tokenVol as TokenSymbol).catch(() => 0)
        for (const v of agreeingAgents) {
          pregão.receberOK({
            pregueiro: `Agente:${v.agentName}`,
            rede: v.network, par: v.pair, confianca: v.confidence, timestamp: Date.now(),
            fromToken: v.fromToken, toToken: v.toToken,
            direcao: v.action, precoNoPalpite: precoOutros || undefined,
          })
        }
      }
    }
  }

  const todasPosicoes = positionManager.getOpenPositions()
  pregão.adicionarLog(`🔍 Total de posições abertas: ${todasPosicoes.length}`)
  const posicoesAbertas = isMultiChain
    ? todasPosicoes.filter(p => p.status === "open")
    : todasPosicoes.filter(p => p.networkKey === redeAtual && p.status === "open")
  const redeLabel = isMultiChain ? `multi-chain (${networksToScan.length} redes)` : redeAtual
  pregão.adicionarLog(`🔍 Posições em ${redeLabel}: ${posicoesAbertas.length}`)
  for (const pos of posicoesAbertas) {
    const posNet = pos.networkKey as NetworkKey
    const currentPrice = await positionManager.fetchTokenPrice(pos.boughtToken)
    let profitPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100

    if (profitPercent <= 0) {
      const label = profitPercent < 0 ? `${profitPercent.toFixed(1)}% no prejuízo` : `break-even (0.0%)`
      pregão.adicionarLog(`⏳ ${pos.boughtToken} em ${posNet}: ${label} — segurando (staircase decide fechamento)`)
      continue
    }

    const confMult = volatilityTracker.getConfidenceMultiplier(pos.boughtToken)
    const sellConfidence = Math.min(90, Math.round((30 + Math.max(0, profitPercent) * 4) * confMult))
    if (sellConfidence < 35) continue

    const STOP_LOSS = -15
    const MIN_MEANINGFUL_PROFIT = 1
    if (profitPercent > STOP_LOSS && (pos.peakProfitPercent ?? 0) < MIN_MEANINGFUL_PROFIT) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken} em ${posNet}: ${profitPercent.toFixed(1)}% (pico ${(pos.peakProfitPercent ?? 0).toFixed(2)}%) sem lucro significativo — Staircase segura (hold)`)
      continue
    }

    if (profitPercent > 100 && pos.amountPaid > 0 && pos.amountBought > 0) {
      const fixedEntry = pos.amountPaid / pos.amountBought
      profitPercent = ((currentPrice - fixedEntry) / fixedEntry) * 100
      pregão.adicionarLog(`⚠️ ${pos.boughtToken}: entryPrice corrompido ($${pos.entryPrice.toFixed(4)}) → corrigido para $${fixedEntry.toFixed(4)} (${profitPercent.toFixed(1)}%) via swap real`)
      pos.entryPrice = fixedEntry
      positionManager.savePositions()
    }

    const gasCost = await gasPriceOracle.getGasCost(posNet)
    const positionValueUSD = pos.amountBought * currentPrice
    const profitUSD = positionValueUSD * (profitPercent / 100)
    const tokenVol = volatilityTracker.getVolatility(pos.boughtToken as TokenSymbol)
    const spreadPct = Math.max(0.001, 0.005 - tokenVol.vol24h * 0.04)
    const spreadCost = profitUSD * spreadPct
    // 🔥 Lucro líquido: só fecha se cobre gas + spread + lucro mínimo
    const minProfit = posNet === "ethereum" ? gasCost * 3 : gasCost + spreadCost + getMinProfitReal(posNet)
    if (profitUSD < minProfit && profitPercent > 0) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken} em ${posNet}: lucro $${profitUSD.toFixed(4)} < custos (gas $${gasCost.toFixed(4)} + spread $${spreadCost.toFixed(4)} + lucro $${getMinProfitReal(posNet).toFixed(4)}) — segurando`)
      continue
    }

    // ETH: só vende se lucro >= 90% da variação 24h (conservador)
    // Demais redes: micro-trades fecham sem esperar variação 24h
    if (profitPercent > 0 && posNet === "ethereum") {
      const { change24h, variation24h } = await positionManager.fetchTokenChange24h(pos.boughtToken as TokenSymbol)
      const profitTarget = variation24h * 0.9
      if (profitPercent < profitTarget) {
        pregão.adicionarLog(`📊 ${pos.boughtToken} em ${posNet}: ${profitPercent.toFixed(1)}% < meta ${profitTarget.toFixed(1)}% (90% da variação 24h=${variation24h.toFixed(1)}%, change=${change24h.toFixed(1)}%) — segurando`)
        continue
      }
    }

    const sellPar = `${pos.boughtToken}→USDC`
    const vendedores = allUniqueAgents.size >= 2
      ? [...allUniqueAgents].slice(0, 2)
      : ["Realizador", "ProfitTaker"]
    const jaVendendoGrid = pregão.getOrdensAtivas()
      .some(o => o.fromToken === pos.boughtToken && o.rede === posNet && o.pregueiros.some(p => p.startsWith("Grid:")))
    if (jaVendendoGrid) {
      pregão.adicionarLog(`⏳ ${pos.boughtToken} em ${posNet}: grid já está vendendo — agente aguarda`)
      continue
    }

    pregão.adicionarLog(`💰 Realizando lucro: ${pos.boughtToken} em ${posNet} (${profitPercent.toFixed(1)}% → conf ${sellConfidence}%)`)
    gridTrader.onPositionClosed(pos.boughtToken as TokenSymbol, profitPercent, posNet)

    for (const nome of vendedores) {
      pregão.receberOK({
        pregueiro: `Agente:${nome}`,
        rede: posNet,
        par: sellPar,
        confianca: sellConfidence,
        timestamp: Date.now(),
        fromToken: pos.boughtToken,
        toToken: "USDC",
      })
    }
  }

  // 🔁 Restaura receberOK original
  pregão.receberOK = originalReceberOK

  return {
    totalPairs: pairs.length,
    votes,
    agreedPair: candidatePairs.length > 0 ? candidatePairs[0].pair : null,
    agreeingAgents: allUniqueAgents.size,
    waveCollapsed: true,
  }
}