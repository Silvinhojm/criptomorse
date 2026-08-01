// RI-BANK-8 Stage 4 — ri-bank-8-stage4-cycle-engine-fix-after.test.ts
//
// The "fix-depois" half of the pair that started with
// ri-bank-8-stage2-cycle-unmount-bug.test.ts. Stage 2 proved the OLD
// mechanism (cicloRef/setInterval + unconditional unmount cleanup) stops
// firing forever once "unmounted". This test proves the NEW mechanism
// (lib/pregão-engine.ts, created in RI-BANK-8 Stage 3) does not have that
// problem: once started, directly, with no React component involved at
// all, it keeps firing indefinitely — there is nothing to unmount, which
// is exactly the fix.
//
// SCOPE: this test only imports lib/pregão-engine.ts. It does not import,
// render, or otherwise touch PregãoDashboard.tsx or DashboardShell.tsx —
// confirmed below with the same [STRUCTURAL] technique Stage 2 used.
//
// [RI-BANK-8 Estágio 5, Etapa 5.1] UPDATE: this structural block originally
// asserted the PRE-migration state (PregãoDashboard.tsx still on
// cicloRef/setInterval, no reference to pregão-engine at all) — exactly the
// "antes" half of Stage 5's D5 test plan. Now that Stage 5's migration
// (Etapa 5.2) has happened, this checkpoint is inverted to assert the
// AFTER state instead, so this file keeps proving what it always proved
// (that PregãoDashboard.tsx and the engine agree on which mechanism owns
// the cycle) without going stale. The dedicated, more complete "depois"
// structural test lives in
// ri-bank-8-stage5-dashboard-engine-migration-after.test.ts (Etapa 5.3).
//
// SAFETY — no real transaction, not even on testnet:
// pregãoEngine.start() is called against the real "arc" (Arc Testnet)
// network key on purpose (not a fake key) — pregao-arc.ts's own
// ARC_PAIRS is hardcoded from TRADING_PAIRS.arc regardless of which
// network string the engine is told about, so a fake key would not have
// avoided that code path anyway, and "arc" is the network this whole
// track's other real-Redis-backed tests already run against safely. No
// wallet is connected in this bare Node process (no PRIVATE_KEY, no
// browser signer) — every real-swap balance read
// (real-swap-executor.ts:697-699, `this.tokenBalances.get(token)?.balance
// ?? 0`) resolves to 0, which every downstream trading path (verified by
// reading pregueiro.ts, agentes-do-pregão.ts, pregao-arc.ts before writing
// this test) treats as "insufficient balance, skip" — the same
// no-wallet-means-no-real-action property this repository's other tests
// already rely on. Nothing here submits a swap, a bridge, or a signed
// transaction of any kind.
//
// [FINDING, not previously documented] isPaperMode()/setPaperMode()
// (lib/agentes-do-pregão.ts) turned out, on inspection, to be UI-display
// only — grepped every call site and the only consumers are
// PregãoDashboard.tsx's own toggle button styling. Nothing in
// executarCicloPregueiros, executarCicloAgentes, professor.ts, or
// pregao-arc.ts reads it. RI-BANK-8 Stage 1's D6 assumed paper mode could
// be used to make a "fix-depois" test safe; that assumption does not
// hold. The real safety property this test relies on instead is the
// zero-wallet-balance one described above, not paper mode. Flagging this
// because it means "ativar paper mode" is not actually a safety
// guarantee anywhere in this codebase today — worth a decision on your
// side about whether that should be fixed (paper mode should probably
// gate real execution, not just UI color), separately from this mandate.
//
// Circuit breaker state IS touched for real (resumeFromPanic/
// setTestnetMode inside pregãoEngine's start() write to the real dev
// Redis circuit-breaker key, same key ri-bank-7's test uses) — backed up
// before and restored after, identical convention to
// ri-bank-7-panic-button-fix.test.ts.
//
// Run directly with: npx tsx --env-file=.env.local lib/security/ri-bank-8-stage4-cycle-engine-fix-after.test.ts

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(pollMs)
  }
  return predicate()
}

export async function runRiBank8Stage4FixAfterTest(): Promise<void> {
  // ================================================================
  // [STRUCTURAL] Confirms this test targets the engine, and that
  // PregãoDashboard.tsx has been migrated onto it (RI-BANK-8 Estágio 5,
  // Etapa 5.2) — the inverse of what this block asserted before Stage 5.
  // If this ever fails, it means the dashboard regressed back onto the
  // old cicloRef/setInterval mechanism, or lost the engine wiring.
  // ================================================================
  {
    const { readFileSync, existsSync } = await import("node:fs")
    const { join } = await import("node:path")
    const repoRoot = join(__dirname, "..", "..")

    const enginePath = join(repoRoot, "lib", "pregão-engine.ts")
    expect(existsSync(enginePath), "lib/pregão-engine.ts deve existir (criado no RI-BANK-8 Stage 3)")

    const dashboardSrc = readFileSync(join(repoRoot, "app", "components", "PregãoDashboard.tsx"), "utf-8")
    expect(
      dashboardSrc.includes("pregãoEngine"),
      "PregãoDashboard.tsx deveria importar/referenciar pregãoEngine (lib/pregão-engine.ts) — RI-BANK-8 Estágio 5 migrou o componente para o motor novo"
    )
    expect(
      !dashboardSrc.includes("cicloRef") && !dashboardSrc.includes("setInterval(runCycle"),
      "PregãoDashboard.tsx NÃO deveria mais conter cicloRef nem setInterval(runCycle — o mecanismo antigo foi removido por inteiro no Estágio 5 (D4), sem período de convivência com o motor novo"
    )
  }
  console.log("[STRUCTURAL] confirmado: PregãoDashboard.tsx foi migrado para pregão-engine.ts — mecanismo antigo (cicloRef/setInterval) removido por inteiro.")

  // ================================================================
  // Setup: backup do estado real do circuit breaker no Redis de dev
  // (mesma convenção do ri-bank-7-panic-button-fix.test.ts), porque
  // pregãoEngine.start() chama resumeFromPanic()/setTestnetMode() de
  // verdade.
  // ================================================================
  const { isKvConfigured, getRedis, circuitBreakerKvKey } = await import("../kv")
  const cbKey = circuitBreakerKvKey()
  const kvHadBefore = isKvConfigured() && (await getRedis().hlen(cbKey)) > 0
  const kvBackup = kvHadBefore ? await getRedis().hgetall<Record<string, unknown>>(cbKey) : null

  const { pregãoEngine } = await import("../pregão-engine")

  try {
    // ================================================================
    // [BEHAVIORAL] D6 passo 5 — start() direto, sem nenhum componente
    // React envolvido.
    // ================================================================
    // 150ms, não 30ms como no Stage 2: armar() de verdade faz I/O real
    // (resumeFromPanic/setTestnetMode contra o Redis de dev), então o
    // primeiro ciclo não dispara instantaneamente — medido empiricamente
    // abaixo via waitUntil() em vez de assumir um tempo fixo.
    const CYCLE_S = 0.15
    pregãoEngine.setRede("arc") // Arc Testnet real — ver nota de segurança no topo do arquivo
    pregãoEngine.setCicloIntervalo(CYCLE_S)

    const cycleTimestamps: number[] = []
    const unsubscribe = pregãoEngine.onChange(() => {
      const t = pregãoEngine.getState().ultimoCicloEm
      if (t !== null && cycleTimestamps[cycleTimestamps.length - 1] !== t) {
        cycleTimestamps.push(t)
      }
    })

    const startResult = pregãoEngine.start()
    expect(
      startResult.started === true,
      `start() deveria suceder (rede testnet, sem exigir confirmMainnet), retornou: ${JSON.stringify(startResult)}`
    )
    expect(pregãoEngine.getState().ativo === true, "getState().ativo deveria ser true imediatamente após start()")
    console.log("[BEHAVIORAL] D6 passo 5: pregãoEngine.start() chamado diretamente, sem nenhum componente React — sucedeu.")

    // ================================================================
    // D6 passo 6 — confirma que o ciclo dispara com temporizador real.
    // armar() faz I/O real (Redis) antes do primeiro ciclo, então
    // esperamos o primeiro disparo aparecer (com folga generosa de até
    // 10s) em vez de assumir um tempo fixo, e só então medimos a cadência
    // a partir dali.
    // ================================================================
    const gotFirstCycle = await waitUntil(() => cycleTimestamps.length >= 1, 10_000)
    expect(gotFirstCycle, `nenhum ciclo disparou em 10s após start() — armar() pode ter travado (checar log acima)`)
    const countAfterFirstCycle = cycleTimestamps.length

    const gotSecondBatch = await waitUntil(() => cycleTimestamps.length >= countAfterFirstCycle + 2, 5_000)
    const countAfterFirstWait = cycleTimestamps.length
    expect(
      gotSecondBatch,
      `esperava pelo menos mais 2 disparos do ciclo depois do primeiro (intervalo configurado de ${CYCLE_S * 1000}ms), teve ${countAfterFirstWait - countAfterFirstCycle} em 5s de espera adicional`
    )
    console.log(`[BEHAVIORAL] D6 passo 6: ciclo disparou ${countAfterFirstWait}x com temporizador real, confirmado.`)

    // ================================================================
    // D6 passo 7 — simula exatamente o que uma troca de aba faria hoje
    // com o motor novo: NADA. Não há nenhum componente montado para
    // desmontar, nenhum useEffect de cleanup ligado a este teste — essa
    // ausência total de qualquer ação é, literalmente, a simulação
    // correta de "trocar de aba", porque é exatamente isso que muda no
    // mundo real depois desta extração (RI-BANK-8 Stage 1 D2/D3).
    // ================================================================
    await sleep(CYCLE_S * 1000 * 4)
    const countAfterSimulatedTabSwitch = cycleTimestamps.length
    expect(
      countAfterSimulatedTabSwitch > countAfterFirstWait,
      `esperava que o ciclo continuasse disparando "sem nenhum componente montado" (simulação de troca de aba) — antes: ${countAfterFirstWait}, depois: ${countAfterSimulatedTabSwitch}`
    )
    expect(
      pregãoEngine.getState().ativo === true,
      "engine deveria continuar ativo — nada foi chamado para pará-lo, só se passou tempo"
    )
    console.log(`[BEHAVIORAL] D6 passo 7: "troca de aba" simulada (nenhuma ação tomada sobre o engine) — ciclo continuou disparando, foi de ${countAfterFirstWait}x para ${countAfterSimulatedTabSwitch}x. Este é o comportamento que Stage 2 provou estar QUEBRADO no mecanismo antigo.`)

    // ================================================================
    // D6 passo 8 — stop() explícito, respeitando o comportamento
    // não-instantâneo já documentado no Stage 3 (while/sleep, não
    // setInterval): getState().ativo vira false na hora (flag síncrona),
    // mas pode haver 1 ciclo "em voo" terminando antes do loop parar de
    // fato.
    // ================================================================
    pregãoEngine.stop()
    expect(
      pregãoEngine.getState().ativo === false,
      "getState().ativo deve virar false imediatamente após stop() — é uma atribuição síncrona no início de stop()"
    )
    const countRightAfterStop = cycleTimestamps.length

    // Folga generosa (2s, não múltiplos do intervalo de teste) porque um
    // ciclo "em voo" no momento do stop() faz I/O real e pode demorar
    // mais que CYCLE_S para terminar — o que importa é que só ESSE UM
    // ciclo (no máximo) ainda complete, não quanto tempo ele leva.
    await sleep(2_000)
    const countShortlyAfterStop = cycleTimestamps.length
    expect(
      countShortlyAfterStop - countRightAfterStop <= 1,
      `esperava no máximo +1 ciclo "em voo" depois do stop() (comportamento não-instantâneo documentado no RI-BANK-8 Stage 3), mas rodou +${countShortlyAfterStop - countRightAfterStop}`
    )

    await sleep(CYCLE_S * 1000 * 6)
    const countStableCheck = cycleTimestamps.length
    expect(
      countStableCheck === countShortlyAfterStop,
      `depois de estabilizar, o ciclo não deveria disparar mais nada — foi de ${countShortlyAfterStop} para ${countStableCheck}`
    )
    console.log(
      `[BEHAVIORAL] D6 passo 8: stop() explícito chamado. ativo virou false na hora; contagem de ciclos foi de ${countRightAfterStop} para ${countShortlyAfterStop} (no máx. +1, ciclo em voo) e depois estabilizou em ${countStableCheck} — motor realmente parou.`
    )

    unsubscribe()

    console.log("ALL_RI_BANK_8_STAGE_4_CYCLE_ENGINE_FIX_AFTER_ASSERTIONS_PASSED=YES")
  } finally {
    // Garantia extra: o engine não deve continuar ativo depois deste
    // teste, seja lá o que aconteceu.
    if (pregãoEngine.getState().ativo) pregãoEngine.stop()

    if (isKvConfigured()) {
      await getRedis().del(cbKey)
      if (kvBackup && Object.keys(kvBackup).length > 0) await getRedis().hset(cbKey, kvBackup)
    }
  }
}

runRiBank8Stage4FixAfterTest().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
