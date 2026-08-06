// RI-BANK-78 — confirma a recalibração da escala do Bandit: (1) tradeAmount
// fixo e pequeno, sem escalada; (2) critério de elegibilidade ("vale a pena
// tentar") reaproveitando hasSufficientPoolDepth() antes de escolher um
// par; (3) cirBTC→EURC removido da lista, e cada par restante avaliado
// contra dados reais observados (RI-BANK-73/77); (4) com o novo
// tradeAmount, USDC/EURC (e EURC/USDC, mesmo pool) passa de verdade.
//
// Somente leitura contra um provider mockado -- nenhuma rede real, nenhuma
// transação, nenhum plano gerado.

import { ethers } from "ethers"

import {
  ARC_BANDIT_PAIRS,
  BANDIT_TRADE_AMOUNT,
  evaluateBanditPairEligibility,
  getEligibleBanditPairs,
} from "../bandit-state-redis"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const USDC_EURC_POOL = "0xa1e418d16c969fdb9482716c7e2bd3d31872ebfb"
const USDC_CIRBTC_POOL = "0x185556c077c95fc07498fed4d4faf03b6ee30c5c"

// Reservas reais observadas ao vivo (RI-BANK-73/77, eth_call de leitura
// direta): pool saudável ~$18,08 USDC / 15,29 EURC; pool cirBTC ~$1,00
// USDC / 0,0001 cirBTC (praticamente drenado).
const RESERVES: Record<string, [bigint, bigint]> = {
  [USDC_EURC_POOL]: [BigInt("0x113e100"), BigInt("0xe95e9f")],
  [USDC_CIRBTC_POOL]: [BigInt("0xf4240"), BigInt("0x2710")],
}

const RESERVE0_SELECTOR = "0x443cb4bc"
const RESERVE1_SELECTOR = "0x5a76f25e"

function makeRealisticMockProvider(): ethers.Provider {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return {
    call: async (tx: { to?: string; data?: string }) => {
      const to = String(tx.to).toLowerCase()
      const reserves = RESERVES[to]
      if (!reserves) throw new Error(`mock provider: unknown pool ${to}`)
      const selector = String(tx.data ?? "").slice(0, 10)
      if (selector === RESERVE0_SELECTOR) return abiCoder.encode(["uint256"], [reserves[0]])
      if (selector === RESERVE1_SELECTOR) return abiCoder.encode(["uint256"], [reserves[1]])
      throw new Error(`mock provider: unexpected selector ${selector}`)
    },
    getNetwork: async () => ({ chainId: 5042002n, name: "arc-testnet" }),
  } as unknown as ethers.Provider
}

async function testFixedSmallTradeAmount(): Promise<void> {
  expect(BANDIT_TRADE_AMOUNT === 0.10, `expected BANDIT_TRADE_AMOUNT=0.10, got ${BANDIT_TRADE_AMOUNT}`)
  console.log("RI_BANK_78_TRADE_AMOUNT_FIXED_AND_SMALL=PASS")
}

async function testCirbtcEurcRemoved(): Promise<void> {
  const found = ARC_BANDIT_PAIRS.find(p => p.pair === "cirBTC→EURC")
  expect(!found, "expected cirBTC→EURC to be removed from ARC_BANDIT_PAIRS")
  expect(ARC_BANDIT_PAIRS.length === 3, `expected 3 remaining pairs, got ${ARC_BANDIT_PAIRS.length}`)
  console.log(`RI_BANK_78_CIRBTC_EURC_REMOVED=PASS (remaining pairs: ${ARC_BANDIT_PAIRS.map(p => p.pair).join(", ")})`)
}

async function testEligibilityAgainstRealData(): Promise<void> {
  const provider = makeRealisticMockProvider()
  const evaluated = await evaluateBanditPairEligibility(provider, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS)

  const usdcEurc = evaluated.find(e => e.pair.pair === "USDC→EURC")
  expect(!!usdcEurc, "USDC→EURC missing from evaluation")
  expect(usdcEurc!.eligible === true, `expected USDC→EURC to be eligible at $${BANDIT_TRADE_AMOUNT}, got kind=${usdcEurc!.check.kind} reason=${usdcEurc!.check.reason}`)
  expect(usdcEurc!.check.kind === "ok", `expected kind=ok, got ${usdcEurc!.check.kind}`)

  const eurcUsdc = evaluated.find(e => e.pair.pair === "EURC→USDC")
  expect(!!eurcUsdc, "EURC→USDC missing from evaluation")
  expect(eurcUsdc!.eligible === true, `expected EURC→USDC to be eligible at $${BANDIT_TRADE_AMOUNT}, got kind=${eurcUsdc!.check.kind}`)

  // cirBTC/USDC tem ~$1,00 de reserva -- em $0,10 (BANDIT_TRADE_AMOUNT) a
  // exigência é exatamente $1,00 (10x), o mesmo valor da reserva: cai
  // exatamente na fronteira documentada em RI-BANK-70 (`<` estrito, então
  // um empate exato passa). Não é coincidência de design -- é o pool quase
  // drenado coincidindo, por acaso, com o novo valor fixo. Um trade
  // ligeiramente maior (ou qualquer drenagem futura do pool) já reprova.
  const cirbtcUsdc = evaluated.find(e => e.pair.pair === "cirBTC→USDC")
  expect(!!cirbtcUsdc, "cirBTC→USDC missing from evaluation")
  expect(cirbtcUsdc!.eligible === true, `expected cirBTC→USDC to sit exactly at the 10x boundary ($1.00 reserve, $0.10*10=$1.00 required) and pass, got eligible=false kind=${cirbtcUsdc!.check.kind}`)

  const evaluatedSlightlyAbove = await evaluateBanditPairEligibility(provider, BANDIT_TRADE_AMOUNT + 0.01, ARC_BANDIT_PAIRS)
  const cirbtcUsdcAbove = evaluatedSlightlyAbove.find(e => e.pair.pair === "cirBTC→USDC")
  expect(cirbtcUsdcAbove!.eligible === false, `expected cirBTC→USDC to fail just above the boundary ($0.11*10=$1.10 > $1.00 reserve), got eligible=true`)

  console.log(`RI_BANK_78_USDC_EURC_ELIGIBLE_WITH_REAL_DATA=PASS (USDC→EURC reserve=$${usdcEurc!.check.stableReserveUsd})`)
  console.log(`RI_BANK_78_THIN_POOL_AT_EXACT_BOUNDARY=PASS (cirBTC→USDC reserve=$${cirbtcUsdc!.check.stableReserveUsd}, eligible at $0.10 but not at $0.11 -- fragile, worth flagging)`)
}

async function testGetEligiblePairsFiltersCorrectly(): Promise<void> {
  const provider = makeRealisticMockProvider()
  const eligible = await getEligibleBanditPairs(provider, BANDIT_TRADE_AMOUNT, ARC_BANDIT_PAIRS)
  const labels = eligible.map(p => p.pair).sort()
  // Em $0,10, os 3 pares restantes passam -- os dois do pool saudável com
  // folga, e cirBTC→USDC exatamente na fronteira (ver nota acima). O
  // filtro em si é testado de forma mais decisiva com um valor que
  // realmente separa: acima do limiar de cirBTC→USDC mas ainda dentro do
  // pool saudável.
  expect(labels.length === 3, `expected all 3 remaining pairs eligible at $${BANDIT_TRADE_AMOUNT} (cirBTC→USDC exactly at boundary), got ${labels.length}: ${labels.join(", ")}`)

  const eligibleAbove = await getEligibleBanditPairs(provider, BANDIT_TRADE_AMOUNT + 0.01, ARC_BANDIT_PAIRS)
  const labelsAbove = eligibleAbove.map(p => p.pair).sort()
  expect(labelsAbove.length === 2, `expected only 2 eligible pairs at $${(BANDIT_TRADE_AMOUNT + 0.01).toFixed(2)} (cirBTC→USDC should drop out), got ${labelsAbove.length}: ${labelsAbove.join(", ")}`)
  expect(labelsAbove.includes("USDC→EURC") && labelsAbove.includes("EURC→USDC"), "expected the healthy pool's pairs to remain eligible")
  expect(!labelsAbove.includes("cirBTC→USDC"), "cirBTC→USDC should have been filtered out just above its boundary")
  console.log(`RI_BANK_78_ELIGIBLE_PAIRS_FILTER=PASS (at $${BANDIT_TRADE_AMOUNT}: ${labels.join(", ")}; at $${(BANDIT_TRADE_AMOUNT + 0.01).toFixed(2)}: ${labelsAbove.join(", ")})`)
}

async function testOldScaleWouldStillFail(): Promise<void> {
  // Sanidade adicional: confirma que o problema original (RI-BANK-77) de
  // fato existia e não foi só um mal-entendido -- o antigo mínimo ($5)
  // continua reprovando mesmo no pool saudável, com os mesmos dados reais.
  const provider = makeRealisticMockProvider()
  const evaluatedOldScale = await evaluateBanditPairEligibility(provider, 5, ARC_BANDIT_PAIRS)
  const usdcEurcOld = evaluatedOldScale.find(e => e.pair.pair === "USDC→EURC")
  expect(usdcEurcOld!.eligible === false, "expected the OLD $5 minimum to still fail against real liquidity -- confirms RI-BANK-78 was solving a real problem")
  console.log("RI_BANK_78_OLD_5_DOLLAR_MINIMUM_CONFIRMED_STILL_INELIGIBLE=PASS")
}

async function run(): Promise<void> {
  await testFixedSmallTradeAmount()
  await testCirbtcEurcRemoved()
  await testEligibilityAgainstRealData()
  await testGetEligiblePairsFiltersCorrectly()
  await testOldScaleWouldStillFail()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
