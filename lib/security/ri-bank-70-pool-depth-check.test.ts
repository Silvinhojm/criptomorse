import { ethers } from "ethers"

import { hasSufficientPoolDepth } from "../route-verifier"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-69 found hasSellRoute() only confirms a pool EXISTS, never that
// it can absorb a trade of this size. Concrete real evidence: the
// USDC/cirBTC pool on Arc Testnet has ~$1 of total liquidity right now
// (confirmed via eth_call getReserves() during the RI-BANK-69
// investigation) -- a $5 trade, the Bandit's minimum, is 5x the entire
// pool. This test reproduces that exact scenario (real pool address, real
// observed reserve values) and the healthy USDC/EURC pool as a control,
// against a mock provider so it never touches the real network.

const USDC_EURC_POOL = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"
const USDC_CIRBTC_POOL = "0x185556c077c95FC07498FEd4D4faF03b6EE30C5C"
const USDC = "0x3600000000000000000000000000000000000000"
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const CIRBTC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF"

// Reserves observed live via eth_call during the RI-BANK-69 investigation.
const RESERVES: Record<string, [bigint, bigint]> = {
  [USDC_EURC_POOL.toLowerCase()]: [0x10f4d20n, 0xed4b9an],   // 17.78 USDC / 15.551386 EURC
  [USDC_CIRBTC_POOL.toLowerCase()]: [0xf4240n, 0x2710n],      // 1.00 USDC / 0.0001 cirBTC
}

function makeMockProvider(): ethers.Provider {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return {
    call: async (tx: { to?: string }) => {
      const to = String(tx.to).toLowerCase()
      const reserves = RESERVES[to]
      if (!reserves) throw new Error(`mock provider: unknown pool ${to}`)
      return abiCoder.encode(["uint112", "uint112", "uint32"], [reserves[0], reserves[1], 0])
    },
    getNetwork: async () => ({ chainId: 5042002n, name: "arc-testnet" }),
  } as unknown as ethers.Provider
}

async function run(): Promise<void> {
  const provider = makeMockProvider()

  // ── Scenario 1: real risk case — USDC/cirBTC pool ($1 liquidity), $5 trade ──
  const thin = await hasSufficientPoolDepth(provider, CIRBTC, USDC, 5, "arc")
  expect(thin.sufficient === false, `expected the $1-liquidity pool to reject a $5 trade, got sufficient=${thin.sufficient}`)
  expect(thin.reason.includes("liquidez insuficiente"), `expected a clear 'liquidez insuficiente' reason, got: ${thin.reason}`)
  expect(thin.stableReserveUsd !== undefined && Math.abs(thin.stableReserveUsd - 1.0) < 0.01, `expected stableReserveUsd ~1.0, got ${thin.stableReserveUsd}`)
  console.log("RI_BANK_70_THIN_POOL_REJECTED=PASS")

  // Even a modest trade well below the Bandit's real minimum ($0.20, vs the
  // $5 the Bandit actually uses) still fails against this pool at the 10x
  // multiplier ($0.20 * 10 = $2 > the pool's $1 reserve). Confirms the gate
  // isn't just tuned to reject the specific $5 case above.
  const thinSmall = await hasSufficientPoolDepth(provider, CIRBTC, USDC, 0.20, "arc")
  expect(thinSmall.sufficient === false, `expected a $0.20 trade against a $1 pool to fail at 10x margin, got sufficient=${thinSmall.sufficient}`)
  console.log("RI_BANK_70_THIN_POOL_REJECTS_EVEN_SMALL_TRADE=PASS")

  // And the genuinely tiny $0.10 real test-swap amount sits exactly at the
  // 10x boundary ($0.10 * 10 = $1.00 == the pool's reserve) -- documenting
  // the boundary behavior explicitly rather than leaving it untested: the
  // check uses a strict less-than, so an exact match at the threshold is
  // accepted, not rejected.
  const thinAtBoundary = await hasSufficientPoolDepth(provider, CIRBTC, USDC, 0.10, "arc")
  expect(thinAtBoundary.sufficient === true, `expected the exact 10x boundary ($0.10 * 10 == $1.00 reserve) to pass (strict <), got sufficient=${thinAtBoundary.sufficient}`)
  console.log("RI_BANK_70_THIN_POOL_BOUNDARY_DOCUMENTED=PASS")

  // ── Scenario 2: healthy pool — USDC/EURC ($17.78 liquidity), $0.10 trade (our real test-swap amount) ──
  const healthy = await hasSufficientPoolDepth(provider, USDC, EURC, 0.10, "arc")
  expect(healthy.sufficient === true, `expected the $17.78-liquidity pool to accept a $0.10 trade, got sufficient=${healthy.sufficient} reason=${healthy.reason}`)
  expect(healthy.stableReserveUsd !== undefined && Math.abs(healthy.stableReserveUsd - 17.78) < 0.01, `expected stableReserveUsd ~17.78, got ${healthy.stableReserveUsd}`)
  console.log("RI_BANK_70_HEALTHY_POOL_ACCEPTS_SMALL_TRADE=PASS")

  // A trade close to the edge of the healthy pool's margin should still be
  // rejected -- confirms the multiplier is actually enforced, not just a
  // pass-through.
  const healthyTooBig = await hasSufficientPoolDepth(provider, USDC, EURC, 5, "arc")
  expect(healthyTooBig.sufficient === false, `expected a $5 trade (5*10=$50 > $17.78 reserve) to be rejected even on the healthy pool, got sufficient=${healthyTooBig.sufficient}`)
  console.log("RI_BANK_70_HEALTHY_POOL_STILL_ENFORCES_MULTIPLIER=PASS")

  // ── Scenario 3: unknown pair on Arc — fail-closed ──
  const unknown = await hasSufficientPoolDepth(provider, "0x1111111111111111111111111111111111111111", USDC, 0.10, "arc")
  expect(unknown.sufficient === false, "expected an unknown pair to fail closed")
  console.log("RI_BANK_70_UNKNOWN_PAIR_FAILS_CLOSED=PASS")

  // ── Scenario 4: non-arc network — not applicable, passes through ──
  const other = await hasSufficientPoolDepth(provider, USDC, EURC, 1000, "polygon")
  expect(other.sufficient === true, "expected the check to be a no-op (sufficient=true) outside arc, where it isn't implemented")
  console.log("RI_BANK_70_NON_ARC_NETWORK_PASSTHROUGH=PASS")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
