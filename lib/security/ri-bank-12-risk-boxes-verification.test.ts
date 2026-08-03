// RI-BANK-12 — verificação estrutural e comportamental.
// Execução exclusivamente em memória: este arquivo remove credenciais KV
// ANTES do import do módulo e ativa o test hook que proíbe persistência.

import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const ROOT = join(__dirname, "..", "..")

type VulnerableB = { saldo: number; risco: number }

// Reprodução pré-fix isolada da classe A4b: ambas as operações capturam o
// mesmo snapshot antes do await e depois gravam o objeto inteiro. A segunda
// escrita perde o lucro da primeira de forma determinística.
async function reproduceVulnerableRace(): Promise<boolean> {
  let shared: VulnerableB = { saldo: 100, risco: 50 }
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  let ready = 0
  const snapshotThenWrite = async (mutate: (s: VulnerableB) => VulnerableB) => {
    const snapshot = { ...shared }
    ready++
    await barrier
    shared = mutate(snapshot)
  }
  const profit = snapshotThenWrite(s => ({ ...s, saldo: s.saldo + 10 }))
  const reconfigure = snapshotThenWrite(s => ({ ...s, risco: 30 }))
  expect(ready === 2, "as duas operações vulneráveis devem capturar o snapshot antes da barreira")
  release()
  await Promise.all([profit, reconfigure])
  return shared.saldo !== 110 || shared.risco !== 30
}

export async function runRiBank12RiskBoxesVerification(): Promise<void> {
  const savedUrl = process.env.KV_REST_API_URL
  const savedToken = process.env.KV_REST_API_TOKEN
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  process.env.ARCFLOW_RISK_BOXES_TEST_MODE = "1"

  try {
    const kv = await import("../kv")
    expect(kv.isKvConfigured() === false, "D5: credenciais Redis devem estar indisponíveis durante toda a suíte")

    const risk = await import("../risk-boxes")
    await risk.resetRiskBoxesForTests()

    // [STRUCTURAL] gates específicos precisam estar antes do primeiro swap.
    const corretor = readFileSync(join(ROOT, "lib", "corretor.ts"), "utf8")
    const firstAuthorization = corretor.indexOf("await authorizeRiskBoxTradeFresh(ordem.riskBox, valorTrade)")
    const firstSwap = corretor.indexOf("realSwap.executeSwap(")
    expect(firstAuthorization >= 0 && firstAuthorization < firstSwap,
      "D1/D2: authorizeRiskBoxTradeFresh deve estar no caminho real antes de executeSwap")
    expect(corretor.includes("recordRiskBoxEconomicResult(ordem.riskBox!, profit)"),
      "D3: resultado realizado deve alimentar as caixas")

    const adapter = readFileSync(join(ROOT, "lib", "agent-framework", "trading-adapter.ts"), "utf8")
    expect(adapter.includes("Missing or invalid riskBox (A/B)"),
      "origem A/B deve ser obrigatória já no TradingAdapter")
    console.log("[STRUCTURAL] gates A/B e alimentação econômica presentes no caminho real.")

    // Gate fail-closed sem configuração.
    expect(risk.podeOperar() === false, "sem configuração deve recusar operar")
    expect(risk.authorizeRiskBoxTrade("A", 10).allowed === false, "A não configurada deve bloquear")
    expect(risk.authorizeRiskBoxTrade(undefined, 10).reason === "risk_boxes_not_configured",
      "configuração ausente tem precedência sobre origem ausente")

    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 20 },
    })
    expect(risk.podeOperar() === true, "configuração atômica válida deve liberar o gate global")
    expect(risk.authorizeRiskBoxTrade(undefined, 10).reason === "risk_box_origin_required",
      "origem ausente deve falhar fechada")

    const beforeInvalidConfig = risk.getRiskBoxesState()
    let rejectedNull = false
    try {
      await risk.configureRiskBoxes({
        caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
        caixaB: { saldo: 100, investir: true, riscoPercentual: null },
      })
    } catch { rejectedNull = true }
    expect(rejectedNull, "configuração atômica deve rejeitar null obrigatório")
    expect(risk.getRiskBoxesState().version === beforeInvalidConfig.version,
      "configuração inválida não pode publicar versão parcial")

    // Caixa A abaixo/acima e gate de esgotada.
    await risk.registrarPerdaCaixaA(90)
    expect(risk.getRiskBoxesState().caixaA.esgotada === false, "A: 9% não deve esgotar limite de 10%")
    await risk.registrarPerdaCaixaA(20)
    expect(risk.getRiskBoxesState().caixaA.esgotada === true, "A: 11% deve esgotar limite de 10%")
    expect(risk.authorizeRiskBoxTrade("A", 10).reason === "caixa_a_exhausted",
      "D1: A esgotada deve bloquear antes do swap")

    // B desligada: recusa PRÉ-trade, sem consumir saldo.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: false },
    })
    const bBefore = risk.getRiskBoxesState().caixaB.saldo
    expect(risk.authorizeRiskBoxTrade("B", 1).reason === "caixa_b_investment_disabled",
      "D2: investir=false deve bloquear qualquer trade usando B")
    expect(risk.getRiskBoxesState().caixaB.saldo === bBefore,
      "gate pré-trade não deve simular perda nem alterar saldo")

    // B ligada abaixo/acima do limite.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 20 },
    })
    await risk.registrarPerdaCaixaB(15)
    expect(risk.getRiskBoxesState().caixaB.saldo === 85, "B: 15% não deve zerar limite de 20%")
    await risk.registrarPerdaCaixaB(6)
    expect(risk.getRiskBoxesState().caixaB.saldo === 0, "B: 21% deve zerar")
    expect(risk.authorizeRiskBoxTrade("B", 1).reason === "caixa_b_without_balance",
      "B zerada deve bloquear sem afetar A")
    expect(risk.authorizeRiskBoxTrade("A", 1).allowed === true,
      "Pergunta 1: B zerada não deve pausar A")

    // Mesmo evento lógico atingindo A e B: cada caixa decide isoladamente.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 100, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 20 },
    })
    await Promise.all([risk.registrarPerdaCaixaA(11), risk.registrarPerdaCaixaB(21)])
    const simultaneous = risk.getRiskBoxesState()
    expect(simultaneous.caixaA.esgotada && simultaneous.caixaB.saldo === 0,
      "evento simultâneo deve aplicar os dois limites sem acoplamento")

    // A3: B recomeça após zerar e baseline fica fixo.
    await risk.registrarLucroCaixaB(40)
    expect(risk.getRiskBoxesState().caixaB.baseline === 40, "novo ciclo de B deve iniciar baseline em 40")
    await risk.registrarLucroCaixaB(20)
    const afterExtraProfit = risk.getRiskBoxesState().caixaB
    expect(afterExtraProfit.saldo === 60 && afterExtraProfit.baseline === 40,
      "decisão 4: lucro adicional aumenta saldo, mas não cria high-water mark")

    // A3 toggle no meio de sessão: preserva saldo, reinicia época de risco.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 50 },
    })
    await risk.registrarPerdaCaixaB(10)
    await risk.setCaixaBInvestir(false)
    let toggled = risk.getRiskBoxesState().caixaB
    expect(toggled.saldo === 90 && toggled.perdaAcumulada === 0 && toggled.baseline === 90,
      "toggle true->false preserva saldo e não vaza perda/baseline da época anterior")
    expect(risk.authorizeRiskBoxTrade("B", 1).allowed === false, "B desligada deve permanecer bloqueada")
    await risk.setCaixaBRisco(25)
    await risk.setCaixaBInvestir(true)
    toggled = risk.getRiskBoxesState().caixaB
    expect(toggled.investir === true && toggled.riscoPercentual === 25 && toggled.perdaAcumulada === 0,
      "toggle false->true exige risco explícito e começa época limpa")

    // Reconfiguração atômica: nenhuma publicação intermediária null.
    const versions: number[] = []
    const configs = Array.from({ length: 20 }, (_, i) => risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 500 + i, riscoPercentual: 10 },
      caixaB: { saldo: 50 + i, investir: true, riscoPercentual: 25 },
    }).then(s => { versions.push(s.version) }))
    for (let i = 0; i < 20; i++) expect(risk.podeOperar(), "configuração concorrente nunca deve publicar null")
    await Promise.all(configs)
    expect(new Set(versions).size === 20, "cada configuração serializada deve produzir versão única")

    // Decisão 3: mesmos limites em testnet.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 100, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 20 },
    })
    await risk.setRiskBoxesTestnetMode(true)
    await risk.registrarPerdaCaixaA(11)
    expect(risk.getRiskBoxesState().caixaA.esgotada === true,
      "testnet deve aplicar o mesmo limite de 10% da Caixa A")

    // Roteamento do resultado: lucro sempre B; perda volta à caixa de origem.
    await risk.configureRiskBoxes({
      caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
      caixaB: { saldo: 100, investir: true, riscoPercentual: 50 },
    })
    await risk.recordRiskBoxEconomicResult("A", 10)
    expect(risk.getRiskBoxesState().caixaB.saldo === 110, "lucro realizado em A deve cair em B")
    await risk.recordRiskBoxEconomicResult("A", -5)
    expect(risk.getRiskBoxesState().caixaA.perdaAcumulada === 5, "perda de A deve ser atribuída a A")
    await risk.recordRiskBoxEconomicResult("B", -4)
    expect(risk.getRiskBoxesState().caixaB.saldo === 106, "perda de B deve ser debitada de B")

    // D4 antes: implementação vulnerável perde atualização em 30/30.
    let vulnerableFailures = 0
    for (let i = 0; i < 30; i++) if (await reproduceVulnerableRace()) vulnerableFailures++
    expect(vulnerableFailures === 30, `A4b pré-fix deveria falhar 30/30; falhou ${vulnerableFailures}/30`)
    console.log(`[A4b BEFORE] atualização perdida em ${vulnerableFailures}/30.`)

    // D4 depois: mesma concorrência no módulo real, serializado.
    let fixedFailures = 0
    for (let i = 0; i < 30; i++) {
      await risk.configureRiskBoxes({
        caixaA: { valorPrincipal: 1_000, riscoPercentual: 10 },
        caixaB: { saldo: 100, investir: true, riscoPercentual: 50 },
      })
      await Promise.all([
        risk.registrarLucroCaixaB(10),
        risk.setCaixaBRisco(30),
      ])
      const s = risk.getRiskBoxesState().caixaB
      if (s.saldo !== 110 || s.riscoPercentual !== 30 || s.baseline !== 110) fixedFailures++
    }
    expect(fixedFailures === 0, `A4b pós-fix deveria falhar 0/30; falhou ${fixedFailures}/30`)
    console.log(`[A4b AFTER] inconsistência em ${fixedFailures}/30.`)

    expect(kv.isKvConfigured() === false, "D5: Redis deve continuar inacessível ao final")
    console.log("ALL_RI_BANK_12_RISK_BOXES_VERIFICATION_ASSERTIONS_PASSED=YES")
  } finally {
    if (savedUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = savedUrl
    if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = savedToken
    delete process.env.ARCFLOW_RISK_BOXES_TEST_MODE
  }
}

runRiBank12RiskBoxesVerification().catch(err => {
  console.error(err)
  process.exitCode = 1
})
