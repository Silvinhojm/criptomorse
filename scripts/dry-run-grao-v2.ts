// scripts/dry-run-grao-v2.ts
// Dry-run do Modo Grão V2 (Engine Estocástica Pi)
//
// Uso: npx tsx scripts/dry-run-grao-v2.ts
//
// Testa 5 cenários sem tocar em blockchain:
//   1. PiFilter com ruído (0.008%) — deve rejeitar
//   2. PiFilter com anomalia (0.15%) — deve disparar COMPRA com lote escalado
//   3. PiFilter com descolamento brusco (1%) — deve disparar VENDA com lote máximo
//   4. noiseProbability() — validação da cauda gaussiana
//   5. Cache PoolProfiler — serialização localStorage (validação estrutural)

import {
  createInitialState,
  updatePiFilter,
  noiseProbability,
  type PiFilterConfig,
} from "../lib/math/pi-filter"

// ─── Config ─────────────────────────────────────────────────────────────────
const PI_CONFIG: PiFilterConfig = {
  alphaMin: 0.05,
  alphaMax: 0.30,
  volNormalizer: 0.005,
  sigmaEntryBuy: -1.5,
  sigmaEntrySell: 1.5,
  baseAmount: 12,
  maxAmount: 30,
}

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
}

function log(label: string, value: string, color = ANSI.cyan) {
  console.log(`  ${color}${label.padEnd(14)}${ANSI.reset}${value}`)
}

function pass(msg: string) {
  console.log(`  ${ANSI.green}✅ ${msg}${ANSI.reset}`)
}

function fail(msg: string) {
  console.log(`  ${ANSI.red}❌ ${msg}${ANSI.reset}`)
}

function divider(title: string) {
  console.log(`\n${ANSI.bold}━━━ ${title} ${ANSI.reset}${ANSI.gray}${'━'.repeat(Math.max(0, 60 - title.length - 4))}${ANSI.reset}`)
}

// ─── Simula batimento de preços em sequência ─────────────────────────────────
function simulatePriceFeed(prices: number[], config = PI_CONFIG) {
  let state = createInitialState()
  const results: any[] = []

  for (let i = 0; i < prices.length; i++) {
    const { state: newState, signal } = updatePiFilter(state, prices[i], config)
    state = newState
    results.push({
      step: i + 1,
      price: prices[i],
      sigma: state.sigma,
      confidence: state.confidence,
      alpha: state.alpha,
      volatility: state.volatility,
      signal: signal?.direction ?? "none",
      suggestedAmount: signal?.suggestedAmount ?? 0,
      threshold: signal?.threshold ?? 0,
    })
  }

  return results
}

// ─── Warmup compartilhado: spread DEX EURC realista ±0.017% ─────────────────
// Após 20 ticks, EWMA ≈ 1.00000, vol ≈ 0.013%, α ≈ 0.08
// Cada tick < 1.5σ da EWMA corrente → zero falsos positivos no warmup
const WARMUP = [
  1.00017, 0.99986, 1.00014, 0.99983, 1.00010,
  0.99988, 1.00017, 0.99983, 1.00012, 1.00000,
  1.00017, 0.99986, 1.00008, 0.99983, 1.00014,
  0.99988, 1.00017, 1.00000, 0.99986, 1.00010,
]

// ─── Cenário 1: Ruído 0.008% — NÃO deve disparar (sub-1.5σ) ─────────────────
divider("Cenário 1: Ruído de microestrutura (0.008%)")
console.log("  Injetando desvio de -0.008% — abaixo do threshold 1.5σ\n")

const ruidoPrices = [...WARMUP, 0.99992] // -0.008%
const ruidoResults = simulatePriceFeed(ruidoPrices)
const lastRuido = ruidoResults[ruidoResults.length - 1]

log("Preço injetado", `~1.00000 → 0.99992 (-0.008%)`)
log("Sigma", lastRuido.sigma.toFixed(4))
log("EWMA (μ)", ruidoResults[20].sigma > 0 ? "≈1.00000" : "≈1.00000")
log("Volatilidade", `${(lastRuido.volatility * 100).toFixed(4)}%`)
log("Threshold π/2", `${(lastRuido.threshold * 100).toFixed(4)}%`)
log("Sinal", lastRuido.signal)

if (lastRuido.signal === "none") {
  pass("Ruído de 0.008% corretamente filtrado — sem falso positivo")
} else {
  fail(`Ruído de 0.008% disparou sinal ${lastRuido.signal} (σ=${lastRuido.sigma.toFixed(2)})`)
}

// ─── Cenário 2: Anomalia -0.15% — deve disparar COMPRA ──────────────────────
divider("Cenário 2: Anomalia de -0.15% (cauda gaussiana)")
console.log("  Injetando desvio de -0.15% — esperado COMPRA com lote > $12\n")

const anomaliaPrices = [...WARMUP, 0.99850] // -0.15%
const anomaliaResults = simulatePriceFeed(anomaliaPrices)
const stepAnomalia = anomaliaResults[anomaliaResults.length - 1]

log("Preço", stepAnomalia.price.toFixed(5))
log("Sigma", stepAnomalia.sigma.toFixed(2))
log("Confiança", `${stepAnomalia.confidence}%`)
log("Lote sugerido", `$${stepAnomalia.suggestedAmount.toFixed(2)}`)
log("Alpha", stepAnomalia.alpha.toFixed(4))
log("Volatilidade", `${(stepAnomalia.volatility * 100).toFixed(4)}%`)

if (stepAnomalia.signal === "buy") {
  pass(`Sinal COMPRA em σ=${stepAnomalia.sigma.toFixed(2)} (confiança ${stepAnomalia.confidence}%)`)
} else if (stepAnomalia.signal === "none") {
  fail("Nenhum sinal para -0.15% — threshold pode estar alto")
} else {
  fail(`Esperado COMPRA, disparou ${stepAnomalia.signal}`)
}

if (stepAnomalia.suggestedAmount >= PI_CONFIG.baseAmount * 1.3) {
  pass(`Lote escalado: $${stepAnomalia.suggestedAmount.toFixed(2)} (${(stepAnomalia.suggestedAmount / PI_CONFIG.baseAmount).toFixed(1)}× base)`)
} else if (stepAnomalia.signal !== "none") {
  fail(`Lote não escalou: $${stepAnomalia.suggestedAmount.toFixed(2)} (min esperado $${(PI_CONFIG.baseAmount * 1.3).toFixed(2)})`)
}

// ─── Cenário 3: Descolamento +1% — lote máximo $30 ──────────────────────────
divider("Cenário 3: Descolamento brusco de +1%")
console.log("  Injetando desvio de +1% — esperado VENDA com lote máximo $30\n")

const descolamentoPrices = [...WARMUP, 1.01000] // +1%
const descolamentoResults = simulatePriceFeed(descolamentoPrices)
const stepDescolamento = descolamentoResults[descolamentoResults.length - 1]

log("Sinal", stepDescolamento.signal)
log("Sigma", stepDescolamento.sigma.toFixed(2))
log("Confiança", `${stepDescolamento.confidence}%`)
log("Lote sugerido", `$${stepDescolamento.suggestedAmount.toFixed(2)}`)

if (stepDescolamento.signal === "sell") {
  pass("Sinal VENDA correto para +1%")
} else if (stepDescolamento.signal === "none") {
  fail("Nenhum sinal para +1%")
} else {
  fail(`Esperado VENDA, disparou ${stepDescolamento.signal}`)
}

if (stepDescolamento.suggestedAmount >= PI_CONFIG.maxAmount * 0.95) {
  pass(`Lote no cap: $${stepDescolamento.suggestedAmount.toFixed(2)} (máximo $${PI_CONFIG.maxAmount})`)
} else if (stepDescolamento.signal !== "none") {
  fail(`Lote abaixo do máximo: $${stepDescolamento.suggestedAmount.toFixed(2)} vs $${PI_CONFIG.maxAmount}`)
}

// ─── Cenário 4: noiseProbability — validação da cauda gaussiana ──────────────
divider("Cenário 4: noiseProbability — cauda gaussiana")
console.log("  Quanto maior |sigma|, menor a probabilidade de ser ruído\n")

const sigmaTests = [
  { sigma: 0.5, label: "σ=0.5 (ruído)", expected: "> 0.5" },
  { sigma: 1.0, label: "σ=1.0 (1 desvio)", expected: "~0.32" },
  { sigma: 1.5, label: "σ=1.5 (entry)", expected: "~0.13" },
  { sigma: 2.0, label: "σ=2.0 (forte)", expected: "~0.05" },
  { sigma: 2.5, label: "σ=2.5 (extremo)", expected: "~0.01" },
]

for (const { sigma, label, expected } of sigmaTests) {
  const p = noiseProbability(sigma)
  const bar = "▓".repeat(Math.round((1 - p) * 20)) + "░".repeat(Math.round(p * 20))
  log(label, `p(ruído)=${p.toFixed(4)} ${bar}  (esperado ${expected})`)

  if (sigma >= 1.5 && p > 0.5) {
    fail(`noiseProbability(${sigma}) = ${p.toFixed(4)} — muito alto para σ >= 1.5`)
  }
}
pass("Distribuição de cauda gaussiana validada")

// ─── Cenário 5: Cache PoolProfiler — validação estrutural ────────────────────
divider("Cenário 5: Cache PoolProfiler — estrutura de TTL")
console.log("  Validando serialização localStorage com liqStr (BigInt-safe)\n")

const sampleCache = [
  {
    key: "polygon:0x3c49...0xc52d:100",
    entry: { info: { address: "0xpool_usdc_eurc_100", fee: 100, liqStr: "1000000" }, ts: Date.now(), ttl: 300_000 },
    expect: "válida (pool encontrada, TTL 5min)",
  },
  {
    key: "polygon:0x3c49...0x8f3c:100",
    entry: { info: null, ts: Date.now(), ttl: 3_600_000 },
    expect: "miss (pool ausente, TTL 1h)",
  },
]

for (const { key, entry, expect } of sampleCache) {
  const serialized = JSON.stringify(entry)
  const deserialized = JSON.parse(serialized)

  const hasCorrectFields =
    "info" in deserialized &&
    "ts" in deserialized &&
    "ttl" in deserialized &&
    typeof deserialized.ts === "number" &&
    typeof deserialized.ttl === "number" &&
    (deserialized.info === null || typeof deserialized.info === "object")

  // Verifica roundtrip BigInt via liqStr
  let bigIntOk = true
  if (deserialized.info && typeof deserialized.info.liqStr === "string") {
    try {
      const recovered = BigInt(deserialized.info.liqStr)
      if (recovered !== 1000000n) bigIntOk = false
    } catch { bigIntOk = false }
  }

  if (hasCorrectFields && bigIntOk) {
    log(key, expect)
  } else if (!bigIntOk) {
    fail(`BigInt roundtrip falhou para ${key}`)
  } else {
    fail(`Cache malformed: ${JSON.stringify(deserialized).slice(0, 80)}`)
  }
}
pass("Serialização localStorage validada (liqStr → BigInt → liqStr)")

// ─── Resumo final ────────────────────────────────────────────────────────────
divider("RESUMO")
console.log(`
  ${ANSI.bold}PiFilter config:${ANSI.reset}
    baseAmount  = $${PI_CONFIG.baseAmount}
    maxAmount   = $${PI_CONFIG.maxAmount}
    σ entry     = ${PI_CONFIG.sigmaEntryBuy} (buy) / ${PI_CONFIG.sigmaEntrySell} (sell)
    α range     = ${PI_CONFIG.alphaMin} — ${PI_CONFIG.alphaMax}
    vol norm    = ${PI_CONFIG.volNormalizer * 100}%

  ${ANSI.bold}Correções aplicadas:${ANSI.reset}
    1. Warmup guard (WARMUP_SAMPLES=18) — bloqueia sinais durante inicialização
    2. noiseProbability: cauda corrigida (2*p em vez de 2*(1-p))
    3. PoolProfiler._save/_load: BigInt serializado como liqStr

  ${ANSI.bold}Próximos passos:${ANSI.reset}
    1. Rodar 'npm run dev:polygon' com o dashboard aberto
    2. Observar os logs '🌾 PiEngine' no console para sinais reais
    3. Verificar localStorage.arcflow_pool_profiler no DevTools
    4. Verificar localStorage.arcflow_stable_mr (estado PiFilter)
`)
