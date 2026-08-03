import { readFileSync } from "node:fs"
import { join } from "node:path"

import { JsonRpcProvider, type Transaction } from "ethers"

import { CronTradingService, type CronTradingDependencies } from "../cron-trading-service"
import { MemoryCronTradingStateStore, type CronTradingPlanInput } from "../cron-trading-state"
import { KmsEthersSigner } from "../kms/kms-ethers-signer"
import type { KmsEvmSigner } from "../kms/kms-evm-signer"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const arcPlan: CronTradingPlanInput = {
  id: "plan-ri-bank-34",
  network: "arc",
  fromToken: "USDC",
  toToken: "EURC",
  strategy: "stable-mean-reversion",
  riskBox: "A",
  amountUsd: 10,
}

interface FixtureOptions {
  network?: string
  killSwitch?: boolean
  panicked?: boolean
  mainnetConfirmed?: boolean
  authorizeRoute?: boolean
  budgetExceeded?: boolean
  riskAllowed?: boolean
  execute?: CronTradingDependencies["signAndExecute"]
}

async function fixture(options: FixtureOptions = {}) {
  const store = new MemoryCronTradingStateStore()
  const plan = await store.savePlan({ ...arcPlan, network: options.network ?? arcPlan.network }, 1)
  store.killSwitch = options.killSwitch ?? false
  store.mainnetConfirmed = options.mainnetConfirmed ?? false
  if (options.authorizeRoute !== false) await store.authorizeCurrentRoute(plan.id, "manual-order-dispatched-34", 2)
  const calls: string[] = []
  let executions = 0
  const service = new CronTradingService({
    store,
    isMainnet(network) { calls.push("mainnet"); return network !== "arc" },
    async blockIfPanickedFresh() { calls.push("circuit"); return options.panicked ?? false },
    async refreshBudget() { calls.push("budget-refresh") },
    isBudgetExceeded() { calls.push("budget-check"); return options.budgetExceeded ?? false },
    async authorizeRiskBox() {
      calls.push("risk-box")
      return options.riskAllowed === false
        ? { allowed: false, reason: "caixa_esgotada" }
        : { allowed: true, reason: "authorized" }
    },
    async signAndExecute(currentPlan) {
      executions++
      calls.push("sign")
      calls.push("executeSwap")
      return options.execute
        ? options.execute(currentPlan)
        : { success: true, txHash: "0xmock34" }
    },
    now: () => 34,
    invocationId: () => `invocation-${Math.random()}`,
  })
  return { store, service, calls, executions: () => executions }
}

async function assertBlocked(
  label: string,
  options: FixtureOptions,
  expectedReason: string,
): Promise<void> {
  const test = await fixture(options)
  const result = await test.service.runOnce()
  expect(!result.executed && result.mode === "mode_2", `${label}: must use Mode 2`)
  expect(result.reason === expectedReason, `${label}: unexpected reason ${result.reason}`)
  expect(test.executions() === 0, `${label}: executeSwap must not run`)
  expect(test.store.audits.some(event => event.reason === expectedReason), `${label}: audit missing`)
}

async function run(): Promise<void> {
  // The ethers adapter delegates an unsigned EIP-1559 transaction to the
  // unchanged KmsEvmSigner; neither provider nor AWS is contacted here.
  let delegatedTransaction: Transaction | null = null
  const fakeKms = {
    async getAddress() { return "0x88993E37Ed022C56F83f67C74d33C783E8e49C75" },
    async signTransaction(transaction: Transaction) {
      delegatedTransaction = transaction
      return "0xmock-signed-transaction"
    },
  } as unknown as KmsEvmSigner
  const offlineProvider = new JsonRpcProvider("http://127.0.0.1:1", 5042002, { staticNetwork: true })
  const ethersKms = new KmsEthersSigner(fakeKms, offlineProvider)
  const signed = await ethersKms.signTransaction({
    type: 2, chainId: 5042002, nonce: 1, gasLimit: 21_000,
    maxFeePerGas: 1, maxPriorityFeePerGas: 1,
    to: "0x88993E37Ed022C56F83f67C74d33C783E8e49C75", value: 0,
  })
  expect(signed === "0xmock-signed-transaction" && delegatedTransaction !== null, "ethers adapter did not delegate to KmsEvmSigner")

  // Complete Mode 1 reaches the signer and the existing executeSwap boundary.
  const success = await fixture()
  const successResult = await success.service.runOnce()
  expect(successResult.executed && successResult.mode === "mode_1", "Mode 1 must execute")
  expect(successResult.txHash === "0xmock34", "Mode 1 tx hash missing")
  expect(success.calls.includes("sign") && success.calls.includes("executeSwap"), "Mode 1 did not reach signer + executeSwap")
  expect(success.store.plan?.status === "completed", "Mode 1 plan must become completed")

  // Every Mode 2 condition is isolated and has a specific durable reason.
  await assertBlocked("kill switch", { killSwitch: true }, "cron_kill_switch_active")
  await assertBlocked("circuit breaker", { panicked: true }, "global_circuit_breaker_active")
  await assertBlocked("mainnet confirmation", { network: "polygon", mainnetConfirmed: false }, "cron_mainnet_not_confirmed")
  await assertBlocked("route authorization", { authorizeRoute: false }, "cron_route_not_authorized_or_materially_changed")
  await assertBlocked("budget", { budgetExceeded: true }, "trading_budget_exceeded")
  await assertBlocked("risk box", { riskAllowed: false }, "risk_box_blocked:caixa_esgotada")

  // A material plan change invalidates the permanent route authorization.
  const material = await fixture()
  await material.store.savePlan({ ...arcPlan, amountUsd: 11 }, 3)
  const materialResult = await material.service.runOnce()
  expect(materialResult.reason === "cron_route_not_authorized_or_materially_changed", "material change must require new manual dispatch")
  expect(material.executions() === 0, "materially changed route executed")

  // Even a same-id administrative replacement racing between authorization
  // and claim is detected from the claimed fingerprint.
  const claimRace = await fixture()
  const originalClaim = claimRace.store.claimPlan.bind(claimRace.store)
  claimRace.store.claimPlan = async (planId, owner, now) => {
    await claimRace.store.savePlan({ ...arcPlan, amountUsd: 12 }, 4)
    return originalClaim(planId, owner, now)
  }
  const claimRaceResult = await claimRace.service.runOnce()
  expect(claimRaceResult.reason === "cron_plan_changed_during_claim", "claim race must block changed plan")
  expect(claimRace.executions() === 0, "claim race executed changed plan")

  // Two simultaneous invocations cannot process the single plan twice.
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  let concurrentExecutions = 0
  const concurrent = await fixture({
    async execute() {
      concurrentExecutions++
      await barrier
      return { success: true, txHash: "0xconcurrent34" }
    },
  })
  const first = concurrent.service.runOnce()
  await new Promise(resolve => setTimeout(resolve, 0))
  const second = await concurrent.service.runOnce()
  release()
  const firstResult = await first
  expect(concurrentExecutions === 1, "lease allowed duplicate execution")
  expect([firstResult, second].filter(result => result.executed).length === 1, "exactly one concurrent invocation must execute")
  expect([firstResult, second].some(result => result.reason === "cron_plan_not_ready:processing"), "losing invocation must observe processing state")

  // Redis failure is fail-closed and never reaches any trading dependency.
  const unavailable = await fixture()
  unavailable.store.getKillSwitch = async () => { throw new Error("redis_offline") }
  const unavailableResult = await unavailable.service.runOnce()
  expect(unavailableResult.reason === "cron_fail_closed:redis_offline", "Redis outage must fail closed")
  expect(unavailable.executions() === 0, "Redis outage executed a trade")

  // Structural invariant: kill switch is the first state/gate operation.
  const structuralStore = new MemoryCronTradingStateStore()
  const order: string[] = []
  structuralStore.getKillSwitch = async () => { order.push("kill-switch"); return true }
  structuralStore.appendAudit = async event => {
    order.push("audit")
    return { ...event, id: "audit-34" }
  }
  const structural = new CronTradingService({
    store: structuralStore,
    isMainnet() { order.push("mainnet"); return false },
    async blockIfPanickedFresh() { order.push("circuit"); return false },
    async refreshBudget() { order.push("budget") },
    isBudgetExceeded() { order.push("budget-check"); return false },
    async authorizeRiskBox() { order.push("risk"); return { allowed: true, reason: "authorized" } },
    async signAndExecute() { order.push("execute"); return { success: true } },
    now: () => 1,
    invocationId: () => "structural-34",
  })
  await structural.runOnce()
  expect(order[0] === "kill-switch", `kill switch was not first: ${order.join(",")}`)
  expect(!order.includes("circuit") && !order.includes("execute"), "work continued after kill switch")

  const workflow = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "cron-trigger.yml"), "utf8")
  expect(workflow.includes("workflow_dispatch"), "workflow_dispatch missing")
  expect(workflow.includes("# schedule:"), "schedule must remain commented")
  const route = readFileSync(join(__dirname, "..", "..", "app", "api", "cron", "trigger", "route.ts"), "utf8")
  expect(route.includes("isValidCronRequest"), "cron auth gate missing")

  console.log("RI_BANK_34_MODE_1_MOCK=PASS")
  console.log("RI_BANK_34_KMS_ETHERS_ADAPTER=PASS")
  console.log("RI_BANK_34_MODE_2_CASES=6/6_PASS")
  console.log("RI_BANK_34_CONCURRENCY_LEASE=PASS")
  console.log("RI_BANK_34_KILL_SWITCH_FIRST=PASS")
  console.log("RI_BANK_34_REDIS_FAIL_CLOSED=PASS")
  console.log("RI_BANK_34_REAL_EXECUTION=NO")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
