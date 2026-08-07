// RI-BANK-96 — teste de regressão da barreira mínima de ponte, usando os
// dados reais observados em RI-BANK-94:
//   - taxa CCTP (maxFee) ≈ 0,00026 USDC
//   - gas burn (Base Sepolia): 170.079 gas a 6 gwei ≈ 0,001 ETH → em testnet
//     o custo em USD é desprezível (≈ $0,00); nas duas pernas testnet
//     assumimos gasSourceUsd = gasDestinationUsd = 0
//   - margem de trânsito: default 0,5h x drift 0,1%/h x $2 movidos
//
// A função é pura (sem rede, sem Redis) — o teste roda offline com tsx.

import {
  BRIDGE_FIXED_COST_MULTIPLIER,
  computeBridgeFixedCostBarrier,
  computeTransitMargin,
  DEFAULT_TRADE_AMOUNT_USD,
  DEFAULT_TRANSIT_DRIFT_RATE,
  DEFAULT_TRANSIT_WINDOW_HOURS,
  evaluateBridgeOpportunity,
} from "../bandit-bridge-opportunity"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// ── Caso 1: barreira de custo fixo com dados reais de RI-BANK-94 ──────────
function testFixedCostBarrierWithRealData(): void {
  const cctpFeeUsd = 0.00026 // maxFee observado
  const gasSourceUsd = 0.0 // testnet: desprezível
  const gasDestinationUsd = 0.0 // testnet: desprezível

  const barrier = computeBridgeFixedCostBarrier({ cctpFeeUsd, gasSourceUsd, gasDestinationUsd })

  expect(
    BRIDGE_FIXED_COST_MULTIPLIER === 3,
    `barreira deve usar constante 3x (não o 10x do slippage), got ${BRIDGE_FIXED_COST_MULTIPLIER}`,
  )
  const expected = (0.00026 + 0 + 0) * 3
  expect(
    Math.abs(barrier - expected) < 1e-12,
    `barreira (cctpFee+gas)x3: esperado ${expected}, got ${barrier}`,
  )
  console.log("RI_BANK_96_FIXED_COST_BARRIER_REAL_DATA=PASS (0.00026 x 3 =", barrier, ")")
}

// ── Caso 2: margem de trânsito (valor movido x drift x janela) ────────────
function testTransitMargin(): void {
  const margin = computeTransitMargin({
    tradeAmountUsd: DEFAULT_TRADE_AMOUNT_USD,
    transitDriftRate: DEFAULT_TRANSIT_DRIFT_RATE,
    transitWindowHours: DEFAULT_TRANSIT_WINDOW_HOURS,
  })
  const expected = DEFAULT_TRADE_AMOUNT_USD * DEFAULT_TRANSIT_DRIFT_RATE * DEFAULT_TRANSIT_WINDOW_HOURS
  expect(
    Math.abs(margin - expected) < 1e-12,
    `margem de trânsito: esperado ${expected}, got ${margin}`,
  )
  console.log("RI_BANK_96_TRANSIT_MARGIN=PASS (", margin, ")")
}

// ── Caso 3: sinal POSITIVO quando a diferença de preço supera a barreira ──
function testPositiveSignal(): void {
  const result = evaluateBridgeOpportunity({
    pairLabel: "USDC→EURC",
    sourceNetwork: "arc",
    destinationNetwork: "base",
    priceSourceUsd: 1.0,
    priceDestinationUsd: 1.01, // 1% de diferença
    cctpFeeUsd: 0.00026,
    gasSourceUsd: 0.0,
    gasDestinationUsd: 0.0,
  })
  expect(
    result.signal === "bridges_worth_considering",
    `esperado sinal positivo com diff 1% (0.01 > barreira ~0.001), got ${result.signal}`,
  )
  expect(result.surplusUsd > 0, `surplusUsd deve ser positivo, got ${result.surplusUsd}`)
  console.log("RI_BANK_96_POSITIVE_SIGNAL=PASS (surplus", result.surplusUsd, ")")
}

// ── Caso 4: sinal NEGATIVO quando a diferença é menor que a barreira ──────
function testNegativeSignal(): void {
  const result = evaluateBridgeOpportunity({
    pairLabel: "USDC→EURC",
    sourceNetwork: "arc",
    destinationNetwork: "base",
    priceSourceUsd: 1.0,
    priceDestinationUsd: 1.0001, // 0.01% de diferença — abaixo da barreira
    cctpFeeUsd: 0.00026,
    gasSourceUsd: 0.0,
    gasDestinationUsd: 0.0,
  })
  expect(
    result.signal === "not_worth_considering",
    `esperado sinal negativo com diff 0.01% (0.0001 < barreira ~0.001), got ${result.signal}`,
  )
  console.log("RI_BANK_96_NEGATIVE_SIGNAL=PASS (surplus", result.surplusUsd, ")")
}

// ── Caso 5: barreira completa (fixa + trânsito) — fronteira ───────────────
function testFullBarrierBoundary(): void {
  const result = evaluateBridgeOpportunity({
    pairLabel: "USDC→EURC",
    sourceNetwork: "arc",
    destinationNetwork: "base",
    priceSourceUsd: 1.0,
    // diff = barreira fixa - 1e-9: logo abaixo da fronteira → > estrito falha → negativo
    priceDestinationUsd: 1.0 + 0.00026 * 3 - 1e-9,
    cctpFeeUsd: 0.00026,
    gasSourceUsd: 0.0,
    gasDestinationUsd: 0.0,
    transitWindowHours: 0, // sem margem de trânsito p/ testar a fronteira pura
    transitDriftRatePerHour: 0,
    tradeAmountUsd: 0,
  })
  expect(
    result.surplusUsd < 0,
    `abaixo da fronteira surplus deve ser negativo (sinal negativo com > estrito), got ${result.surplusUsd}`,
  )
  expect(
    result.signal === "not_worth_considering",
    `na fronteira exata sinal deve ser negativo (> estrito), got ${result.signal}`,
  )
  console.log("RI_BANK_96_FULL_BARRIER_BOUNDARY=PASS (barreira", result.totalBarrierUsd, ")")
}

async function run(): Promise<void> {
  testFixedCostBarrierWithRealData()
  testTransitMargin()
  testPositiveSignal()
  testNegativeSignal()
  testFullBarrierBoundary()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})