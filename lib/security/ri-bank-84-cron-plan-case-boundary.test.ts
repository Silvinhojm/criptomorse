// RI-BANK-84 — RI-BANK-83 corrigiu o ponto errado: `savePlan()` sempre
// chama normalizePlanInput() (lib/cron-trading-state.ts), que uppercasea
// fromToken/toToken incondicionalmente para TODO cron-plan -- um
// invariante da camada de persistência, não uma escolha de nenhuma rota.
// Confirmado empiricamente: uma nova decisão do Bandit pós-RI-BANK-83
// ainda produziu `fromToken: "CIRBTC"` no plano persistido, com o mesmo
// materialFingerprint de antes da "correção".
//
// Este teste reproduz o ciclo real: salvar um plano com fromToken:
// "cirBTC" via savePlan() (que sempre uppercasea), ler de volta, e
// confirmar que a resolução usada por executeCronPlanWithKms()
// (resolveConfiguredTokenSymbol(), lib/real-swap-executor.ts) recupera a
// grafia nativa correta -- alimentando TOKEN_DECIMALS/COIN_IDS com o
// valor certo, não o fallback. Confirma também que o caminho do
// navegador (Pregão, mixed-case nativo) nunca passa por essa
// normalização e continua intocado.

import {
  MemoryCronTradingStateStore,
  type CronTradingPlanInput,
} from "../cron-trading-state"
import {
  NETWORKS,
  TOKEN_DECIMALS,
  TRADING_PAIRS,
  resolveConfiguredTokenSymbol,
} from "../real-swap-executor"
import { COIN_IDS } from "../coin-ids"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function testSavePlanAlwaysUppercasesRegardlessOfInputCase(): Promise<void> {
  const store = new MemoryCronTradingStateStore()
  const input: CronTradingPlanInput = {
    id: "cron-plan-arc-bandit-cirbtc-usdc-test",
    network: "arc",
    fromToken: "cirBTC", // grafia nativa, exatamente como ARC_BANDIT_PAIRS/TRADING_PAIRS usam
    toToken: "USDC",
    strategy: "bandit-decision",
    riskBox: "A",
    amountUsd: 0.10,
  }
  const saved = await store.savePlan(input)
  expect(saved.fromToken === "CIRBTC", `expected savePlan() to always uppercase (this is the real, unavoidable invariant), got fromToken=${saved.fromToken}`)

  const reloaded = await store.getPlan()
  expect(reloaded!.fromToken === "CIRBTC", "expected the reloaded plan to still show the uppercased form")
  console.log("RI_BANK_84_SAVE_PLAN_ALWAYS_UPPERCASES=PASS")
}

function testExecutionBoundaryResolvesUppercasedPlanToNativeCasing(): void {
  const tokens = NETWORKS.arc.tokens as Record<string, string>

  // Exatamente o que executeCronPlanWithKms() faz agora com plan.fromToken
  // (sempre "CIRBTC", por causa de normalizePlanInput()).
  const resolvedFrom = resolveConfiguredTokenSymbol(tokens, "CIRBTC")
  const resolvedTo = resolveConfiguredTokenSymbol(tokens, "USDC")

  expect(resolvedFrom === "cirBTC", `expected "CIRBTC" to resolve to the native casing "cirBTC", got ${resolvedFrom}`)
  expect(resolvedTo === "USDC", `expected "USDC" to resolve to itself, got ${resolvedTo}`)

  // O ponto central: alimentar TOKEN_DECIMALS/COIN_IDS com a grafia
  // RESOLVIDA (não a bruta "CIRBTC") dá o valor real, não o fallback.
  expect(TOKEN_DECIMALS[resolvedFrom!] === 8, `expected TOKEN_DECIMALS['${resolvedFrom}'] === 8 (real cirBTC decimals), got ${TOKEN_DECIMALS[resolvedFrom!]}`)
  expect(TOKEN_DECIMALS["CIRBTC"] === undefined, "expected TOKEN_DECIMALS to have no entry for the raw uppercased form -- confirms the resolution step is load-bearing, not redundant")
  expect(COIN_IDS[resolvedFrom!] !== undefined, `expected COIN_IDS['${resolvedFrom}'] to exist`)
  expect(COIN_IDS["CIRBTC"] === undefined, "expected COIN_IDS to have no entry for the raw uppercased form either")

  console.log(`RI_BANK_84_EXECUTION_BOUNDARY_RESOLVES_TO_NATIVE_CASING=PASS (CIRBTC -> ${resolvedFrom}, decimals=${TOKEN_DECIMALS[resolvedFrom!]})`)
}

async function testFullCycleSavePlanThenResolveMatchesRealExecutionPath(): Promise<void> {
  // Ciclo completo pedido pelo ticket: savePlan() -> leitura -> resolução
  // no caminho de execução, tudo encadeado.
  const store = new MemoryCronTradingStateStore()
  await store.savePlan({
    id: "cron-plan-arc-bandit-cirbtc-usdc-test-2",
    network: "arc",
    fromToken: "cirBTC",
    toToken: "USDC",
    strategy: "bandit-decision",
    riskBox: "A",
    amountUsd: 0.10,
  })
  const plan = await store.getPlan()
  expect(!!plan, "expected a plan to be persisted")

  const tokens = NETWORKS.arc.tokens as Record<string, string>
  const resolvedFrom = resolveConfiguredTokenSymbol(tokens, plan!.fromToken)
  const resolvedTo = resolveConfiguredTokenSymbol(tokens, plan!.toToken)

  expect(!!resolvedFrom && !!resolvedTo, `expected the persisted plan's tokens to resolve successfully -- this is the exact bug from RI-BANK-82: got fromToken=${resolvedFrom}, toToken=${resolvedTo}`)
  expect(tokens[resolvedFrom!] === NETWORKS.arc.tokens.cirBTC, "expected the resolved address to match the real configured cirBTC address")

  console.log(`RI_BANK_84_FULL_CYCLE_SAVE_READ_RESOLVE=PASS (address=${tokens[resolvedFrom!]})`)
}

// ── Confirma que o caminho do navegador (Pregão), que usa "cirBTC" nativo
// diretamente em TRADING_PAIRS e nunca passa por normalizePlanInput(),
// continua funcionando sem nenhuma mudança -- nada neste ticket tocou em
// TRADING_PAIRS/NETWORKS.tokens/TOKEN_DECIMALS/COIN_IDS. ──────────────────
function testBrowserPathUnaffected(): void {
  const arcPairs = TRADING_PAIRS.arc
  const cirbtcPair = arcPairs.find(p => p.from === "cirBTC" && p.to === "USDC")
  expect(!!cirbtcPair, "expected TRADING_PAIRS.arc to still contain the native 'cirBTC' (mixed-case) pair, untouched")
  expect(cirbtcPair!.label === "cirBTC→USDC", `expected the label to keep its native casing, got ${cirbtcPair!.label}`)

  // O caminho do navegador chamaria isStable("cirBTC")/TOKEN_DECIMALS["cirBTC"]
  // diretamente, sem passar por resolveConfiguredTokenSymbol() -- confirma
  // que isso continua funcionando exatamente como antes.
  expect(TOKEN_DECIMALS["cirBTC"] === 8, "expected the native mixed-case lookup to keep working directly, unresolved")
  console.log("RI_BANK_84_BROWSER_PREGAO_PATH_UNAFFECTED=PASS")
}

async function run(): Promise<void> {
  await testSavePlanAlwaysUppercasesRegardlessOfInputCase()
  testExecutionBoundaryResolvesUppercasedPlanToNativeCasing()
  await testFullCycleSavePlanThenResolveMatchesRealExecutionPath()
  testBrowserPathUnaffected()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
