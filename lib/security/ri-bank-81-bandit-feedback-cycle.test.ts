// RI-BANK-81 — ciclo completo: uma execução "bandit-decision" bem-sucedida
// flui por CronTradingService -> CronExecutionResult.banditProfitUsd ->
// recordBanditResult() -> bandit:state (via Redis falso em memória, mesmo
// padrão já usado em RI-BANK-76/79). Confirma também que planos
// manual-validated NUNCA disparam essa realimentação, mesmo com sucesso.
//
// Nenhuma rede real, nenhuma transação real -- CronTradingService e
// signAndExecute são inteiramente mockados (mesmo padrão de
// ri-bank-34-cron-trading.test.ts); só a ponta bandit-state-redis.ts usa
// sua implementação real, contra um Redis falso em memória.

import { CronTradingService, type CronExecutionResult } from "../cron-trading-service"
import type { CronTradingPlan, CronTradingStateStore, CronRouteAuthorization } from "../cron-trading-state"
import {
  ARC_BANDIT_PAIRS,
  readBanditState,
  recordBanditResult,
  ENSURE_BANDIT_STATE_SCRIPT,
  RECORD_BANDIT_RESULT_SCRIPT,
  APPLY_BANDIT_RECALC_SCRIPT,
  type BanditRedisClient,
} from "../bandit-state-redis"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function expectClose(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  expect(Math.abs(actual - expected) < epsilon, `${message} (actual=${actual}, expected=${expected})`)
}

// Mesmo Redis falso em memória já usado em RI-BANK-76/77/79.
class FakeBanditRedis implements BanditRedisClient {
  private hashes = new Map<string, Record<string, string>>()

  async hgetall<TData extends Record<string, unknown>>(key: string): Promise<TData | null> {
    const hash = this.hashes.get(key)
    return (hash ? { ...hash } : null) as TData | null
  }

  async eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData> {
    const key = keys[0]
    const values = (args as unknown[]).map(String)

    if (script === ENSURE_BANDIT_STATE_SCRIPT) {
      const hash = this.hashes.get(key) ?? {}
      if (hash.totalTrades === undefined) hash.totalTrades = "0"
      if (hash.tradeAmount === undefined) hash.tradeAmount = values[0]
      if (hash.version === undefined) hash.version = "0"
      if (hash.environment === undefined) hash.environment = values[2]
      const numPairs = Number(values[1])
      const initialWeight = String(1 / numPairs)
      for (let i = 3; i < values.length; i += 3) {
        const pair = values[i], fromToken = values[i + 1], toToken = values[i + 2]
        if (hash[`pair:${pair}:fromToken`] === undefined) hash[`pair:${pair}:fromToken`] = fromToken
        if (hash[`pair:${pair}:toToken`] === undefined) hash[`pair:${pair}:toToken`] = toToken
        if (hash[`pair:${pair}:profit`] === undefined) hash[`pair:${pair}:profit`] = "0"
        if (hash[`pair:${pair}:trades`] === undefined) hash[`pair:${pair}:trades`] = "0"
        if (hash[`pair:${pair}:weight`] === undefined) hash[`pair:${pair}:weight`] = initialWeight
      }
      this.hashes.set(key, hash)
      return 1 as TData
    }
    if (script === RECORD_BANDIT_RESULT_SCRIPT) {
      const hash = this.hashes.get(key)!
      const pair = values[0], profitDelta = Number(values[1])
      hash[`pair:${pair}:profit`] = String(Number(hash[`pair:${pair}:profit`] ?? 0) + profitDelta)
      hash[`pair:${pair}:trades`] = String(Number(hash[`pair:${pair}:trades`] ?? 0) + 1)
      hash.totalTrades = String(Number(hash.totalTrades ?? 0) + 1)
      hash.version = String(Number(hash.version ?? 0) + 1)
      return Number(hash.totalTrades) as TData
    }
    if (script === APPLY_BANDIT_RECALC_SCRIPT) {
      const hash = this.hashes.get(key)!
      const expectedVersion = values[0]
      const currentVersion = hash.version ?? "0"
      if (currentVersion !== expectedVersion) return 0 as TData
      for (let i = 1; i < values.length; i += 2) hash[values[i]] = values[i + 1]
      hash.version = String(Number(hash.version) + 1)
      return 1 as TData
    }
    throw new Error("unrecognized script")
  }
}

// Store mínimo, mesmo padrão de mock já usado em ri-bank-34-cron-trading.test.ts:
// só o suficiente para deixar o service percorrer o caminho feliz até a execução.
function makeMockStore(plan: CronTradingPlan): CronTradingStateStore {
  let status = plan.status
  return {
    async getKillSwitch() { return false },
    async getMainnetConfirmed() { return false },
    async setMainnetConfirmed() {},
    async getPlan() { return { ...plan, status } },
    async savePlan() { throw new Error("not used in this test") },
    async authorizeCurrentRoute() { throw new Error("not used in this test") },
    async isRouteAuthorized() { return true },
    async claimPlan(planId, owner) {
      if (planId !== plan.id) return null
      status = "processing"
      return { ...plan, status: "processing", leaseOwner: owner }
    },
    async transitionPlan(_planId, _owner, newStatus) {
      status = newStatus
      return true
    },
    async appendAudit(event) { return { ...event, id: "test-audit-id" } },
  } as unknown as CronTradingStateStore
}

function makePlan(overrides: Partial<CronTradingPlan> = {}): CronTradingPlan {
  return {
    id: "cron-plan-arc-bandit-usdc-eurc",
    network: "arc",
    fromToken: "USDC",
    toToken: "EURC",
    strategy: "bandit-decision",
    riskBox: "A",
    amountUsd: 0.10,
    status: "ready",
    materialFingerprint: "test-fingerprint",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    ...overrides,
  } as CronTradingPlan
}

async function testBanditDecisionExecutionFeedsBackIntoState(): Promise<void> {
  const redis = new FakeBanditRedis()
  const key = "test:bandit:cycle:bandit-decision"
  const plan = makePlan()
  const store = makeMockStore(plan)

  const execution: CronExecutionResult = {
    success: true,
    txHash: "0xfeedbeef",
    // Lucro já calculado com câmbio externo (simulado aqui -- o cálculo em
    // si é testado isoladamente em ri-bank-81-external-forex-profit.test.ts).
    banditProfitUsd: 0.0034,
    banditPriceSource: "test-fixture",
    banditEnvironment: "testnet",
  }

  let recordedPair: string | undefined
  let recordedProfit: number | undefined
  const service = new CronTradingService({
    store,
    isMainnet: () => false,
    blockIfPanickedFresh: async () => false,
    refreshBudget: async () => {},
    isBudgetExceeded: () => false,
    authorizeRiskBox: async () => ({ allowed: true, reason: "ok" }),
    signAndExecute: async () => execution,
    async recordBanditResult(pairLabel, profitUsd) {
      recordedPair = pairLabel
      recordedProfit = profitUsd
      await recordBanditResult(redis, key, pairLabel, profitUsd, ARC_BANDIT_PAIRS)
    },
  })

  const result = await service.runOnce()
  expect(result.executed === true, `expected the run to execute, got: ${JSON.stringify(result)}`)
  expect(recordedPair === "USDC→EURC", `expected recordBanditResult to be called with USDC→EURC, got ${recordedPair}`)
  expect(recordedProfit === 0.0034, `expected recordBanditResult to receive the computed profit, got ${recordedProfit}`)

  const state = await readBanditState(redis, key, ARC_BANDIT_PAIRS)
  const pair = state.pairs.find(p => p.pair === "USDC→EURC")!
  expect(state.totalTrades === 1, `expected totalTrades=1 after one recorded result, got ${state.totalTrades}`)
  expect(pair.trades === 1, `expected USDC→EURC trades=1, got ${pair.trades}`)
  expectClose(pair.profit, 0.0034, "expected USDC→EURC profit to reflect the real computed value")
  expect(state.environment === "testnet", `expected environment=testnet preserved in persisted state, got ${state.environment}`)

  console.log(`RI_BANK_81_BANDIT_DECISION_EXECUTION_UPDATES_STATE=PASS (profit=${pair.profit}, trades=${pair.trades})`)
}

async function testManualPlanNeverFeedsBackIntoBanditState(): Promise<void> {
  const redis = new FakeBanditRedis()
  const key = "test:bandit:cycle:manual"
  // Mesmo par/valor de um plano manual -- só a strategy muda.
  const plan = makePlan({ id: "cron-plan-arc-usdc-eurc-manual-validated", strategy: "manual-validated" })
  const store = makeMockStore(plan)

  const execution: CronExecutionResult = {
    success: true,
    txHash: "0xdeadbeef",
    // Mesmo que a execução real (real-swap-executor.ts) sempre calcule um
    // result.profit próprio, executeCronPlanWithKms() só preenche
    // banditProfitUsd quando strategy === "bandit-decision" -- então isso
    // aqui não deveria acontecer na prática, mas o teste confirma que,
    // MESMO SE presente, recordBanditResult nunca é chamado para planos
    // manuais.
    banditProfitUsd: 999,
    banditPriceSource: "should-never-be-used",
    banditEnvironment: "testnet",
  }

  let called = false
  const service = new CronTradingService({
    store,
    isMainnet: () => false,
    blockIfPanickedFresh: async () => false,
    refreshBudget: async () => {},
    isBudgetExceeded: () => false,
    authorizeRiskBox: async () => ({ allowed: true, reason: "ok" }),
    signAndExecute: async () => execution,
    async recordBanditResult() {
      called = true
    },
  })

  const result = await service.runOnce()
  expect(result.executed === true, "expected the manual plan run to execute normally")
  expect(!called, "recordBanditResult must NEVER be called for a manual-validated plan, even if banditProfitUsd happens to be present")

  const state = await readBanditState(redis, key, ARC_BANDIT_PAIRS)
  expect(state.totalTrades === 0, "bandit:state must remain untouched for a manual plan execution")

  console.log("RI_BANK_81_MANUAL_PLAN_NEVER_FEEDS_BACK=PASS")
}

async function testMissingProfitDoesNotCallRecordResult(): Promise<void> {
  const redis = new FakeBanditRedis()
  const key = "test:bandit:cycle:no-profit"
  const plan = makePlan()
  const store = makeMockStore(plan)

  // Simula o caso real onde computeSwapProfitUsd() falhou (ex: câmbio
  // externo fora do ar) -- executeCronPlanWithKms() deixa banditProfitUsd
  // undefined em vez de fabricar um valor.
  const execution: CronExecutionResult = { success: true, txHash: "0xabc123" }

  let called = false
  const service = new CronTradingService({
    store,
    isMainnet: () => false,
    blockIfPanickedFresh: async () => false,
    refreshBudget: async () => {},
    isBudgetExceeded: () => false,
    authorizeRiskBox: async () => ({ allowed: true, reason: "ok" }),
    signAndExecute: async () => execution,
    async recordBanditResult() {
      called = true
    },
  })

  const result = await service.runOnce()
  expect(result.executed === true, "expected the run to execute even without a computed profit")
  expect(!called, "recordBanditResult must not be called when banditProfitUsd is undefined -- never fabricate a value")

  const state = await readBanditState(redis, key, ARC_BANDIT_PAIRS)
  expect(state.totalTrades === 0, "bandit:state must remain untouched when profit could not be computed")

  console.log("RI_BANK_81_MISSING_PROFIT_SKIPS_RECORD=PASS")
}

async function run(): Promise<void> {
  await testBanditDecisionExecutionFeedsBackIntoState()
  await testManualPlanNeverFeedsBackIntoBanditState()
  await testMissingProfitDoesNotCallRecordResult()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
