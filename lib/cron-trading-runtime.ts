import { JsonRpcProvider } from "ethers"

import { blockIfPanicked, getCircuitBreakerStateFresh, recordTradeResult } from "@/lib/circuit-breaker"
import { CronTradingService } from "@/lib/cron-trading-service"
import { RedisCronTradingStateStore, type CronTradingPlan } from "@/lib/cron-trading-state"
import { getRedis, isKvConfigured } from "@/lib/kv"
import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import { createVercelOidcKmsClient, readVercelOidcKmsEnvironment } from "@/lib/kms/vercel-oidc-kms"
import { NETWORKS, isStable, realSwap, type NetworkKey } from "@/lib/real-swap-executor"
import { authorizeRiskBoxTradeFresh, recordRiskBoxEconomicResult } from "@/lib/risk-boxes"
import {
  initializeTradingBudgetDailyLimit,
  isBudgetExceeded,
  recordTradingSpend,
} from "@/lib/trading-budget"

export function createProductionCronTradingService(): CronTradingService {
  if (!isKvConfigured()) throw new Error("cron_redis_unavailable")
  const store = new RedisCronTradingStateStore(getRedis())

  return new CronTradingService({
    store,
    isMainnet(network) {
      const config = NETWORKS[network as NetworkKey]
      if (!config) throw new Error("cron_plan_unknown_network")
      return !config.isTestnet
    },
    async blockIfPanickedFresh() {
      await getCircuitBreakerStateFresh()
      return blockIfPanicked()
    },
    async refreshBudget() {
      await initializeTradingBudgetDailyLimit()
    },
    isBudgetExceeded,
    authorizeRiskBox: authorizeRiskBoxTradeFresh,
    signAndExecute: executeCronPlanWithKms,
  })
}

export async function executeCronPlanWithKms(plan: CronTradingPlan) {
  const network = NETWORKS[plan.network as NetworkKey]
  if (!network) throw new Error("cron_plan_unknown_network")
  if (!(network.tokens as Record<string, string>)[plan.fromToken] || !(network.tokens as Record<string, string>)[plan.toToken]) {
    throw new Error("cron_plan_token_not_configured")
  }

  const kmsEnvironment = readVercelOidcKmsEnvironment()
  const kmsClient = await createVercelOidcKmsClient(kmsEnvironment)
  const kmsSigner = new KmsEvmSigner({
    client: kmsClient,
    keyId: kmsEnvironment.keyArn,
    expectedAddress: kmsEnvironment.expectedAddress,
  })
  const provider = new JsonRpcProvider(network.rpcUrl, network.chainId)
  const ethersSigner = new KmsEthersSigner(kmsSigner, provider)
  const address = await ethersSigner.getAddress()
  const initialized = await realSwap.initializeWithServerSigner(address, plan.network as NetworkKey, ethersSigner, provider)
  if (!initialized) throw new Error("cron_kms_real_swap_initialization_failed")

  const result = await realSwap.executeSwap(
    plan.fromToken,
    plan.toToken,
    plan.amountUsd,
    message => console.log(`[CRON] ${message}`),
    `cron:${plan.id}`,
  )

  if (result.success) {
    await recordTradingSpend(plan.amountUsd)
    const isBuyOpening = isStable(plan.fromToken) && !isStable(plan.toToken)
    if (!isBuyOpening) {
      const profit = result.profit ?? 0
      await recordRiskBoxEconomicResult(plan.riskBox, profit)
      await recordTradeResult(profit)
    }
  } else if (result.txHash) {
    const estimatedLoss = -plan.amountUsd * 0.1
    await recordRiskBoxEconomicResult(plan.riskBox, estimatedLoss)
    await recordTradeResult(estimatedLoss)
  }

  return {
    success: result.success,
    txHash: result.txHash || undefined,
    reason: result.success ? undefined : result.message,
  }
}
