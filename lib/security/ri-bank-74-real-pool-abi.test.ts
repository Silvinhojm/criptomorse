import { ethers } from "ethers"

import { hasSufficientPoolDepth } from "../route-verifier"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-73 found, with direct on-chain evidence (eth_getCode + manual
// eth_call against all 4 RPCs), that readReserves() had been calling
// getReserves() (selector 0x0902f1ac) against the real USDC/EURC pool --
// a selector that contract (contracts/GenericAMMPair.sol) never
// implements. It exposes reserves as two separate public uint256
// variables, reserve0()/reserve1() (0x443cb4bc/0x5a76f25e), confirmed live
// to hold the real values (17.78 USDC / 15.551386 EURC). This is what
// deterministically broke every real dispatch of the RI-BANK-71 queue --
// not RPC instability, which RI-BANK-72 fixed correctly but couldn't have
// addressed this.
//
// This test's mock reproduces the REAL contract's dispatcher behavior:
// it only recognizes reserve0()/reserve1() (mirroring GenericAMMPair.sol's
// actual selector table) and reverts on anything else -- including the
// old getReserves() selector -- exactly like eth_getCode showed on-chain.
// It proves two things: (1) the old selector genuinely would revert
// against this contract shape, and (2) the fixed code, using the real
// selectors, reads the correct values through it.

const USDC = "0x3600000000000000000000000000000000000000"
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"

const RESERVE0_SELECTOR = "0x443cb4bc" // reserve0() -- real selector, confirmed via ethers.id() and live eth_call
const RESERVE1_SELECTOR = "0x5a76f25e" // reserve1() -- same
const OLD_GET_RESERVES_SELECTOR = "0x0902f1ac" // getReserves() -- the wrong one RI-BANK-70/72 used to call

// Real reserves observed live during RI-BANK-69/73: 17.78 USDC / 15.551386 EURC.
const RESERVE0 = 0x10f4d20n
const RESERVE1 = 0xed4b9an

function makeRealContractShapedMockProvider(): ethers.Provider {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return {
    call: async (tx: { data?: string }) => {
      const selector = String(tx.data ?? "").slice(0, 10)
      if (selector === RESERVE0_SELECTOR) return abiCoder.encode(["uint256"], [RESERVE0])
      if (selector === RESERVE1_SELECTOR) return abiCoder.encode(["uint256"], [RESERVE1])
      // Mirrors the real contract: any unrecognized selector -- including
      // the old getReserves() -- falls through to the fallback and
      // reverts with no data, exactly as eth_getCode/eth_call confirmed
      // on-chain in RI-BANK-73.
      throw Object.assign(new Error("missing revert data"), { code: "CALL_EXCEPTION" })
    },
    getNetwork: async () => ({ chainId: 5042002n, name: "arc-testnet" }),
  } as unknown as ethers.Provider
}

async function run(): Promise<void> {
  const provider = makeRealContractShapedMockProvider()

  // ── Control: confirm the OLD selector genuinely reverts against this
  // contract shape -- documents the exact bug RI-BANK-73 found, so this
  // test would fail loudly if someone reverted the fix by accident.
  try {
    await provider.call({ to: "0x0000000000000000000000000000000000000001", data: OLD_GET_RESERVES_SELECTOR } as any)
    throw new Error("expected the old getReserves() selector to revert against the real contract shape, it did not")
  } catch (e) {
    expect((e as any)?.code === "CALL_EXCEPTION", `expected CALL_EXCEPTION for the old selector, got: ${e}`)
    console.log("RI_BANK_74_OLD_SELECTOR_CONFIRMED_BROKEN=PASS")
  }

  // ── The actual fix: hasSufficientPoolDepth() must succeed against this
  // real-contract-shaped mock using the corrected reserve0()/reserve1()
  // calls, and report the real observed liquidity.
  const result = await hasSufficientPoolDepth(provider, USDC, EURC, 0.10, "arc")
  expect(result.sufficient === true, `expected the real pool ABI to be read successfully, got sufficient=${result.sufficient} (kind=${result.kind}, reason=${result.reason})`)
  expect(result.kind === "ok", `expected kind=ok, got ${result.kind}`)
  expect(result.stableReserveUsd !== undefined && Math.abs(result.stableReserveUsd - 17.78) < 0.01, `expected the real reserve value (~17.78 USDC), got ${result.stableReserveUsd}`)
  console.log(`RI_BANK_74_REAL_POOL_ABI_READ_CORRECTLY=PASS (stableReserveUsd=${result.stableReserveUsd})`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
