// RI-BANK-81 — confirma: (1) o cálculo de lucro usa câmbio EXTERNO real
// (não o preço interno de nenhum pool), (2) USDC é tratado 1:1 com USD por
// definição de peg, EURC usa a taxa externa, (3) pares não suportados
// (ex: cirBTC) falham fechado -- nunca fabricam um número, (4)
// fetchExternalUsdEurRate() de fato tenta de novo numa falha transitória
// de rede antes de desistir (mesmo padrão de resiliência já validado em
// RI-BANK-50/62/72), sem nunca cair num fallback 1:1 silencioso.

import {
  computeSwapProfitUsd,
  convertTokenAmountToUsd,
  isSupportedForexToken,
} from "../bandit-execution-feedback"
import { fetchExternalUsdEurRate } from "../external-forex-rate"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function expectClose(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  expect(Math.abs(actual - expected) < epsilon, `${message} (actual=${actual}, expected=${expected})`)
}

const MOCK_USD_PER_EUR = 1.08 // taxa fictícia só para teste -- nunca hardcoded no código real

function testUsdcIsOneToOne(): void {
  const usd = convertTokenAmountToUsd("USDC", 0.10, MOCK_USD_PER_EUR)
  expectClose(usd, 0.10, "USDC deve ser 1:1 com USD, independente da taxa EUR passada")
  console.log("RI_BANK_81_USDC_ONE_TO_ONE=PASS")
}

function testEurcUsesExternalRate(): void {
  const usd = convertTokenAmountToUsd("EURC", 10, MOCK_USD_PER_EUR)
  expectClose(usd, 10.8, "EURC deve converter usando a taxa externa passada, não 1:1")
  console.log("RI_BANK_81_EURC_USES_EXTERNAL_RATE=PASS")
}

function testUnsupportedTokenFailsClosed(): void {
  let threw = false
  try {
    convertTokenAmountToUsd("cirBTC", 1, MOCK_USD_PER_EUR)
  } catch {
    threw = true
  }
  expect(threw, "cirBTC não tem fonte de câmbio fiat -- deve lançar, nunca assumir 1:1 silenciosamente")
  expect(!isSupportedForexToken("cirBTC"), "cirBTC não deve ser reportado como suportado")
  expect(isSupportedForexToken("usdc"), "USDC deve ser suportado (case-insensitive)")
  console.log("RI_BANK_81_UNSUPPORTED_TOKEN_FAILS_CLOSED=PASS")
}

async function testComputeSwapProfitUsdWithInjectedRate(): Promise<void> {
  // USDC→EURC: gastou $0,10 USDC, recebeu 0,092 EURC (dado on-chain real,
  // já apurado por real-swap-executor.ts via saldo antes/depois).
  // Convertido para USD pela taxa externa injetada (1.08): 0,092 * 1.08 =
  // $0,09936 -- uma pequena perda de ~$0,00064 em termos de valor real,
  // não o que o pool distorcido mostraria.
  const fetchRate = async () => ({ usdPerEur: MOCK_USD_PER_EUR, source: "test-fixture", fetchedAt: Date.now() })
  const result = await computeSwapProfitUsd("USDC", "EURC", 0.10, 0.092, true, fetchRate)
  expectClose(result.profitUsd, 0.092 * MOCK_USD_PER_EUR - 0.10, "profitUsd deve ser toUsd - fromUsd usando a taxa externa")
  expect(result.environment === "testnet", `expected environment=testnet, got ${result.environment}`)
  expect(result.priceSource === "test-fixture", "priceSource deve vir da função de taxa injetada")
  console.log(`RI_BANK_81_COMPUTE_PROFIT_WITH_EXTERNAL_RATE=PASS (profitUsd=${result.profitUsd.toFixed(6)})`)
}

async function testComputeSwapProfitUsdMarksMainnet(): Promise<void> {
  const fetchRate = async () => ({ usdPerEur: MOCK_USD_PER_EUR, source: "test-fixture", fetchedAt: Date.now() })
  const result = await computeSwapProfitUsd("USDC", "EURC", 0.10, 0.095, false, fetchRate)
  expect(result.environment === "mainnet", `expected environment=mainnet, got ${result.environment}`)
  console.log("RI_BANK_81_ENVIRONMENT_MARKER_REFLECTS_CALLER=PASS")
}

async function testComputeSwapProfitUsdRejectsUnsupportedPair(): Promise<void> {
  const fetchRate = async () => ({ usdPerEur: MOCK_USD_PER_EUR, source: "test-fixture", fetchedAt: Date.now() })
  let threw = false
  try {
    await computeSwapProfitUsd("cirBTC", "USDC", 1, 0.10, true, fetchRate)
  } catch (e) {
    threw = true
    expect(String((e as Error).message).includes("unsupported_pair"), `expected unsupported_pair error, got: ${e}`)
  }
  expect(threw, "expected computeSwapProfitUsd to reject a pair involving cirBTC")
  console.log("RI_BANK_81_UNSUPPORTED_PAIR_REJECTED=PASS")
}

// ── Resiliência de fetchExternalUsdEurRate(): mocka fetch global (funciona
// para chamadas fetch() diretas, diferente de ethers.JsonRpcProvider --
// confirmado empiricamente em RI-BANK-72) para simular uma falha
// transitória seguida de sucesso. ──────────────────────────────────────────
async function testFetchExternalRateRetriesTransientFailure(): Promise<void> {
  const originalFetch = globalThis.fetch
  let attempts = 0
  ;(globalThis as any).fetch = async () => {
    attempts++
    if (attempts < 2) {
      throw new Error("simulated transient network failure")
    }
    return {
      ok: true,
      json: async () => ({ amount: 1, base: "EUR", date: "2026-01-01", rates: { USD: 1.0847 } }),
    } as Response
  }
  try {
    const rate = await fetchExternalUsdEurRate()
    expect(attempts >= 2, `expected at least 2 attempts (1 failure + 1 success), got ${attempts}`)
    expectClose(rate.usdPerEur, 1.0847, "expected the rate from the successful attempt")
    expect(rate.source.includes("frankfurter"), `expected source to mention frankfurter, got: ${rate.source}`)
    console.log(`RI_BANK_81_EXTERNAL_RATE_RETRIES_TRANSIENT_FAILURE=PASS (attempts=${attempts})`)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testFetchExternalRateNeverFabricatesOnTotalFailure(): Promise<void> {
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = async () => {
    throw new Error("simulated persistent network failure")
  }
  let threw = false
  try {
    await fetchExternalUsdEurRate()
  } catch {
    threw = true
  } finally {
    globalThis.fetch = originalFetch
  }
  expect(threw, "expected fetchExternalUsdEurRate to throw (not fabricate a 1:1 fallback) when every attempt fails")
  console.log("RI_BANK_81_EXTERNAL_RATE_NEVER_FABRICATES_ON_TOTAL_FAILURE=PASS")
}

async function run(): Promise<void> {
  testUsdcIsOneToOne()
  testEurcUsesExternalRate()
  testUnsupportedTokenFailsClosed()
  await testComputeSwapProfitUsdWithInjectedRate()
  await testComputeSwapProfitUsdMarksMainnet()
  await testComputeSwapProfitUsdRejectsUnsupportedPair()
  await testFetchExternalRateRetriesTransientFailure()
  await testFetchExternalRateNeverFabricatesOnTotalFailure()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
