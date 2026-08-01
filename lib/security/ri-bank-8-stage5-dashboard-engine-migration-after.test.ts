// RI-BANK-8 Estágio 5 — ri-bank-8-stage5-dashboard-engine-migration-after.test.ts
//
// [STRUCTURAL] "depois" test do plano D5/D6 da investigação de design do
// Estágio 5 (RI-BANK-8-STAGE-5-DESIGN-INVESTIGATION). Confirma, lendo o
// código-fonte real de PregãoDashboard.tsx (sem renderer — mesma técnica já
// usada em ri-bank-8-stage2-cycle-unmount-bug.test.ts e
// ri-bank-8-stage4-cycle-engine-fix-after.test.ts), que a migração completa
// da Etapa 5.2 aconteceu como o D1/D2/D4 descreveram:
//
//   1. O componente importa pregãoEngine de @/lib/pregão-engine.
//   2. O mecanismo antigo (cicloRef, setInterval(runCycle, o bloco de
//      cleanup antigo) foi removido por inteiro — sem período de
//      convivência com o motor novo (D4).
//   3. A assinatura pregãoEngine.onLog(addLog) está presente — sem ela, as
//      mensagens que o motor gera nunca apareceriam no painel de log da UI
//      (D1, item sinalizado como "fácil de esquecer").
//   4. Existe alguma referência a mainnet_confirmation_required — prova de
//      que o fluxo de confirmação de mainnet do D2 foi implementado, não
//      só o start() cru chamado sem tratamento do resultado.
//
// Não substitui a Parte 2 (verificação ao vivo no navegador, Etapa 5.5) —
// esta é só a evidência estrutural, reproduzível em CI sem um browser.
//
// Run directly with: npx tsx lib/security/ri-bank-8-stage5-dashboard-engine-migration-after.test.ts

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export async function runRiBank8Stage5DashboardEngineMigrationAfterTest(): Promise<void> {
  const { readFileSync, existsSync } = await import("node:fs")
  const { join } = await import("node:path")
  const repoRoot = join(__dirname, "..", "..")

  const enginePath = join(repoRoot, "lib", "pregão-engine.ts")
  expect(existsSync(enginePath), "lib/pregão-engine.ts deve existir (criado no RI-BANK-8 Estágio 3)")

  const dashboardSrc = readFileSync(join(repoRoot, "app", "components", "PregãoDashboard.tsx"), "utf-8")

  // 1. Importa o motor.
  expect(
    /from ["']@\/lib\/pregão-engine["']/.test(dashboardSrc) && dashboardSrc.includes("pregãoEngine"),
    "PregãoDashboard.tsx deve importar pregãoEngine de @/lib/pregão-engine"
  )
  console.log("[STRUCTURAL] 1/4: PregãoDashboard.tsx importa pregãoEngine de @/lib/pregão-engine.")

  // 2. Mecanismo antigo removido por inteiro (D4) — nenhuma convivência.
  expect(
    !dashboardSrc.includes("cicloRef"),
    "PregãoDashboard.tsx NÃO deve mais conter cicloRef — mecanismo antigo removido por inteiro no Estágio 5 (D4)"
  )
  expect(
    !dashboardSrc.includes("setInterval(runCycle"),
    "PregãoDashboard.tsx NÃO deve mais conter setInterval(runCycle — o próprio ciclo agora pertence só ao motor"
  )
  expect(
    !dashboardSrc.includes("alternarCiclo"),
    "PregãoDashboard.tsx NÃO deve mais conter alternarCiclo — substituída por wrappers finos sobre pregãoEngine (D2)"
  )
  console.log("[STRUCTURAL] 2/4: mecanismo antigo (cicloRef/setInterval(runCycle/alternarCiclo) removido por inteiro, sem período de convivência.")

  // 3. Assinatura onLog do motor presente (D1, item sinalizado como fácil de esquecer).
  expect(
    /pregãoEngine\.onLog\(addLog\)/.test(dashboardSrc),
    "PregãoDashboard.tsx deve assinar pregãoEngine.onLog(addLog) — sem isso, as mensagens do motor não apareceriam no painel de log da UI"
  )
  console.log("[STRUCTURAL] 3/4: assinatura pregãoEngine.onLog(addLog) presente.")

  // 4. Fluxo de confirmação de mainnet (D2) implementado, não só start() cru.
  expect(
    dashboardSrc.includes("mainnet_confirmation_required"),
    "PregãoDashboard.tsx deve tratar o reason mainnet_confirmation_required — prova de que o fluxo de confirmação do D2 foi implementado"
  )
  expect(
    /confirmMainnet:\s*true/.test(dashboardSrc),
    "PregãoDashboard.tsx deve chamar pregãoEngine.start({ confirmMainnet: true }) em algum ponto — o clique de confirmação real do painel D2"
  )
  console.log("[STRUCTURAL] 4/4: fluxo de confirmação de mainnet (D2) implementado — reason tratado e confirmMainnet: true chamado a partir do painel de confirmação.")

  console.log("ALL_RI_BANK_8_STAGE_5_DASHBOARD_ENGINE_MIGRATION_AFTER_ASSERTIONS_PASSED=YES")
}

runRiBank8Stage5DashboardEngineMigrationAfterTest().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
