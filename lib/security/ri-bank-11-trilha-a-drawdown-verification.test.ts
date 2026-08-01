// RI-BANK-11 Trilha A — ri-bank-11-trilha-a-drawdown-verification.test.ts
//
// Comprova (ou refuta) com evidência automatizada real que o freio de P&L
// (lib/circuit-breaker.ts:244-257, drawdown sobre peakNetEquity) faz
// exatamente o que RI-BANK-10 Estágio 1 documentou como "existe no código
// mas nunca foi exercitado". Chama `recordTradeResult()` diretamente —
// nenhuma chave privada, nenhum swap real, nenhuma rede on-chain tocada.
//
// A1 — cruzamento exato do limiar (mainnet, 60%): confirma que
//   activatePanic() dispara exatamente quando o drawdown cruza o limiar,
//   nem antes nem depois, isolado do gatilho de perdas consecutivas
//   (mantido bem abaixo de maxLossesBeforePanic em todo o teste).
// A1-neg — sequência que NÃO cruza o limiar: confirma ausência de falso
//   positivo.
// A2 — reset de peakNetEquity via resumeFromPanic()/resetCircuitBreaker(),
//   e que uma sequência de lucro após um drawdown parcial (sem cruzar)
//   avança o pico corretamente, sem ficar "preso" no valor antigo.
// A3 — troca de rede (isTestnet true/false) no meio de uma sequência:
//   confirma que o cálculo de drawdown não vaza entre os dois modos.
//   [ACHADO, ver relatório] este teste reproduziu um vazamento real no
//   código como encontrado (peakNetEquity/totalProfit/totalLoss nunca
//   resetados na transição de modo) — corrigido em circuit-breaker.ts
//   (setTestnetMode) como consequência direta deste teste, seguindo o
//   padrão antes/depois já usado em RI-BANK-7/9. Este arquivo testa o
//   comportamento CORRIGIDO (pós-fix).
// A4 — concorrência: dispara recordTradeResult() de fontes concorrentes de
//   verdade (confirmado como cenário real: lib/pregão.ts:574,623,636
//   chamam os listeners de onOrdem sem await, e a verificação ao vivo do
//   RI-BANK-8 Estágio 5 já observou múltiplos pares operando na mesma
//   janela de ~1s) — mede se o contador final bate com o esperado.
//
// Circuit breaker real (fs fallback `.data/circuit-breaker-state.json` ou
// Redis de dev, o que estiver configurado) é backed up antes e restaurado
// depois, mesma convenção de todos os testes anteriores desta trilha.
//
// Run directly with: npx tsx --env-file=.env.local lib/security/ri-bank-11-trilha-a-drawdown-verification.test.ts

import { readFileSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..", "..")
const CB_FILE = join(REPO_ROOT, ".data", "circuit-breaker-state.json")

export async function runRiBank11TrilhaADrawdownVerification(): Promise<void> {
  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("../kv")
  const cbKey = circuitBreakerKvKey()
  const kvHadBefore = isKvConfigured() && (await getRedis().hlen(cbKey)) > 0
  const kvBackup = kvHadBefore ? await getRedis().hgetall<Record<string, unknown>>(cbKey) : null
  const fileHadBefore = existsSync(CB_FILE)
  const fileBackup = fileHadBefore ? readFileSync(CB_FILE, "utf-8") : null

  const {
    recordTradeResult, setTestnetMode, resumeFromPanic, resetCircuitBreaker,
    getCircuitBreakerState,
  } = await import("../circuit-breaker")

  try {
    if (isKvConfigured()) await getRedis().del(cbKey)
    if (existsSync(CB_FILE)) rmSync(CB_FILE)

    // ================================================================
    // A1 — cruzamento exato do limiar de drawdown (mainnet, 60%)
    // ================================================================
    await resetCircuitBreaker()
    await setTestnetMode(false) // garante mainnet (maxDrawdownPercent: 60)

    await recordTradeResult(100) // netEquity=100, peak=100
    {
      const s = getCircuitBreakerState()
      expect(s.peakNetEquity === 100, `peakNetEquity deveria ser 100 após lucro de 100, veio ${s.peakNetEquity}`)
      expect(s.isPanicActive === false, "não deveria haver pânico só com lucro")
    }

    await recordTradeResult(-59) // totalLoss=59, netEquity=41, drawdown=59% (<60)
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false, `NÃO deveria disparar pânico em 59% de drawdown (limite 60%) — reason: ${s.panicReason}`)
      expect(s.consecutiveLosses === 1, `consecutiveLosses deveria ser 1, veio ${s.consecutiveLosses}`)
    }
    console.log("[A1] confirmado: 59% de drawdown NÃO dispara pânico (abaixo do limite de 60%).")

    await recordTradeResult(-2) // totalLoss=61, netEquity=39, drawdown=61% (>=60) — deveria disparar
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === true, `deveria ter disparado pânico em 61% de drawdown (limite 60%), mas isPanicActive=${s.isPanicActive}`)
      expect(s.consecutiveLosses === 0, "activatePanic() zera consecutiveLosses — confirma que o gatilho foi o drawdown (2 perdas consecutivas, bem abaixo de maxLossesBeforePanic=5), não perdas consecutivas")
      expect((s.panicReason ?? "").includes("Drawdown de"), `panicReason deveria mencionar 'Drawdown de', veio: "${s.panicReason}"`)
      expect((s.panicReason ?? "").includes("61.0%"), `panicReason deveria mencionar o valor exato do drawdown (61.0%), veio: "${s.panicReason}"`)
      console.log(`[A1] confirmado: pânico disparou ao cruzar 61% de drawdown (limite 60%) — reason real: "${s.panicReason}"`)
    }

    // ================================================================
    // A1-neg — sequência que NÃO cruza o limiar: sem falso positivo
    // ================================================================
    await resumeFromPanic()
    await resetCircuitBreaker()
    await setTestnetMode(false)

    await recordTradeResult(50) // peak=50
    await recordTradeResult(-25) // netEquity=25, drawdown=50% (<60)
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false, `falso positivo: pânico disparou com 50% de drawdown (limite 60%) — reason: ${s.panicReason}`)
      expect(s.panicReason === null, `panicReason deveria ser null, veio "${s.panicReason}"`)
    }
    console.log("[A1-neg] confirmado: 50% de drawdown não gera falso positivo.")

    // ================================================================
    // A2 — reset de peakNetEquity + avanço correto após drawdown parcial
    // ================================================================
    await resetCircuitBreaker()
    await setTestnetMode(false)
    await recordTradeResult(100)
    await recordTradeResult(-59)
    await recordTradeResult(-2) // dispara pânico de novo (61% drawdown), como em A1

    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === true, "pré-condição do A2: deveria estar em pânico antes de testar o resume")
    }

    await resumeFromPanic()
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false, "resumeFromPanic() deveria desativar o pânico")
      expect(s.peakNetEquity === 0, `resumeFromPanic() deveria resetar peakNetEquity para 0, veio ${s.peakNetEquity}`)
      expect(s.totalProfit === 0 && s.totalLoss === 0, `resumeFromPanic() deveria resetar totalProfit/totalLoss para 0, veio totalProfit=${s.totalProfit} totalLoss=${s.totalLoss}`)
    }
    console.log("[A2] confirmado: resumeFromPanic() reseta peakNetEquity/totalProfit/totalLoss para 0.")

    await recordTradeResult(30) // novo baseline: peak deveria virar 30, não ficar em 0 nem herdar o valor antigo (100)
    {
      const s = getCircuitBreakerState()
      expect(s.peakNetEquity === 30, `após resumeFromPanic(), um novo lucro de 30 deveria fazer peakNetEquity=30 (novo baseline), veio ${s.peakNetEquity}`)
    }
    console.log("[A2] confirmado: peakNetEquity assume o novo baseline (30) corretamente após o reset — não ficou preso no valor antigo (100) nem esquecido em 0.")

    // Drawdown parcial (sem cruzar o limite) seguido de lucro — o pico deve
    // AVANÇAR para o novo patrimônio líquido mais alto, não ficar parado.
    await resetCircuitBreaker()
    await setTestnetMode(false)
    await recordTradeResult(50) // peak=50
    await recordTradeResult(-20) // netEquity=30, drawdown=40% (<60, sem pânico) — peak deveria continuar 50
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false, "40% de drawdown não deveria disparar pânico")
      expect(s.peakNetEquity === 50, `peakNetEquity deveria continuar em 50 (pico histórico) após um drawdown parcial, veio ${s.peakNetEquity}`)
    }
    await recordTradeResult(30) // totalProfit=80, totalLoss=20, netEquity=60 > peak(50) — deveria avançar
    {
      const s = getCircuitBreakerState()
      expect(s.peakNetEquity === 60, `peakNetEquity deveria AVANÇAR para 60 (novo patrimônio líquido, maior que o pico anterior de 50), veio ${s.peakNetEquity} — 'preso no valor antigo' seria o bug que este teste existe para descartar`)
    }
    console.log("[A2] confirmado: após um drawdown parcial, um lucro subsequente avança peakNetEquity corretamente (50 → 60).")

    // ================================================================
    // A3 — troca de rede no meio de uma sequência: sem vazamento entre
    // mainnet e testnet
    // ================================================================
    await resetCircuitBreaker()
    await setTestnetMode(false) // mainnet
    await recordTradeResult(100) // peak=100, totalProfit=100
    {
      const s = getCircuitBreakerState()
      expect(s.peakNetEquity === 100 && s.totalProfit === 100, "pré-condição do A3: peak e totalProfit deveriam ser 100 antes da troca de rede")
    }

    await setTestnetMode(true) // troca para testnet — deveria resetar o baseline (ver ACHADO no relatório)
    {
      const s = getCircuitBreakerState()
      expect(s.totalProfit === 0 && s.totalLoss === 0 && s.peakNetEquity === 0,
        `setTestnetMode(true) deveria resetar totalProfit/totalLoss/peakNetEquity ao mudar de modo — veio totalProfit=${s.totalProfit} totalLoss=${s.totalLoss} peakNetEquity=${s.peakNetEquity}`)
    }
    console.log("[A3] confirmado: trocar para testnet reseta o baseline de P&L (totalProfit/totalLoss/peakNetEquity) — atividade de mainnet não fica pendurada no cálculo.")

    await recordTradeResult(-80) // perda grande em testnet — bem acima do limiar de $0.50 ignorado
    {
      const s = getCircuitBreakerState()
      expect(s.totalLoss === 80, `perda de 80 em testnet deveria contar para totalLoss, veio ${s.totalLoss}`)
      expect(s.peakNetEquity === 0, "em testnet, peakNetEquity não deve ser tocado pelo bloco de drawdown (isTestnet gate) — deveria continuar 0")
      expect(s.isPanicActive === false, "perda em testnet não deveria disparar o gate de drawdown (só roda em mainnet)")
    }

    await setTestnetMode(false) // volta para mainnet — deveria resetar de novo, não herdar o totalLoss=80 do testnet
    {
      const s = getCircuitBreakerState()
      expect(s.totalProfit === 0 && s.totalLoss === 0 && s.peakNetEquity === 0,
        `voltar para mainnet deveria resetar o baseline de novo (não herdar totalLoss=80 acumulado em testnet) — veio totalProfit=${s.totalProfit} totalLoss=${s.totalLoss} peakNetEquity=${s.peakNetEquity}`)
    }
    console.log("[A3] confirmado: voltar para mainnet reseta o baseline de novo — a perda de 80 acumulada em testnet NÃO vazou para o cálculo de mainnet.")

    await recordTradeResult(5) // pequeno lucro em mainnet — não deveria disparar nada
    {
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false,
        `SEM o fix, este lucro de 5 dispararia um pânico falso (peak preso em 100, totalLoss contaminado em 80, drawdown calculado em 75%) — COM o fix, não deveria disparar nada. isPanicActive=${s.isPanicActive}, reason=${s.panicReason}`)
      expect(s.peakNetEquity === 5, `peakNetEquity deveria ser 5 (novo baseline limpo pós-troca de rede), veio ${s.peakNetEquity}`)
    }
    console.log("[A3] confirmado: nenhum pânico falso disparou ao voltar para mainnet — o vazamento entre modos foi eliminado.")

    // ================================================================
    // A4 — concorrência: fontes concorrentes de recordTradeResult()
    // ================================================================
    // Cenário real confirmado por leitura de código (não hipotético):
    // lib/pregão.ts:574,623,636 disparam os listeners de onOrdem (que
    // eventualmente chamam corretor.executar -> recordTradeResult) num for
    // síncrono, sem await — múltiplas ordens podem estar "em voo" ao mesmo
    // tempo. A verificação ao vivo do RI-BANK-8 Estágio 5 já observou isso
    // na prática (vários pares/agentes operando na mesma janela de ~1s).
    await resetCircuitBreaker()
    await setTestnetMode(false)

    // A4a — soma de lucros concorrentes: nenhuma atualização deveria se
    // perder (teste de "read-then-write" através de awaits).
    const N = 50
    await Promise.all(Array.from({ length: N }, () => recordTradeResult(1)))
    {
      const s = getCircuitBreakerState()
      expect(s.totalProfit === N, `${N} chamadas concorrentes de recordTradeResult(1) deveriam somar totalProfit=${N} exatamente — veio ${s.totalProfit} (diferença = atualização perdida por corrida)`)
    }
    console.log(`[A4a] confirmado: ${N} chamadas concorrentes de recordTradeResult(1) somaram totalProfit=${getCircuitBreakerState().totalProfit} — nenhuma atualização perdida.`)

    // A4b — janela de corrida identificada por leitura de código: um lucro
    // que zera consecutiveLosses (linha "if (state.consecutiveLosses !== 0)
    // { await cbCounterOp(...); state.consecutiveLosses = 0 }") pode, em
    // teoria, sobrescrever o incremento de uma perda concorrente que
    // aconteceu durante esse await. Testado empiricamente, várias vezes,
    // porque a reprodução depende de timing.
    //
    // Baseline de peak GRANDE (1000) de propósito, estabelecido ANTES do
    // par concorrente — isola a corrida de consecutiveLosses do gatilho de
    // drawdown (que também zera consecutiveLosses, como efeito colateral
    // de activatePanic(), e confundiria o sinal medido aqui se um lucro/
    // perda pequenos por si só já cruzassem 10% de drawdown contra um peak
    // pequeno).
    let raceReproduced = 0
    const TRIALS = 30
    for (let i = 0; i < TRIALS; i++) {
      await resetCircuitBreaker()
      await setTestnetMode(false)
      await recordTradeResult(1000) // peak=1000 — qualquer variação de +-2 é <1% de drawdown, nunca cruza os 60%
      await recordTradeResult(-1) // consecutiveLosses=1, deixa o "reset" do próximo lucro ter algo pra zerar
      await Promise.all([
        recordTradeResult(1),   // profit: vai tentar zerar consecutiveLosses
        recordTradeResult(-1),  // loss concorrente: vai tentar incrementar consecutiveLosses
      ])
      const s = getCircuitBreakerState()
      expect(s.isPanicActive === false, `pré-condição do A4b quebrada: pânico disparou por drawdown (reason: ${s.panicReason}), o que confundiria o sinal medido — ajustar os valores do teste`)
      // Se a corrida acontecer, o reset do lucro pode sobrescrever o
      // incremento da perda concorrente, deixando consecutiveLosses em 0
      // quando deveria refletir a perda concorrente (1).
      if (s.consecutiveLosses === 0) raceReproduced++
    }
    console.log(`[A4b] janela de corrida em consecutiveLosses (lucro zerando por cima de uma perda concorrente): reproduzida em ${raceReproduced}/${TRIALS} tentativas.`)

    console.log("ALL_RI_BANK_11_TRILHA_A_DRAWDOWN_VERIFICATION_ASSERTIONS_PASSED=YES")
  } finally {
    await resumeFromPanic().catch(() => {})
    await resetCircuitBreaker().catch(() => {})
    if (isKvConfigured()) {
      await getRedis().del(cbKey)
      if (kvBackup && Object.keys(kvBackup).length > 0) await getRedis().hset(cbKey, kvBackup)
    }
    if (existsSync(CB_FILE)) rmSync(CB_FILE)
    if (fileBackup !== null) writeFileSync(CB_FILE, fileBackup, "utf-8")
  }
}

runRiBank11TrilhaADrawdownVerification().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
