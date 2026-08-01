// RI-BANK-11 Trilha B — ri-bank-11-trilha-b-trading-budget.test.ts
//
// Testa lib/trading-budget.ts (novo módulo, RI-BANK-11) e sua checagem em
// lib/corretor.ts (B2) — mesmo padrão estrutural+comportamental já usado
// nesta trilha. Nenhum trade real, nenhuma chave privada.
//
// [STRUCTURAL] Confirma que a checagem está de fato no caminho de
//   execução real (não só declarada e nunca chamada — o mesmo tipo de bug
//   que RI-BANK-7 achou no botão de pânico órfão).
// [BEHAVIORAL] Confirma que o orçamento bloqueia quando esgotado, não
//   bloqueia sem limite configurado (default null = D3 pendente), soma
//   gastos corretamente, e nunca reseta sozinho.
//
// Run directly with: npx tsx --env-file=.env.local lib/security/ri-bank-11-trilha-b-trading-budget.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..", "..")

export async function runRiBank11TrilhaBTradingBudget(): Promise<void> {
  // ================================================================
  // [STRUCTURAL] corretor.ts de fato chama isBudgetExceeded() ANTES de
  // realSwap.executeSwap(), e recordTradingSpend() só DEPOIS de
  // resultado.success — não é código declarado e nunca invocado.
  // ================================================================
  {
    const corretorSrc = readFileSync(join(REPO_ROOT, "lib", "corretor.ts"), "utf-8")
    expect(
      corretorSrc.includes(`import { initializeTradingBudgetDailyLimit, isBudgetExceeded, recordTradingSpend } from "./trading-budget"`),
      "corretor.ts deve importar inicialização/isBudgetExceeded/recordTradingSpend de ./trading-budget"
    )
    const idxBudgetCheck = corretorSrc.indexOf("isBudgetExceeded(valorTrade)")
    const idxBlockIfPanicked = corretorSrc.indexOf("if (blockIfPanicked())")
    const idxExecuteSwap = corretorSrc.indexOf("realSwap.executeSwap(")
    const idxRecordSpend = corretorSrc.indexOf("recordTradingSpend(valorTrade)")
    const idxSuccessCheck = corretorSrc.indexOf("if (resultado.success)")
    expect(idxBudgetCheck > -1, "corretor.ts deve conter a chamada isBudgetExceeded(valorTrade)")
    expect(idxBlockIfPanicked > -1 && idxBudgetCheck > idxBlockIfPanicked, "a checagem de orçamento deve vir DEPOIS de blockIfPanicked() (mesmo padrão de gate)")
    expect(idxExecuteSwap > -1 && idxBudgetCheck < idxExecuteSwap, "a checagem de orçamento deve vir ANTES de realSwap.executeSwap() — de nada adianta checar depois do trade real acontecer")
    expect(idxRecordSpend > -1 && idxSuccessCheck > -1 && idxRecordSpend > idxSuccessCheck, "recordTradingSpend() deve vir DEPOIS de 'if (resultado.success)' — mede exposição de fato deployada, não tentativas")
  }
  console.log("[STRUCTURAL] confirmado: corretor.ts chama isBudgetExceeded(valorTrade) antes de executeSwap(), e recordTradingSpend(valorTrade) só após resultado.success — checagem real, não código órfão.")

  const {
    getTradingBudgetState, setTradingBudgetDaily, initializeTradingBudgetDailyLimit, isBudgetExceeded,
    recordTradingSpend, resetTradingBudgetManual,
  } = await import("../trading-budget")

  // ================================================================
  // [BEHAVIORAL] RI-BANK-14/D3: $50 é aplicado somente quando o campo
  // ainda está sem configuração e nunca sobrescreve decisão posterior.
  // ================================================================
  await setTradingBudgetDaily(null)
  await initializeTradingBudgetDailyLimit()
  {
    const s = getTradingBudgetState()
    expect(s.dailyLimitUsd === 50, `dailyLimitUsd inicial deveria ser $50, veio ${s.dailyLimitUsd}`)
  }
  await setTradingBudgetDaily(40)
  await initializeTradingBudgetDailyLimit()
  expect(getTradingBudgetState().dailyLimitUsd === 40,
    "inicialização idempotente não pode sobrescrever limite já configurado")
  console.log("[BEHAVIORAL] confirmado: D3 inicializa $50 uma vez e preserva configuração posterior.")

  // ================================================================
  // [BEHAVIORAL] Com limite configurado: bloqueia exatamente quando o
  // acumulado + a nova ordem excederia o teto, soma gastos corretamente.
  // ================================================================
  await setTradingBudgetDaily(50)
  await resetTradingBudgetManual()

  expect(isBudgetExceeded(25) === false, "$25 contra limite de $50 (0 gasto ainda) não deveria exceder")
  await recordTradingSpend(25)
  {
    const s = getTradingBudgetState()
    expect(s.spentToday === 25, `spentToday deveria ser 25 após recordTradingSpend(25), veio ${s.spentToday}`)
  }
  expect(isBudgetExceeded(25) === false, "$25 + $25 já gasto = $50, no limite exato não deve exceder")
  expect(isBudgetExceeded(25.01) === true, "$25.01 + $25 já gasto = $50.01, deveria exceder $50")
  await recordTradingSpend(25)
  {
    const s = getTradingBudgetState()
    expect(s.spentToday === 50, `spentToday deveria ser 50 após dois recordTradingSpend(25), veio ${s.spentToday}`)
  }
  expect(isBudgetExceeded(0.01) === true, "qualquer valor a mais deveria exceder um orçamento já 100% consumido")
  console.log("[BEHAVIORAL] confirmado: orçamento de $50 bloqueia corretamente e soma gastos exatamente (25+25=50).")

  // ================================================================
  // [BEHAVIORAL] Reset é sempre manual — nunca acontece sozinho.
  // ================================================================
  {
    const beforeReset = getTradingBudgetState()
    expect(beforeReset.spentToday === 50, "pré-condição: spentToday deveria continuar 50 antes do reset manual")
  }
  const afterReset = await resetTradingBudgetManual()
  expect(afterReset.spentToday === 0, `resetTradingBudgetManual() deveria zerar spentToday, veio ${afterReset.spentToday}`)
  expect(afterReset.lastResetAt !== null, "resetTradingBudgetManual() deveria registrar lastResetAt")
  expect(isBudgetExceeded(49.99) === false, "após reset manual, orçamento de $50 deveria estar livre de novo")

  // Confirma, por leitura de código, que não existe NENHUM setInterval,
  // setTimeout ou cron/schedule dentro de trading-budget.ts chamando
  // resetTradingBudgetManual() ou zerando spentToday sozinho — a única
  // forma de resetar é a função exportada, chamada explicitamente.
  {
    const budgetSrc = readFileSync(join(REPO_ROOT, "lib", "trading-budget.ts"), "utf-8")
    expect(!/setInterval\(|setTimeout\(/.test(budgetSrc), "trading-budget.ts NÃO deve conter nenhuma chamada real a setInterval()/setTimeout() — reset é sempre manual, por decisão já tomada no Estágio 3 do RI-BANK-10 (menções à palavra 'cron' em comentários explicativos são esperadas e não contam)")
  }
  console.log("[BEHAVIORAL] confirmado: reset é sempre manual (resetTradingBudgetManual()), e o código-fonte não contém nenhum timer/cron automático que pudesse resetar sozinho.")

  console.log("ALL_RI_BANK_11_TRILHA_B_TRADING_BUDGET_ASSERTIONS_PASSED=YES")
}

runRiBank11TrilhaBTradingBudget().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
