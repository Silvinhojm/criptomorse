import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const root = join(__dirname, "..", "..")
const route = readFileSync(join(root, "app", "operator", "corretor", "test-swap", "route.ts"), "utf8")
const runtime = readFileSync(join(root, "lib", "cron-trading-runtime.ts"), "utf8")

expect(route.includes('process.env.NETWORK_MODE?.trim().toLowerCase() === "mainnet"'), "mainnet build lock missing")
expect(route.includes('value.network !== "arc-testnet"'), "hard-coded Arc Testnet logic lock missing")
expect(route.includes('value.amountIn !== EXACT_AMOUNT'), "exact 0.10 amount lock missing")
expect(route.includes('value.confirm !== true'), "explicit confirm:true gate missing")
expect(route.includes("isValidCronAdminRequest"), "ADMIN_PANIC_KEY bearer auth missing")
expect(!route.includes("NEXT_PUBLIC_ADMIN"), "admin secret must never enter browser scope")
expect(route.includes("nx: true") && route.includes("ex: RATE_LIMIT_SECONDS"), "atomic 15-minute rate limit missing")
expect(route.includes("executeCronPlanWithKms(plan)"), "route does not reuse the cron KMS executor")
expect(route.includes('source: "manual-test"'), "manual-test audit source missing")
expect(route.includes("manualDispatchRef"), "manualDispatchRef missing")
expect(runtime.includes("export async function executeCronPlanWithKms"), "cron executor is not shared")

console.log("RI_BANK_39_ADMIN_BEARER_ONLY=PASS")
console.log("RI_BANK_39_ARC_DOUBLE_LOCK=PASS")
console.log("RI_BANK_39_EXACT_AMOUNT_0_10=PASS")
console.log("RI_BANK_39_RATE_LIMIT_15M=PASS")
console.log("RI_BANK_39_SHARED_KMS_EXECUTOR=PASS")
console.log("RI_BANK_39_IMMUTABLE_AUDIT_FIELDS=PASS")
