// RI-BANK-102 — cofre de lucros (Caixa B).
// Execução exclusivamente em memória: remove credenciais KV antes do import
// do módulo e ativa o teste hook que proíbe persistência.
//
// Critérios de aceite (copia10/copia11):
// 1. Lucro positivo CONFIRMADO (mesmo cálculo de RI-BANK-81, câmbio externo)
//    → 50% para a Caixa B (cofre) e 50% somados ao valorPrincipal da A
//    (reinvestimento, opção 2 confirmada).
// 2. Perda NUNCA gera movimento automático.
// 3. B→A é 100% MANUAL: apenas a rota administrativa com ADMIN_PANIC_KEY.
// 4. riscoPercentual da B pode ser 0 (cofre só recebe/guarda).
// 5. Auditoria registra cada movimento (valor, timestamp, operação de origem).

import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const ROOT = join(__dirname, "..", "..")

export async function runRiBank102CofreVerification(): Promise<void> {
  const savedUrl = process.env.KV_REST_API_URL
  const savedToken = process.env.KV_REST_API_TOKEN
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  process.env.ARCFLOW_RISK_BOXES_TEST_MODE = "1"

  try {
    const kv = await import("../kv")
    expect(kv.isKvConfigured() === false, "credenciais Redis devem estar indisponíveis durante toda a suíte")

    const risk = await import("../risk-boxes")
    await risk.resetRiskBoxesForTests()
    risk.resetCofreAuditForTests()

    // [4] Cofre: risco 0% para a B é configurável (só recebe/guarda).
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 0, investir: true, riscoPercentual: 0 },
    })
    expect(risk.getRiskBoxesState().caixaB.riscoPercentual === 0,
      "riscoPercentual da B deve aceitar 0 (cofre: mínima/Legada, documentado)")

    // [1] Lucro real confirmado de $20 → 50/50.
    await risk.registrarLucroCofre(20, "bandit:arc:cirBTC→USDC")
    let s = risk.getRiskBoxesState()
    expect(s.caixaB.saldo === 10, `lucro 20 → 50% na B; veio saldo ${s.caixaB.saldo}`)
    expect(s.caixaA.valorPrincipal === 1_010,
      `lucro 20 → 50% (10) somados ao valorPrincipal da A (opção 2); veio ${s.caixaA.valorPrincipal}`)
    expect(s.caixaB.investir === true && s.caixaB.saldo === 10,
      "B acumula como cofre — saldo preservado independente de risco 0")

    let ata = risk.getCofreMovimentos().filter(m => m.tipo === "A_TO_B_LUCRO")
    expect(ata.length === 1 && ata[0].valor === 10 && ata[0].origemOperacao === "bandit:arc:cirBTC→USDC",
      `auditoria A→B deve registrar valor 10 e origem; veio ${JSON.stringify(ata)}`)

    // [2] Perda NUNCA gera movimento automático.
    const auditBeforeLoss = risk.getCofreMovimentos().length
    await risk.registrarPerdaCaixaA(5000)
    s = risk.getRiskBoxesState()
    expect(s.caixaB.saldo === 10, "perda não pode mover saldo do cofre")
    expect(s.caixaA.perdaAcumulada === 5000, "perda continua a entrar na perdaAcumulada da A")
    expect(risk.getCofreMovimentos().length === auditBeforeLoss, "perda não pode gerar auditoria de cofre")

    // Lucro negativo rejeitado pelo registrador (defesa em profundidade).
    let rejeitouNegativo = false
    try { await risk.registrarLucroCofre(-3, "nunca") } catch { rejeitouNegativo = true }
    expect(rejeitouNegativo, "lucro negativo deve ser rejeitado")

    // [3] B→A MANUAL (função usada apenas pela rota ADMIN_PANIC_KEY).
    // Movimento parcial: 4.5 de 10.
    await risk.moverCofreParaPrincipalManual(4.5)
    s = risk.getRiskBoxesState()
    expect(Math.abs(s.caixaB.saldo - 5.5) < 1e-9, `B→A parcial 4.5: B deveria ficar 5.5 — veio ${s.caixaB.saldo}`)
    expect(Math.abs(s.caixaA.valorPrincipal - 1_014.5) < 1e-9,
      `B→A parcial 4.5: principal deveria ser 1014.5 — veio ${s.caixaA.valorPrincipal}`)
    let manuais = risk.getCofreMovimentos().filter(m => m.tipo === "B_TO_A_MANUAL")
    expect(manuais.length === 1 && manuais[0].valor === 4.5,
      `auditoria B→A deve registrar 4.5 — veio ${JSON.stringify(manuais)}`)

    // Movimento total (sem valor): esvazia a B.
    await risk.moverCofreParaPrincipalManual()
    s = risk.getRiskBoxesState()
    expect(s.caixaB.saldo === 0, `B→A total deve zerar o cofre — veio ${s.caixaB.saldo}`)
    manuais = risk.getCofreMovimentos().filter(m => m.tipo === "B_TO_A_MANUAL")
    const movidoTotal = manuais.reduce((acc, m) => acc + m.valor, 0)
    expect(Math.abs(movidoTotal - 10) < 1e-9, `B→A parcial + total deve mover 10 — veio ${movidoTotal}`)

    // [STRUCTURAL] gatilho existe só para lucro > 0 (nunca perda) e a rota
    // admin exige ADMIN_PANIC_KEY.
    const service = readFileSync(join(ROOT, "lib", "cron-trading-service.ts"), "utf8")
    expect(service.includes("registrarLucroCofre"), "dependência de cofre deve existir no serviço")
    expect(/banditProfitUsd\s*>\s*0/.test(service),
      "gatilho A→B só pode existir com lucro > 0")

    const runtime = readFileSync(join(ROOT, "lib", "cron-trading-runtime.ts"), "utf8")
    expect(runtime.includes("RI_BANK_102_COFRE_ENABLED"),
      "produção deve exigir flag explícito para ligar o cofre (OFF por padrão)")

    const rota = readFileSync(join(ROOT, "app", "api", "internal", "ri-bank-102-cofre-b-to-a", "route.ts"), "utf8")
    expect(rota.includes("isValidCronAdminRequest"), "rota B→A deve exigir ADMIN_PANIC_KEY (manual)")
    expect(rota.includes("moverCofreParaPrincipalManual"), "rota B→A deve chamar o movimento manual")

    expect(kv.isKvConfigured() === false, "Redis deve continuar inacessível ao final")
    console.log("ALL_BI_RANK_102_COFRE_ASSERTIONS_PASSED=YES")
  } finally {
    if (savedUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = savedUrl
    if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = savedToken
    delete process.env.ARCFLOW_RISK_BOXES_TEST_MODE
  }
}

runRiBank102CofreVerification().catch(err => {
  console.error(err)
  process.exitCode = 1
})