// RI-BANK-14 — verificação estrutural e comportamental dos números D3.
// Somente memória: remove credenciais antes dos imports e não importa trade executors.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const ROOT = join(__dirname, "..", "..")
const CB_FILE = join(ROOT, ".data", "circuit-breaker-state.json")

export async function runRiBank14D3Verification(): Promise<void> {
  const savedUrl = process.env.KV_REST_API_URL
  const savedToken = process.env.KV_REST_API_TOKEN
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  process.env.ARCFLOW_RISK_BOXES_TEST_MODE = "1"
  const cbFileHadBefore = existsSync(CB_FILE)
  const cbFileBackup = cbFileHadBefore ? readFileSync(CB_FILE, "utf8") : null

  try {
    const corretor = readFileSync(join(ROOT, "lib", "corretor.ts"), "utf8")
    const riskGate = corretor.indexOf("await authorizeRiskBoxTradeFresh(ordem.riskBox, valorTrade)")
    const swap = corretor.indexOf("realSwap.executeSwap(")
    expect(riskGate >= 0 && riskGate < swap,
      "[STRUCTURAL] teto por trade deve passar pelo gate antes do swap individual")
    expect(corretor.includes("await authorizeRiskBoxTradeFresh(ordens[i].riskBox, valores[i])"),
      "[STRUCTURAL] cada item de batch deve passar pelo mesmo gate")
    expect(corretor.includes("await initializeTradingBudgetDailyLimit()"),
      "[STRUCTURAL] orçamento inicial de $50 deve ser garantido antes do gate diário")
    expect(corretor.includes("await recordTradeResult(profit)"),
      "[STRUCTURAL] circuit breaker global deve continuar conectado ao settlement")
    console.log("[STRUCTURAL] teto A/B e orçamento precedem swap; circuit breaker segue conectado ao settlement.")

    const risk = await import("../risk-boxes")
    await risk.resetRiskBoxesForTests()
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 20 },
    })
    expect(risk.getRiskBoxesState().perTradeCapUsd === 15, "teto inicial deveria ser $15")
    for (const box of ["A", "B"] as const) {
      expect(risk.authorizeRiskBoxTrade(box, 15).allowed === true,
        `${box}: valor exatamente no teto de $15 deve ser permitido`)
      const blocked = risk.authorizeRiskBoxTrade(box, 15.01)
      expect(blocked.allowed === false && blocked.reason === "trade_amount_exceeds_per_trade_cap",
        `${box}: $15.01 deve bloquear com o motivo correto`)
    }
    await risk.setRiskBoxesPerTradeCap(20)
    expect(risk.authorizeRiskBoxTrade("A", 20).allowed && risk.authorizeRiskBoxTrade("B", 20).allowed,
      "teto configurável de $20 deve valer igualmente para A e B")
    console.log("[BEHAVIORAL] A/B: $15 permitido; $15.01 bloqueado; teto configurável confirmado.")

    const budget = await import("../trading-budget")
    await budget.setTradingBudgetDaily(null)
    const initialized = await budget.initializeTradingBudgetDailyLimit()
    expect(initialized.dailyLimitUsd === 50, `orçamento inicial deveria ser $50, veio ${initialized.dailyLimitUsd}`)
    await budget.resetTradingBudgetManual()
    await budget.recordTradingSpend(25)
    expect(!budget.isBudgetExceeded(25), "$25 + $25 deve atingir exatamente $50 sem exceder")
    expect(budget.isBudgetExceeded(25.01), "$25.01 + $25 deve exceder $50")
    await budget.recordTradingSpend(25)
    expect(budget.isBudgetExceeded(0.01), "orçamento consumido em $50 deve bloquear novo gasto")
    console.log("[BEHAVIORAL] orçamento diário $50 acumulou 25+25 e bloqueou valor adicional.")

    const circuit = await import("../circuit-breaker")
    await circuit.resetCircuitBreaker()
    await circuit.setTestnetMode(false)
    expect(circuit.getCircuitBreakerState().maxDrawdownPercent === 60,
      "backstop mainnet deveria ser 60%")
    await circuit.recordTradeResult(100)
    await circuit.recordTradeResult(-20)
    expect(circuit.getCircuitBreakerState().isPanicActive === false,
      "drawdown de 20% não deve disparar o backstop de 60%")
    await circuit.recordTradeResult(-40)
    const tripped = circuit.getCircuitBreakerState()
    expect(tripped.isPanicActive === true, "drawdown de 60% deve disparar o backstop")
    expect((tripped.panicReason ?? "").includes("60.0%") && (tripped.panicReason ?? "").includes("limite: 60%"),
      `motivo deve registrar drawdown/limite de 60%: ${tripped.panicReason}`)
    console.log("[BEHAVIORAL] circuit breaker: 20% não dispara; 60% dispara o backstop global.")

    console.log("ALL_RI_BANK_14_D3_ASSERTIONS_PASSED=YES")
  } finally {
    if (existsSync(CB_FILE)) rmSync(CB_FILE)
    if (cbFileBackup !== null) writeFileSync(CB_FILE, cbFileBackup, "utf8")
    if (savedUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = savedUrl
    if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = savedToken
    delete process.env.ARCFLOW_RISK_BOXES_TEST_MODE
  }
}

runRiBank14D3Verification().catch(error => {
  console.error(error)
  process.exitCode = 1
})
