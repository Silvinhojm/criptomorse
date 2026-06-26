import { TRADING_PAIRS, realSwap } from "./real-swap-executor"
import { pregão } from "./pregão"

interface ArcPairState {
  pair: string
  fromToken: string
  toToken: string
  profit: number
  trades: number
  weight: number
}

const ARC_PAIRS: ArcPairState[] = TRADING_PAIRS.arc.map(p => ({
  pair: p.label,
  fromToken: p.from,
  toToken: p.to,
  profit: 0,
  trades: 0,
  weight: 1 / TRADING_PAIRS.arc.length,
}))

const COMERCIO_NAMES = ["ArcBandit:1", "ArcBandit:2", "ArcBandit:3"]

let isRunning = false
let totalTrades = 0
let tradeAmount = 5
let currentPhaseTrades = 0

function log(msg: string) {
  pregão.adicionarLog(msg)
}

function softmax(profits: number[], temperature: number): number[] {
  const max = Math.max(...profits, 0)
  const exps = profits.map(p => Math.exp((p - max) / Math.max(temperature, 0.01)))
  const sum = exps.reduce((s, e) => s + e, 0)
  return exps.map(e => e / sum)
}

function pickPair(): ArcPairState {
  const weights = ARC_PAIRS.map(p => p.weight)
  const r = Math.random()
  let cumulative = 0
  for (let i = 0; i < ARC_PAIRS.length; i++) {
    cumulative += weights[i]
    if (r <= cumulative) return ARC_PAIRS[i]
  }
  return ARC_PAIRS[ARC_PAIRS.length - 1]
}

function recalcWeights() {
  const temperature = Math.max(0.1, 1 - totalTrades * 0.01)
  const profits = ARC_PAIRS.map(p => p.profit)
  const weights = softmax(profits, temperature)
  for (let i = 0; i < ARC_PAIRS.length; i++) {
    ARC_PAIRS[i].weight = weights[i]
  }
}

export function iniciar() {
  if (isRunning) return
  isRunning = true
  totalTrades = 0
  tradeAmount = 5
  currentPhaseTrades = 0
  ARC_PAIRS.forEach(p => { p.profit = 0; p.trades = 0; p.weight = 1 / ARC_PAIRS.length })
  log(`🎰 [ARC] Bandit iniciado — ${ARC_PAIRS.length} pares, $${tradeAmount}/trade`)
}

export function parar() {
  if (!isRunning) return
  isRunning = false
  log(`⏹️ [ARC] Bandit parado — ${totalTrades} trades executados, último amount $${tradeAmount}`)
}

export async function executarCiclo() {
  if (!isRunning) return

  let pair = pickPair()
  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const balance = realSwap.getBalance(pair.fromToken as any)
    if (balance >= tradeAmount) break
    log(`⏭️ [ARC] Par ${pair.pair}: saldo ${pair.fromToken}=${balance.toFixed(4)} < $${tradeAmount}, tentando outro...`)
    pair = pickPair()
  }

  const tradeNum = totalTrades + 1
  const phase = Math.floor(totalTrades / 10)

  log(`🎰 [ARC] Trade #${tradeNum} | Par: ${pair.pair} | $${tradeAmount} | Fase ${phase} | Peso ${(pair.weight * 100).toFixed(0)}%`)

  for (const nome of COMERCIO_NAMES) {
    pregão.receberOK({
      pregueiro: nome,
      rede: "arc",
      par: pair.pair,
      confianca: Math.min(95, 60 + totalTrades * 2),
      timestamp: Date.now(),
      fromToken: pair.fromToken,
      toToken: pair.toToken,
      amountUsd: tradeAmount,
    })
  }
}

export function registrarResultadoArc(pairLabel: string, profit: number) {
  if (!isRunning) return
  const pair = ARC_PAIRS.find(p => p.pair === pairLabel)
  if (!pair) return

  pair.profit += profit
  pair.trades++
  totalTrades++
  currentPhaseTrades++

  if (profit > 0) {
    log(`✅ [ARC] Trade #${totalTrades} lucrou $${profit.toFixed(4)} — ${pair.pair}`)
  } else {
    log(`❌ [ARC] Trade #${totalTrades} perdeu $${Math.abs(profit).toFixed(4)} — ${pair.pair}`)
  }

  if (currentPhaseTrades >= 10) {
    currentPhaseTrades = 0
    const oldAmount = tradeAmount
    tradeAmount = Math.min(50, tradeAmount + 5)
    recalcWeights()
    log(`📊 [ARC] Recálculo de pesos após ${totalTrades} trades:`)
    for (const p of ARC_PAIRS) {
      log(`   ${p.pair}: lucro $${p.profit.toFixed(4)} em ${p.trades} trades → peso ${(p.weight * 100).toFixed(0)}%`)
    }
    if (tradeAmount !== oldAmount) {
      log(`📈 [ARC] Trade amount aumentado: $${oldAmount} → $${tradeAmount}`)
    }
  }
}

export function getArcState() {
  return {
    isRunning,
    totalTrades,
    tradeAmount,
    currentPhaseTrades,
    pairs: ARC_PAIRS.map(p => ({ ...p })),
  }
}
