import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-56 — the cron/manual-test KMS swap path builds its provider
// without `staticNetwork: true`, unlike the RI-BANK-32 proof route (the one
// that actually succeeded broadcasting a real transaction). Without it,
// every getNetwork() call re-queries eth_chainId against the Arc Testnet
// public RPC, already proven intermittently flaky (RI-BANK-50/51) — the
// working theory for the "invalid chain ID" error surfaced by RI-BANK-55.
const root = join(__dirname, "..", "..")
const runtime = readFileSync(join(root, "lib", "cron-trading-runtime.ts"), "utf8")

const providerLine = runtime
  .split("\n")
  .find(line => line.includes("new JsonRpcProvider(network.rpcUrl, network.chainId"))

expect(providerLine, "cron-trading-runtime.ts must construct a JsonRpcProvider from network.rpcUrl/chainId")
expect(
  providerLine!.includes("{ staticNetwork: true }"),
  `the cron/manual-test KMS provider must pin staticNetwork: true (same pattern as the RI-BANK-32 proof route), got: "${providerLine}"`,
)

console.log("RI_BANK_56_CRON_PROVIDER_STATIC_NETWORK=PASS")
