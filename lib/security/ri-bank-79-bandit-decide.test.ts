// RI-BANK-79 — cobre os dois cenários pedidos pelo ticket: (1) decisão com
// estado inicial (pesos uniformes, todos os pares elegíveis contra
// liquidez real) e (2) nenhum par elegível (liquidez insuficiente em
// todos). Também confirma que o sorteio ponderado de fato respeita os
// pesos (não é hardcoded/sempre o primeiro).
//
// Somente leitura contra Redis falso em memória e provider mockado --
// nenhuma rede real, nenhuma escrita de verdade, nenhum plano gerado fora
// de teste.

import { ethers } from "ethers"

import {
  ARC_BANDIT_PAIRS,
  BANDIT_TRADE_AMOUNT,
  decideBanditPair,
  ENSURE_BANDIT_STATE_SCRIPT,
  type BanditRedisClient,
} from "../bandit-state-redis"
import { resetRouteCache } from "../route-verifier"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Mesmo padrão de Redis falso já usado em RI-BANK-76/77 -- só precisa
// suportar o script de inicialização idempotente para estes testes, já
// que nenhum deles registra resultados nem recalcula pesos.
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
    throw new Error(`FakeBanditRedis: unrecognized script for this test (${script.slice(0, 30)}...)`)
  }

  // Testes de peso não-uniforme usam isto para simular pesos já aprendidos
  // (equivalente ao que recalcBanditWeights() já deixaria persistido).
  setWeight(key: string, pair: string, weight: number): void {
    const hash = this.hashes.get(key) ?? {}
    hash[`pair:${pair}:weight`] = String(weight)
    this.hashes.set(key, hash)
  }
}

const USDC_EURC_POOL = "0xa1e418d16c969fdb9482716c7e2bd3d31872ebfb"
const USDC_CIRBTC_POOL = "0x185556c077c95fc07498fed4d4faf03b6ee30c5c"
const RESERVE0_SELECTOR = "0x443cb4bc"
const RESERVE1_SELECTOR = "0x5a76f25e"

// Reservas reais observadas ao vivo (RI-BANK-73/77/78).
const HEALTHY_RESERVES: Record<string, [bigint, bigint]> = {
  [USDC_EURC_POOL]: [BigInt("0x113e100"), BigInt("0xe95e9f")], // ~$18.08 / 15.29
  [USDC_CIRBTC_POOL]: [BigInt("0xf4240"), BigInt("0x2710")],   // ~$1.00 / 0.0001
}

// Cenário "sem elegibilidade": os dois pools praticamente drenados (bem
// abaixo do que qualquer trade em BANDIT_TRADE_AMOUNT exigiria).
const DRAINED_RESERVES: Record<string, [bigint, bigint]> = {
  [USDC_EURC_POOL]: [1000n, 1000n],   // $0.001
  [USDC_CIRBTC_POOL]: [1000n, 1000n], // $0.001
}

function makeMockProvider(reserves: Record<string, [bigint, bigint]>): ethers.Provider {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return {
    call: async (tx: { to?: string; data?: string }) => {
      const to = String(tx.to).toLowerCase()
      const r = reserves[to]
      if (!r) throw new Error(`mock provider: unknown pool ${to}`)
      const selector = String(tx.data ?? "").slice(0, 10)
      if (selector === RESERVE0_SELECTOR) return abiCoder.encode(["uint256"], [r[0]])
      if (selector === RESERVE1_SELECTOR) return abiCoder.encode(["uint256"], [r[1]])
      throw new Error(`mock provider: unexpected selector ${selector}`)
    },
    getNetwork: async () => ({ chainId: 5042002n, name: "arc-testnet" }),
  } as unknown as ethers.Provider
}

// ── Cenário 1: estado inicial (pesos uniformes 1/3), liquidez real saudável ──
async function testDecisionWithInitialUniformWeights(): Promise<void> {
  const redis = new FakeBanditRedis()
  resetRouteCache()
  const provider = makeMockProvider(HEALTHY_RESERVES)
  const key = "test:bandit:decide:initial"

  const decision = await decideBanditPair(provider, redis, key, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS, () => 0.5)

  expect(decision.decided === true, `expected a decision with all pairs at initial uniform weight, got decided=false reason=${decision.reason}`)
  expect(!!decision.pair, "expected a chosen pair")
  expect(decision.evaluated.length === ARC_BANDIT_PAIRS.length, `expected all ${ARC_BANDIT_PAIRS.length} pairs evaluated, got ${decision.evaluated.length}`)
  const allEligible = decision.evaluated.every(e => e.eligible)
  expect(allEligible, `expected all 3 pairs eligible at $${BANDIT_TRADE_AMOUNT} with healthy reserves (cirBTC/USDC sits exactly at the RI-BANK-78 boundary), got: ${JSON.stringify(decision.evaluated.map(e => ({ pair: e.pair.pair, eligible: e.eligible })))}`)

  // r=0.5 com pesos uniformes (1/3 cada): cumulativo 0.333, 0.667, 1.0 --
  // 0.5 cai no segundo par (EURC→USDC), confirmando que o sorteio de fato
  // usa os pesos, não sempre o primeiro item da lista.
  expect(decision.pair!.pair === "EURC→USDC", `expected r=0.5 with uniform 1/3 weights to land on the second pair (EURC→USDC), got ${decision.pair!.pair}`)

  console.log(`RI_BANK_79_INITIAL_UNIFORM_WEIGHTS_DECISION=PASS (chosen=${decision.pair!.pair})`)
}

// ── Cenário 2: nenhum par elegível (liquidez insuficiente em todos) ──────────
async function testNoEligiblePair(): Promise<void> {
  const redis = new FakeBanditRedis()
  resetRouteCache()
  const provider = makeMockProvider(DRAINED_RESERVES)
  const key = "test:bandit:decide:drained"

  const decision = await decideBanditPair(provider, redis, key, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS, () => 0.5)

  expect(decision.decided === false, `expected no decision with drained pools, got decided=true pair=${decision.pair?.pair}`)
  expect(decision.reason === "no_eligible_pair", `expected reason=no_eligible_pair, got ${decision.reason}`)
  expect(!decision.pair, "expected no pair chosen when nothing is eligible")
  expect(decision.evaluated.length === ARC_BANDIT_PAIRS.length, "expected all pairs still evaluated (and reported) even though none qualified")
  const noneEligible = decision.evaluated.every(e => !e.eligible)
  expect(noneEligible, `expected every pair to be ineligible with drained reserves, got: ${JSON.stringify(decision.evaluated.map(e => ({ pair: e.pair.pair, eligible: e.eligible, kind: e.check.kind })))}`)

  console.log("RI_BANK_79_NO_ELIGIBLE_PAIR=PASS")
}

// ── Bônus: confirma que o sorteio de fato responde a pesos não-uniformes,
// não só ao estado inicial (prova que não é hardcoded no primeiro par). ────
async function testWeightedSelectionRespectsLearnedWeights(): Promise<void> {
  const redis = new FakeBanditRedis()
  resetRouteCache()
  const provider = makeMockProvider(HEALTHY_RESERVES)
  const key = "test:bandit:decide:weighted"

  // Força a inicialização e depois sobrescreve os pesos para simular
  // aprendizado prévio: cirBTC→USDC dominante (0.9), os outros dois com
  // 0.05 cada.
  await decideBanditPair(provider, redis, key, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS, () => 0)
  redis.setWeight(key, "USDC→EURC", 0.05)
  redis.setWeight(key, "EURC→USDC", 0.05)
  redis.setWeight(key, "cirBTC→USDC", 0.9)

  // r=0.99 deve cair dentro da fatia dominante de cirBTC→USDC (cumulativo
  // final ~1.0), confirmando que pesos aprendidos (não só uniformes)
  // influenciam de verdade o sorteio.
  const decision = await decideBanditPair(provider, redis, key, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS, () => 0.99)
  expect(decision.decided === true, "expected a decision with learned weights")
  expect(decision.pair!.pair === "cirBTC→USDC", `expected the dominant-weight pair (cirBTC→USDC) to be chosen at r=0.99, got ${decision.pair!.pair}`)

  console.log("RI_BANK_79_WEIGHTED_SELECTION_RESPECTS_LEARNED_WEIGHTS=PASS")
}

async function run(): Promise<void> {
  await testDecisionWithInitialUniformWeights()
  await testNoEligiblePair()
  await testWeightedSelectionRespectsLearnedWeights()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
