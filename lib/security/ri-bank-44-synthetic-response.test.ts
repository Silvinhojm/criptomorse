import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getAMMQuote } from "../arc-direct-swap"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const root = join(__dirname, "..", "..")
const route = readFileSync(join(root, "app", "operator", "corretor", "test-swap", "route.ts"), "utf8")
const runtime = readFileSync(join(root, "lib", "cron-trading-runtime.ts"), "utf8")
const directSwap = readFileSync(join(root, "lib", "arc-direct-swap.ts"), "utf8")
const service = readFileSync(join(root, "lib", "cron-trading-service.ts"), "utf8")

// ── Parte 1: resposta nunca mais mascara synthetic como success:true ─────────
expect(runtime.includes("synthetic: result.synthetic === true"), "runtime must propagate synthetic")
expect(runtime.includes("settled:"), "runtime must expose settled")
expect(runtime.includes("canonicalSettlement:"), "runtime must expose canonicalSettlement")
expect(runtime.includes("settlementStatus:"), "runtime must expose settlementStatus")
expect(runtime.includes("txHash: result.txHash || null"), "runtime must return null txHash (never zeros)")
expect(!runtime.includes("'0x' + '0'.repeat(64)"), "zeros hash must not be produced by the runtime")

// ── Parte 1: route test-swap trata synthetic como falha (409), nunca 200 ─────
expect(route.includes("execution.synthetic"), "route must reject synthetic executions")
expect(route.includes("!execution.settled"), "route must require settled (real on-chain tx)")
expect(route.includes("manual_test_execution_synthetic"), "route must name synthetic failure explicitly")
expect(route.includes("{ status: 409 }"), "synthetic must be an HTTP error (409)")
expect(route.includes("synthetic: false,"), "success response must confirm synthetic=false")
expect(route.includes("settled: true,"), "success response must confirm settled=true")
expect(route.includes("txHash: execution.txHash ?? null"), "success txHash must be null when absent")
expect(route.includes("txHash: null,"), "error response must set txHash null (never zeros)")

// ── Parte 1: cron real também não completa planos sintéticos ─────────────────
expect(service.includes("const synthetic = execution.synthetic === true"), "cron must detect synthetic")
expect(service.includes("execution_synthetic_no_onchain_tx"), "cron must fail synthetic executions")
expect(service.includes("executed = execution.success && !synthetic"), "cron must not mark synthetic as executed")
expect(service.includes("synthetic?"), "CronRunResult must expose synthetic")

// ── Parte 2: AMM_PAIRS chaves normalizadas em lowercase ──────────────────────
expect(directSwap.includes(":0x89b50855aa3be2f677cd6303cec089b5f319d72a'"), "AMM_PAIRS EURC key must be lowercase")
expect(directSwap.includes(":0xf0c4a4ce82a5746abaaad9425360ab04fbba432bf'"), "AMM_PAIRS cirBTC key must be lowercase")
expect(directSwap.includes("fromToken.toLowerCase()"), "lookup must keep normalizing to lowercase")
expect(!directSwap.includes(":0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'"), "no mixed-case key may remain in AMM_PAIRS")
expect(!directSwap.includes(":0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF'"), "no mixed-case cirBTC key may remain in AMM_PAIRS")

// ── Parte 2 (funcional): lookup resolve o pool real, não cai mais em synthetic ─
const usdc = "0x3600000000000000000000000000000000000000"
const eurc = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
const pool = getAMMQuote(usdc, eurc, "1000000")
expect(pool !== null, "AMM_PAIRS lookup must resolve USDC/EURC to the pool (not undefined)")
expect(
  pool!.pairAddress.toLowerCase() === "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb".toLowerCase(),
  `USDC/EURC must map to the real pool, got ${pool!.pairAddress}`,
)
const reverse = getAMMQuote(eurc, usdc, "1000000")
expect(reverse !== null && reverse.pairAddress.toLowerCase() === pool!.pairAddress.toLowerCase(), "EURC/USDC reverse lookup must resolve")

console.log("RI_BANK_44_RUNTIME_PROPAGATES_SYNTHETIC=PASS")
console.log("RI_BANK_44_ROUTE_409_ON_SYNTHETIC=PASS")
console.log("RI_BANK_44_TXHASH_NULL_NEVER_ZEROS=PASS")
console.log("RI_BANK_44_CRON_SYNTHETIC_NOT_COMPLETED=PASS")
console.log("RI_BANK_44_AMM_PAIRS_LOWERCASE=PASS")
console.log("RI_BANK_44_AMM_LOOKUP_RESOLVES_POOL=PASS")
