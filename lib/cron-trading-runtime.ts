import { JsonRpcProvider } from "ethers"

import { ARC_BANDIT_PAIRS, recordBanditResult as recordBanditResultRedis } from "@/lib/bandit-state-redis"
import { computeSwapProfitUsd } from "@/lib/bandit-execution-feedback"
import { blockIfPanicked, getCircuitBreakerStateFresh, recordTradeResult } from "@/lib/circuit-breaker"
import { CronTradingService } from "@/lib/cron-trading-service"
import { RedisCronTradingStateStore, type CronTradingPlan } from "@/lib/cron-trading-state"
import { getRedis, isKvConfigured, banditStateKvKey } from "@/lib/kv"
import { KmsEthersSigner } from "@/lib/kms/kms-ethers-signer"
import { KmsEvmSigner } from "@/lib/kms/kms-evm-signer"
import { createVercelOidcKmsClient, readVercelOidcKmsEnvironment } from "@/lib/kms/vercel-oidc-kms"
import { NETWORKS, isStable, realSwap, resolveConfiguredTokenSymbol, type NetworkKey } from "@/lib/real-swap-executor"
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
    // RI-BANK-81 — fecha o elo diagnosticado no RI-BANK-80: mesmo estado
    // Redis já usado pela rota de decisão (RI-BANK-79), mesma função
    // recordBanditResult() já validada por equivalência matemática
    // (RI-BANK-76).
    async recordBanditResult(pairLabel, profitUsd) {
      await recordBanditResultRedis(getRedis(), banditStateKvKey(), pairLabel, profitUsd, ARC_BANDIT_PAIRS)
    },
  })
}

export async function executeCronPlanWithKms(plan: CronTradingPlan) {
  const network = NETWORKS[plan.network as NetworkKey]
  if (!network) throw new Error("cron_plan_unknown_network")

  // RI-BANK-84 — normalizePlanInput() (lib/cron-trading-state.ts, chamada
  // por store.savePlan()) sempre uppercasea fromToken/toToken ao salvar
  // QUALQUER cron-plan -- um invariante da camada de persistência que vale
  // para todo plano de cron, não uma escolha desta rota ou da rota do
  // Bandit (RI-BANK-83 tentou corrigir isso nas rotas de escrita, mas era
  // inócuo: normalizePlanInput() desfazia de qualquer forma). "cirBTC"
  // (mixed-case) é a grafia nativa usada pelo resto de
  // real-swap-executor.ts (NETWORKS.tokens/TOKEN_DECIMALS/COIN_IDS/
  // PRICE_DIVIDERS) e pelo caminho separado do navegador (Pregão/
  // agentes-do-pregão.ts, que nunca passa por normalizePlanInput()).
  // Resolvemos aqui, uma única vez, na fronteira entre "plano de cron"
  // (sempre maiúsculo) e "motor de execução compartilhado" (grafia
  // nativa) -- sem tocar em nenhuma das tabelas em si, então o caminho do
  // navegador nunca é afetado.
  const tokens = network.tokens as Record<string, string>
  const fromToken = resolveConfiguredTokenSymbol(tokens, plan.fromToken)
  const toToken = resolveConfiguredTokenSymbol(tokens, plan.toToken)
  if (!fromToken || !toToken) {
    throw new Error("cron_plan_token_not_configured")
  }

  const kmsEnvironment = readVercelOidcKmsEnvironment()
  const kmsClient = await createVercelOidcKmsClient(kmsEnvironment)
  const kmsSigner = new KmsEvmSigner({
    client: kmsClient,
    keyId: kmsEnvironment.keyArn,
    expectedAddress: kmsEnvironment.expectedAddress,
  })
  // RI-BANK-56 — sem staticNetwork, getNetwork() reconsulta eth_chainId via
  // RPC a cada chamada; o RPC público da Arc Testnet já é conhecidamente
  // instável (RI-BANK-50/51), e a prova original do KMS (RI-BANK-32) só
  // funcionou fixando a rede uma vez com staticNetwork: true.
  const provider = new JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true })
  const ethersSigner = new KmsEthersSigner(kmsSigner, provider)
  const address = await ethersSigner.getAddress()
  const initialized = await realSwap.initializeWithServerSigner(address, plan.network as NetworkKey, ethersSigner, provider)
  if (!initialized) throw new Error("cron_kms_real_swap_initialization_failed")

  const result = await realSwap.executeSwap(
    fromToken,
    toToken,
    plan.amountUsd,
    message => console.log(`[CRON] ${message}`),
    `cron:${plan.id}`,
  )

  if (result.success) {
    await recordTradingSpend(plan.amountUsd)
    const isBuyOpening = isStable(fromToken) && !isStable(toToken)
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

  // RI-BANK-81 — fecha o elo diagnosticado no RI-BANK-80: só para planos
  // decididos pelo Bandit (nunca para planos manuais), e só quando a
  // execução foi real. `result.fromAmount`/`result.toAmount`
  // (real-swap-executor.ts) são as quantidades já apuradas por
  // real-swap-executor.ts a partir de saldo real antes/depois do swap
  // (`postSwapBalance - preSwapBalance`) -- dado on-chain confiável, não
  // uma estimativa de cotação. Convertidas para USD aqui usando câmbio
  // externo real (lib/external-forex-rate.ts), nunca o preço interno do
  // pool de testnet. Se o câmbio externo não puder ser obtido (rede fora,
  // API fora) ou o par não for suportado (ex: envolve cirBTC), o lucro
  // simplesmente não é calculado desta vez -- a execução já aconteceu e já
  // foi liquidada on-chain de qualquer forma; só o aprendizado do Bandit
  // fica sem esse dado específico.
  let banditProfitUsd: number | undefined
  let banditPriceSource: string | undefined
  let banditEnvironment: "testnet" | "mainnet" | undefined
  if (result.success && plan.strategy === "bandit-decision") {
    try {
      const feedback = await computeSwapProfitUsd(
        plan.fromToken,
        plan.toToken,
        result.fromAmount ?? plan.amountUsd,
        result.toAmount ?? 0,
        network.isTestnet,
      )
      banditProfitUsd = feedback.profitUsd
      banditPriceSource = feedback.priceSource
      banditEnvironment = feedback.environment
    } catch (error) {
      console.error("[RI-BANK-81] failed to compute external-FX profit for bandit feedback", error)
    }
  }

  return {
    success: result.success,
    txHash: result.txHash || null,
    reason: result.success ? undefined : result.message,
    // RI-BANK-44: propagar os marcadores de settlement de ponta a ponta.
    // synthetic=true significa que NÃO houve transação on-chain — a resposta
    // externa (route test-swap / cron) nunca deve interpretar isso como sucesso real.
    synthetic: result.synthetic === true,
    settled: result.success && result.canonicalSettlement === true && !result.synthetic,
    canonicalSettlement: result.canonicalSettlement === true && !result.synthetic,
    settlementStatus: result.settlementStatus ?? (result.success ? (result.synthetic ? "synthetic" : "confirmed") : "failed"),
    banditProfitUsd,
    banditPriceSource,
    banditEnvironment,
  }
}
