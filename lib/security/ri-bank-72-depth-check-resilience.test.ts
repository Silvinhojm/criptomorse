import { ethers } from "ethers"

import { hasSufficientPoolDepth } from "../route-verifier"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-71 found hasSufficientPoolDepth() (RI-BANK-70) blocking a
// genuinely safe trade because its old local retry (3 attempts, 200ms,
// only against the primary RPC) hit the same intermittent Arc Testnet
// CALL_EXCEPTION flakiness already solved for balance reads (RI-BANK-
// 50/62/63), but never wired to that same resilience. This test
// reproduces the exact scenario: the primary RPC fails every attempt, one
// specific backup answers correctly with the real USDC/EURC pool's
// reserves, and confirms the check ultimately reports sufficient=true --
// proving recovery, not just retry-and-still-fail.
//
// ethers' JsonRpcProvider does not use the global fetch() -- confirmed
// empirically before writing this test (globalThis.fetch mocking does not
// intercept it). Instead this monkey-patches JsonRpcProvider.prototype
// ._send, keyed by each instance's connection URL (via _getConnection()),
// restored in a finally block. No real network call is made.

const USDC_EURC_POOL = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"
const USDC = "0x3600000000000000000000000000000000000000"
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const PRIMARY_URL = "https://rpc.testnet.arc.network"
const GOOD_BACKUP_URL = "https://rpc.blockdaemon.testnet.arc.io" // first entry in BACKUP_RPCS.arc

// Real reserves observed live during RI-BANK-69, and re-confirmed in
// RI-BANK-73 by reading reserve0()/reserve1() directly against the real
// contract (which is what these actually are -- see RI-BANK-74): 17.78
// USDC / 15.551386 EURC.
const RESERVE0 = 0x10f4d20n
const RESERVE1 = 0xed4b9an

// RI-BANK-74 -- the real pool (contracts/GenericAMMPair.sol) has separate
// reserve0()/reserve1() getters (uint256 each), not a combined
// getReserves(). The mock must dispatch by selector like the real contract
// would, since readReserves() now issues two independent eth_call requests.
const RESERVE0_SELECTOR = "0x443cb4bc"
const RESERVE1_SELECTOR = "0x5a76f25e"

function encodeReserveResponse(selector: string): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  if (selector === RESERVE0_SELECTOR) return abiCoder.encode(["uint256"], [RESERVE0])
  if (selector === RESERVE1_SELECTOR) return abiCoder.encode(["uint256"], [RESERVE1])
  throw new Error(`mock: unexpected selector ${selector}`)
}

async function run(): Promise<void> {
  const originalSend = (ethers.JsonRpcProvider.prototype as any)._send
  let primaryAttempts = 0
  let goodBackupCalls = 0
  let otherBackupCalls = 0

  ;(ethers.JsonRpcProvider.prototype as any)._send = async function (this: ethers.JsonRpcProvider, payload: any) {
    const url = this._getConnection().url
    const items = Array.isArray(payload) ? payload : [payload]

    if (url === PRIMARY_URL) {
      primaryAttempts++
      throw Object.assign(new Error("missing revert data"), { code: "CALL_EXCEPTION" })
    }
    if (url === GOOD_BACKUP_URL) {
      goodBackupCalls++
      // ethers' JsonRpcApiPollingProvider._send contract: the result is
      // ALWAYS an array of {id, ...} responses, even for a single
      // (non-batched) request -- it unconditionally does
      // `result.filter((r) => r.id === payload.id)` on whatever _send
      // returns (provider-jsonrpc.ts _drainPayloads). Returning a bare
      // object for the non-batched case throws "result.filter is not a
      // function", which is exactly what happened here before this fix.
      return items.map((it: any) => {
        const selector = String(it.params?.[0]?.data ?? "").slice(0, 10)
        return { id: it.id, jsonrpc: "2.0", result: encodeReserveResponse(selector) }
      })
    }
    // Any other BACKUP_RPCS.arc entry -- also fails, proving the check
    // reaches the GOOD backup specifically, not just "some backup, any one".
    otherBackupCalls++
    throw Object.assign(new Error("missing revert data"), { code: "CALL_EXCEPTION" })
  }

  try {
    const primaryProvider = new ethers.JsonRpcProvider(PRIMARY_URL, 5042002, { staticNetwork: true })

    const result = await hasSufficientPoolDepth(primaryProvider, USDC, EURC, 0.10, "arc")

    expect(primaryAttempts >= 2, `expected the primary to be retried more than once before giving up, got ${primaryAttempts} attempts`)
    expect(goodBackupCalls >= 1, `expected the working backup (${GOOD_BACKUP_URL}) to be reached, got ${goodBackupCalls} calls`)
    console.log(`RI_BANK_72_PRIMARY_RETRIED_THEN_FAILED_OVER=PASS (primary attempts: ${primaryAttempts}, backup calls: ${goodBackupCalls})`)

    expect(result.sufficient === true, `expected recovery via backup to report sufficient=true, got ${result.sufficient} (kind=${result.kind}, reason=${result.reason})`)
    expect(result.kind === "ok", `expected kind=ok after successful recovery, got ${result.kind}`)
    expect(result.stableReserveUsd !== undefined && Math.abs(result.stableReserveUsd - 17.78) < 0.01, `expected the real reserve value (~17.78) to come through via the backup, got ${result.stableReserveUsd}`)
    console.log("RI_BANK_72_BACKUP_RECOVERS_CORRECT_LIQUIDITY_RESULT=PASS")
  } finally {
    ;(ethers.JsonRpcProvider.prototype as any)._send = originalSend
  }
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    // Throwaway ethers.JsonRpcProvider instances keep background
    // network-detection timers alive without an explicit exit.
    process.exit(process.exitCode ?? 0)
  })
