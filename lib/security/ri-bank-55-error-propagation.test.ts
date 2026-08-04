import { readFileSync } from "node:fs"
import { join } from "node:path"

import { executeDirectSwap } from "../arc-direct-swap"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const root = join(__dirname, "..", "..")
const executor = readFileSync(join(root, "lib", "real-swap-executor.ts"), "utf8")

// RI-BANK-46 found "Nenhuma rota disponível" discarding the real error from
// executeDirectSwap(). RI-BANK-55 fixes that, plus a second masking point
// found inside arc-direct-swap.ts itself (the approve/transfer catch used to
// throw a hardcoded string, dropping the underlying revert/ethers error).

// ── Part 1: real-swap-executor.ts propagates directResult.error into `motivo` ──
expect(
  executor.includes("let directRouteError: string | undefined"),
  "executeSwap must capture directResult.error outside the inner testnet block",
)
expect(
  executor.includes("directRouteError = directResult.error"),
  "executeSwap must read .error from a failed executeDirectSwap() call",
)
expect(
  executor.includes('`Nenhuma rota disponível${directRouteError ? ` (${directRouteError})` : ""}`'),
  "the generic message must interpolate the real error when present, not discard it",
)

// ── Part 2 (functional, no mocking framework needed): executeDirectSwap ──────
// no longer swallows the real approve/transfer error behind a fixed string.
// chainId 1 is deliberately NOT in isTestnetChain()'s list, so this exercises
// the raw ERC20 approve+transfer fallback path directly (arc-direct-swap.ts
// ~line 290-330) instead of the earlier testnet-only AMM/synthetic branches.
async function run(): Promise<void> {
  const fakeSigner: any = {
    getAddress: async () => "0x1234567890123456789012345678901234567890",
    provider: null, // forces ethers.Contract calls to fail with a distinctive error
  }
  const result = await executeDirectSwap(
    fakeSigner,
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "1000000",
    "0x1234567890123456789012345678901234567890",
    1,
  )
  expect(result.success === false, "expected a synthetic failure from an unusable signer")
  expect(!!result.error, "executeDirectSwap must return an error message")
  expect(
    result.error!.includes("does not support calling") || result.error!.includes("UNSUPPORTED_OPERATION"),
    `expected the real ethers/contract error to survive in the message, got: "${result.error}"`,
  )
  expect(
    result.error !== "Nenhuma rota disponível para este par na testnet",
    "the bare generic string must no longer be returned on its own — the real cause must be appended",
  )

  console.log("RI_BANK_55_EXECUTOR_PROPAGATES_ERROR=PASS")
  console.log("RI_BANK_55_DIRECT_SWAP_PRESERVES_REAL_ERROR=PASS")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
