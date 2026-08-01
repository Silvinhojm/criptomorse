// RI-BANK-8 Stage 2 — ri-bank-8-stage2-cycle-unmount-bug.test.ts
//
// Proves, with automated evidence, that today's trading cycle mechanism
// (PregãoDashboard.tsx's cicloRef/alternarCiclo/cleanup — inventoried in
// full in RI-BANK-8 Stage 1, D1) stops firing forever once the same
// cleanup function React calls on unmount (PregãoDashboard.tsx:471-482)
// runs — with no user action, no "stopped" message, and no automatic
// recovery from that cleanup itself. This is the mechanism RI-UX-2 Stage 1
// identified as the reason the trading cycle dies whenever the user
// switches away from the Operator/Ledger/Debug tabs (DashboardShell.tsx
// only renders `{children}`, where PregãoDashboard lives, inside those 3
// branches — confirmed structurally below).
//
// IMPORTANT — what this test does and does NOT do, and why:
// This repository has no React test renderer installed today. Checked
// directly in node_modules before writing this test: no jsdom, no
// @testing-library/react, no react-test-renderer. A literal
// `render(<PregãoDashboard />)` + `unmount()` is therefore not possible
// without adding a new dependency (touches package.json, requires
// `npm install`) — out of scope for Stage 2's mandate ("sem tocar em
// nenhum arquivo de produção"), so not done here without asking first.
//
// Instead this test does two things, both without any new dependency:
//   1. [STRUCTURAL] Reads the real source of PregãoDashboard.tsx and
//      DashboardShell.tsx and asserts the exact lines that cause the bug
//      are still there today — so this test fails loudly (not silently
//      goes stale) if someone changes that code without updating this
//      test.
//   2. [BEHAVIORAL] Faithfully reproduces — same shape, same calls, no
//      logic changes — the interval start/stop mechanism from those exact
//      lines, using real timers (no mocking), and proves that once the
//      unmount-cleanup function runs, the cycle never fires again, no
//      matter how long you wait.
//
// Run directly with: npx tsx lib/security/ri-bank-8-stage2-cycle-unmount-bug.test.ts
//
// [RI-BANK-8 Estágio 5, Etapa 5.4] UPDATE: this file's [STRUCTURAL] block
// originally asserted that the buggy lines above were still present in
// PregãoDashboard.tsx (a "the bug still exists, don't let it drift"
// tripwire). RI-BANK-8 Estágio 5 (D4) removed the old mechanism
// (cicloRef/alternarCiclo/cleanup) from PregãoDashboard.tsx entirely and by
// design, with no transition period — so that assertion now fails
// permanently, not because of drift but because the bug this test
// documents has been fixed at the source. This was not explicitly called
// out in the Stage 5 design investigation's D6 plan (which only mentioned
// updating the Stage 4 test in Etapa 5.1); flagging that gap here rather
// than silently deleting or skipping this test. The [BEHAVIORAL] section
// below is untouched — it's a self-contained simulation of the old shape,
// not a read of the live file, and remains valid documentation of the bug
// RI-BANK-8 fixed. The [STRUCTURAL] block is updated below to assert the
// fix (mechanism gone) instead of the bug (mechanism present), so this file
// keeps being a live tripwire instead of a permanently-red historical
// artifact.

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── [BEHAVIORAL] Faithful reproduction of the real mechanism ───────────────
// Source of truth (do not let this drift from the real file without
// updating the STRUCTURAL assertions below too):
//   app/components/PregãoDashboard.tsx
//     - cicloRef declaration:                        line 65
//     - cicloAtivo state:                             line 66
//     - alternarCiclo "start" branch sets the ref:     line 367
//         cicloRef.current = setInterval(runCycle, cicloIntervalo * 1000)
//     - unmount cleanup effect (lines 471-482):
//         useEffect(() => { return () => {
//           if (cicloRef.current) { clearInterval(cicloRef.current); cicloRef.current = null }
//           ...
//         } }, [])
//
// This function models exactly that shape: a mutable ref-like object
// holding the interval handle, a start() equivalent to alternarCiclo's
// "start" branch, and an unmountCleanup() that is IDENTICAL in behavior
// to PregãoDashboard's real cleanup effect — it clears the interval
// unconditionally, regardless of whether the user ever clicked "Parar".
function createPregãoCicloSimulation(cicloIntervaloMs: number, onCycle: () => void) {
  const cicloRef: { current: ReturnType<typeof setInterval> | null } = { current: null }
  let cicloAtivo = false

  // Mirrors PregãoDashboard.tsx:323 + 367 (the relevant subset of the
  // "start" branch of alternarCiclo — the rest of that branch is
  // side-effecting calls into other modules, irrelevant to the
  // mount/unmount mechanism itself, already covered structurally by
  // RI-BANK-8 Stage 1 D1).
  function start() {
    if (cicloAtivo) return
    cicloAtivo = true
    cicloRef.current = setInterval(onCycle, cicloIntervaloMs)
  }

  // Mirrors PregãoDashboard.tsx:304-309 (the "stop" branch of
  // alternarCiclo, i.e. what happens if the user actually clicks "Parar").
  function stop() {
    if (cicloRef.current) {
      clearInterval(cicloRef.current)
      cicloRef.current = null
    }
    cicloAtivo = false
  }

  // Mirrors PregãoDashboard.tsx:471-482 exactly — this is what React
  // calls automatically when the component unmounts, unconditionally,
  // with no check on cicloAtivo and no way for the user to opt out.
  function unmountCleanup() {
    if (cicloRef.current) {
      clearInterval(cicloRef.current)
      cicloRef.current = null
    }
  }

  return { start, stop, unmountCleanup, isAtivo: () => cicloAtivo }
}

export async function runRiBank8Stage2CycleUnmountBugTest(): Promise<void> {
  // ================================================================
  // [STRUCTURAL] Post-Estágio-5: the bug-causing mechanism has been
  // removed from production code by design (D4, no transition period).
  // This block now asserts the fix instead of the bug — if it fails, the
  // old mechanism regressed back into PregãoDashboard.tsx.
  // ================================================================
  {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const repoRoot = join(__dirname, "..", "..")

    const dashboardSrc = readFileSync(join(repoRoot, "app", "components", "PregãoDashboard.tsx"), "utf-8")
    expect(
      !dashboardSrc.includes("cicloRef.current = setInterval(runCycle"),
      "PregãoDashboard.tsx must NOT start the cycle via cicloRef.current = setInterval(...) anymore — RI-BANK-8 Estágio 5 (D4) removed this mechanism by design"
    )
    expect(
      dashboardSrc.includes("pregãoEngine"),
      "PregãoDashboard.tsx must reference pregãoEngine — RI-BANK-8 Estágio 5 migrated the cycle onto lib/pregão-engine.ts"
    )

    const shellSrc = readFileSync(join(repoRoot, "app", "components", "DashboardShell.tsx"), "utf-8")
    expect(
      shellSrc.includes('{section === "overview" && <ClientOverview'),
      'DashboardShell.tsx must still render a self-contained ClientOverview (not {children}) for the "overview" section — RI-UX-2 Stage 1 D1'
    )
    expect(
      !/\{section === "overview"[^}]*\{children\}/.test(shellSrc),
      'DashboardShell.tsx must still NOT render {children} inside the "overview" branch — this is the structural reason PregãoDashboard (and therefore the cycle) is absent from Overview today'
    )
  }
  console.log("[STRUCTURAL] confirmado: o mecanismo antigo foi removido de PregãoDashboard.tsx (RI-BANK-8 Estágio 5, D4) e DashboardShell.tsx mantém a estrutura que motivou o achado do RI-UX-2 Estágio 1.")

  // ================================================================
  // [BEHAVIORAL] The mechanism itself: cycle fires while "mounted",
  // stops forever once the unmount cleanup runs — even without the
  // user ever clicking "Parar".
  // ================================================================
  const CYCLE_MS = 30
  let cycleCount = 0
  const sim = createPregãoCicloSimulation(CYCLE_MS, () => { cycleCount++ })

  // Passo 1 — inicia o ciclo, equivalente a clicar "Iniciar Pregueiros".
  sim.start()
  expect(sim.isAtivo(), "ciclo deveria estar ativo logo após start()")
  await sleep(CYCLE_MS * 3.5)
  const countBeforeUnmount = cycleCount
  expect(
    countBeforeUnmount >= 2,
    `esperava pelo menos 2 disparos do ciclo antes do unmount (${CYCLE_MS * 3.5}ms de espera, intervalo de ${CYCLE_MS}ms), teve ${countBeforeUnmount} — ambiente de teste pode estar sob carga incomum, considere aumentar CYCLE_MS`
  )
  console.log(`[BEHAVIORAL] ciclo disparou ${countBeforeUnmount}x normalmente enquanto "montado".`)

  // Passo 2 — simula exatamente o que o React faz ao desmontar
  // PregãoDashboard: troca de aba para Overview/Decisions/Proofs/Agents/
  // Architecture, ou mesmo entre Operator↔Ledger↔Debug (RI-BANK-8 Stage 1
  // achado principal: são branches JSX estruturalmente distintos, cada
  // troca desmonta e remonta). Deliberadamente NÃO chama sim.stop() — o
  // usuário não clicou em "Parar", só saiu da aba.
  sim.unmountCleanup()
  const countRightAfterUnmount = cycleCount

  // Passo 3 — espera bem mais que o intervalo do ciclo e confirma que
  // NENHUM ciclo novo disparou. Esta é a prova automatizada do bug.
  await sleep(CYCLE_MS * 6)
  const countLongAfterUnmount = cycleCount

  expect(
    countLongAfterUnmount === countRightAfterUnmount,
    `BUG NÃO REPRODUZIDO (isso seria uma notícia boa para o produto, mas ruim para este teste): esperava que o ciclo parasse imediatamente após o unmount (contagem estável em ${countRightAfterUnmount}), mas continuou disparando (chegou a ${countLongAfterUnmount}) — o mecanismo simulado não reflete o comportamento real relatado no RI-UX-2. Revisar a simulação contra o código-fonte atual antes de confiar neste teste.`
  )
  console.log(
    `✅ [RI-BANK-8 Stage 2] Bug confirmado com evidência automatizada: ciclo disparou ${countBeforeUnmount}x antes do "unmount", 0x depois — mesmo esperando ${CYCLE_MS * 6}ms (${(CYCLE_MS * 6 / CYCLE_MS).toFixed(0)}x o intervalo do ciclo). O unmount NÃO passou por sim.stop(): nenhuma ação do usuário foi simulada, só a troca de aba.`
  )
  console.log("ALL_RI_BANK_8_STAGE_2_CYCLE_UNMOUNT_BUG_ASSERTIONS_PASSED=YES")
}

runRiBank8Stage2CycleUnmountBugTest().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
