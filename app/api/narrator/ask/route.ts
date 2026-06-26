import { NextRequest, NextResponse } from "next/server"
import { realSwap, NETWORKS, TRADING_PAIRS, type NetworkKey, isStable } from "@/lib/real-swap-executor"
import { positionManager } from "@/lib/position-manager"
import { gasPriceOracle } from "@/lib/gas-price-oracle"
import { accountant } from "@/lib/accountant"
import { volatilityTracker } from "@/lib/volatility-tracker"
import { pregão } from "@/lib/pregão"

type AskRequest = { question: string }

function normalize(text: string): string {
  return text.toLowerCase().replace(/[áàâãä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i").replace(/[óòôõö]/g, "o").replace(/[úùûü]/g, "u").replace(/[ç]/g, "c").replace(/[^a-z0-9\s]/g, "")
}

function hasWord(text: string, ...words: string[]) {
  const n = normalize(text)
  return words.some(w => n.includes(w))
}

async function responderGas(): Promise<string> {
  const linhas: string[] = []
  for (const [key, net] of Object.entries(NETWORKS)) {
    try {
      const cost = await gasPriceOracle.getGasCost(key as NetworkKey)
      linhas.push(`${net.name}: $${cost.toFixed(4)} (≈ $${(cost * 3).toFixed(4)} para trade)`)
    } catch {
      linhas.push(`${net.name}: indisponível`)
    }
  }
  return `⛽ Taxa de gas por rede:\n${linhas.join("\n")}`
}

async function responderMoedaBoa(): Promise<string> {
  const positions = positionManager.getOpenPositions()
  const linhas: string[] = []

  if (positions.length > 0) {
    linhas.push("📊 Posições abertas:")
    for (const pos of positions) {
      const profit = pos.currentProfitPercent ?? 0
      const sinal = profit >= 0 ? "✅" : "⚠️"
      linhas.push(`${sinal} ${pos.boughtToken}: ${profit.toFixed(1)}% (entry $${pos.entryPrice.toFixed(2)})`)
    }
  } else {
    linhas.push("📭 Nenhuma posição aberta no momento.")
  }

  const ranking = accountant.getRanking()
  if (ranking.length > 0) {
    linhas.push(`\n🏆 Melhor agente: ${ranking[0].agentName} (score ${ranking[0].score.toFixed(1)}, ${ranking[0].wins}V/${ranking[0].losses}D)`)
  }

  const stats = accountant.getStats()
  linhas.push(`\n📈 Estatísticas gerais: ${stats.totalTrades} trades, ${(stats.winRate * 100).toFixed(0)}% win rate, lucro total $${stats.totalProfit.toFixed(2)}`)

  return linhas.join("\n")
}

async function responderSpread(): Promise<string> {
  const linhas: string[] = []
  const tokensVistos = new Set<string>()

  for (const [key, pairs] of Object.entries(TRADING_PAIRS)) {
    const net = NETWORKS[key as NetworkKey]
    for (const pair of pairs) {
      const volToken = pair.to
      if (isStable(volToken) || tokensVistos.has(volToken)) continue
      tokensVistos.add(volToken)
      try {
        const snap = volatilityTracker.getVolatility(volToken as any)
        const mult = volatilityTracker.getConfidenceMultiplier(volToken as any)
        linhas.push(`${pair.label}: vol 1h=${(snap.vol1h * 100).toFixed(2)}%, 24h=${(snap.vol24h * 100).toFixed(2)}%, trend=${snap.trend}, conf mult=${mult.toFixed(2)}x`)
      } catch {
        linhas.push(`${pair.label}: sem dados de volatilidade ainda`)
      }
    }
    break // só primeira rede pra não poluir
  }

  if (linhas.length === 0) linhas.push("📊 Nenhum dado de spread disponível ainda. Precisa de mais trades para calibrar.")

  return `📊 Volatilidade dos pares:\n${linhas.join("\n")}`
}

async function responderMoedaNova(): Promise<string> {
  const linhas: string[] = []
  for (const [key, pairs] of Object.entries(TRADING_PAIRS)) {
    const net = NETWORKS[key as NetworkKey]
    const tokens = [...new Set(pairs.flatMap(p => [p.from, p.to]))]
    linhas.push(`${net.name}: ${tokens.join(", ")}`)
  }
  return `🪙 Tokens disponíveis por rede:\n${linhas.join("\n")}`
}

async function responderSaldo(): Promise<string> {
  const linhas: string[] = []
  const cb = pregão.getCashBox()
  linhas.push(`🏦 Caixa (Unified Balance): $${cb.unifiedBalance?.totalUSD.toFixed(2) ?? "indisponível"}`)
  for (const [key, net] of Object.entries(NETWORKS)) {
    realSwap.switchNetwork(key as NetworkKey)
    const usdc = realSwap.getBalance("USDC")
    linhas.push(`${net.name} wallet: $${usdc.toFixed(2)} USDC`)
  }
  return linhas.join("\n")
}

async function responderGeral(): Promise<string> {
  const linhas: string[] = []
  const stats = accountant.getStats()
  linhas.push(`📈 ${stats.totalTrades} trades · ${(stats.winRate * 100).toFixed(0)}% win · $${stats.totalProfit.toFixed(2)} lucro`)
  const positions = positionManager.getOpenPositions()
  linhas.push(`📊 ${positions.length} posição(ões) aberta(s)`)
  const status = pregão.getStatus()
  linhas.push(`🏛️ ${status.ordensAtivas} ordem(ns) ativa(s) · ${status.oksPendentes} OK(s) pendente(s)`)
  const top3 = accountant.getRanking().slice(0, 3).map(s => `${s.agentName}(${s.score.toFixed(0)})`).join(", ")
  linhas.push(`🏆 Top 3: ${top3}`)

  for (const [key, net] of Object.entries(NETWORKS)) {
    if (net.isTestnet) continue
    try {
      const gas = await gasPriceOracle.getGasCost(key as NetworkKey)
      linhas.push(`⛽ ${net.name} gas: $${gas.toFixed(4)}`)
    } catch { /* skip */ }
  }
  return linhas.join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const { question = "" } = (await req.json()) as AskRequest
    if (!question.trim()) return NextResponse.json({ answer: "Pergunte algo! Exemplos: 'gas', 'spread', 'qual moeda está reagindo bem', 'saldo', 'moeda nova'" })

    let answer: string
    if (hasWord(question, "gas", "taxa", "custo", "gwei")) {
      answer = await responderGas()
    } else if (hasWord(question, "reagindo", "boa", "moeda", "token", "lucro", "posicao", "position", "trade", "performance")) {
      answer = await responderMoedaBoa()
    } else if (hasWord(question, "spread", "volatilidade", "volatil")) {
      answer = await responderSpread()
    } else if (hasWord(question, "nova", "nova moeda", "novo token", "pares", "pairs", "dispon")) {
      answer = await responderMoedaNova()
    } else if (hasWord(question, "saldo", "caixa", "carteira", "dinheiro", "fundo")) {
      answer = await responderSaldo()
    } else {
      answer = await responderGeral()
    }

    return NextResponse.json({ answer })
  } catch (e) {
    return NextResponse.json({ answer: `❌ Erro ao processar pergunta: ${e instanceof Error ? e.message : e}` })
  }
}
