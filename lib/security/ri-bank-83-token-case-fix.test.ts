// RI-BANK-83 — reproduz o cenário exato do RI-BANK-82: um plano do Bandit
// com fromToken "cirBTC" (grafia canônica, preservada agora em vez de
// uppercased) deve passar no gate `NETWORKS.arc.tokens`, exatamente como
// USDC/EURC já passavam. Confirma também que a grafia antiga e incorreta
// ("CIRBTC") de fato reprovaria -- documentando o bug, não só a correção
// -- e que `resolveConfiguredTokenSymbol()` resolve qualquer variação de
// caixa para a grafia canônica, sem nunca produzir um valor que não bate
// com TOKEN_DECIMALS/COIN_IDS/PRICE_DIVIDERS.
//
// Achado adicional verificado aqui: se o gate fosse "corrigido" só
// tornando o lookup tolerante a caixa (sem also corrigir a grafia
// armazenada), um plano com "CIRBTC" passaria no gate mas cairia
// silenciosamente em TOKEN_DECIMALS["CIRBTC"] ?? 6 -- 6 casas decimais em
// vez das 8 reais do cirBTC, um erro de 100x. Este teste confirma que a
// direção escolhida (preservar/resolver para a grafia canônica na
// escrita) evita esse cenário mais perigoso.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { NETWORKS, resolveConfiguredTokenSymbol, TOKEN_DECIMALS, isStable } from "../real-swap-executor"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function gateWouldPass(fromToken: string, toToken: string): boolean {
  const tokens = NETWORKS.arc.tokens as Record<string, string>
  return !!tokens[fromToken] && !!tokens[toToken]
}

function testCanonicalCasePassesTheGate(): void {
  expect(gateWouldPass("cirBTC", "USDC"), "expected the canonical-case plan (fromToken: 'cirBTC') to pass the token-configuration gate")
  expect(gateWouldPass("USDC", "EURC"), "expected USDC/EURC to keep passing (never broken, but confirming no regression)")
  console.log("RI_BANK_83_CANONICAL_CASE_PASSES_GATE=PASS")
}

function testOldUppercasedFormStillFails(): void {
  // Documenta o bug exato do RI-BANK-82: a forma antiga e incorreta.
  expect(!gateWouldPass("CIRBTC", "USDC"), "expected the OLD buggy uppercased form ('CIRBTC') to still fail the gate -- this documents the exact RI-BANK-82 bug, proving the fix works by removing the uppercase transform, not by loosening the gate itself")
  console.log("RI_BANK_83_OLD_UPPERCASED_FORM_DOCUMENTED_AS_BROKEN=PASS")
}

function testResolveConfiguredTokenSymbolCaseInsensitive(): void {
  const tokens = NETWORKS.arc.tokens as Record<string, string>
  const cases: Array<[string, string | undefined]> = [
    ["cirBTC", "cirBTC"],
    ["CIRBTC", "cirBTC"],
    ["cirbtc", "cirBTC"],
    ["CirBtc", "cirBTC"],
    ["usdc", "USDC"],
    ["Usdc", "USDC"],
    ["USDC", "USDC"],
    ["eurc", "EURC"],
    ["notatoken", undefined],
  ]
  for (const [input, expected] of cases) {
    const resolved = resolveConfiguredTokenSymbol(tokens, input)
    expect(resolved === expected, `resolveConfiguredTokenSymbol("${input}") = ${resolved}, expected ${expected}`)
  }
  console.log("RI_BANK_83_RESOLVE_CONFIGURED_TOKEN_SYMBOL_CASE_INSENSITIVE=PASS")
}

function testWrongCaseWouldHaveSilentlyBrokenDecimals(): void {
  // Confirma o achado do próprio diagnóstico: a grafia correta tem 8
  // decimais reais; a forma incorreta cairia no fallback (6) sem avisar.
  expect(TOKEN_DECIMALS.cirBTC === 8, `expected TOKEN_DECIMALS.cirBTC === 8, got ${TOKEN_DECIMALS.cirBTC}`)
  expect(TOKEN_DECIMALS.CIRBTC === undefined, "expected TOKEN_DECIMALS to have no entry for the wrong-case 'CIRBTC' -- confirms the silent 6-decimal fallback this fix avoids")
  console.log("RI_BANK_83_WRONG_CASE_WOULD_HAVE_SILENTLY_USED_FALLBACK_DECIMALS=PASS")
}

// ── Outros pontos sensíveis a caixa no caminho de execução: confirma que
// nenhum deles quebra para a grafia canônica "cirBTC" (item 2 do ticket).
function testOtherCaseSensitivePointsInExecutionPath(): void {
  // isStable()/STABLE_TOKENS: cirBTC nunca é stable, em nenhuma caixa --
  // não há bug aqui, mas confirma explicitamente que a resposta é
  // correta para a grafia canônica (o único valor que qualquer plano
  // real vai conter, depois desta correção).
  expect(isStable("cirBTC") === false, "expected isStable('cirBTC') === false")
  expect(isStable("USDC") === true, "expected isStable('USDC') === true")
  expect(isStable("EURC") === true, "expected isStable('EURC') === true")
  console.log("RI_BANK_83_IS_STABLE_CORRECT_FOR_CANONICAL_CASE=PASS")
}

// ── Confirma estaticamente que a rota do Bandit não uppercasea mais --
// mesmo padrão de checagem de código-fonte já usado em
// ri-bank-39-manual-test-route.test.ts. ─────────────────────────────────
function testBanditRouteNoLongerUppercases(): void {
  const root = join(__dirname, "..", "..")
  const route = readFileSync(join(root, "app", "api", "internal", "ri-bank-79-bandit-decide", "route.ts"), "utf8")
  expect(!route.includes("chosen.fromToken.toUpperCase()"), "expected the Bandit decision route to no longer uppercase fromToken")
  expect(!route.includes("chosen.toToken.toUpperCase()"), "expected the Bandit decision route to no longer uppercase toToken")
  expect(route.includes("fromToken: chosen.fromToken,"), "expected fromToken to be preserved as-is from the decision")
  expect(route.includes("toToken: chosen.toToken,"), "expected toToken to be preserved as-is from the decision")
  console.log("RI_BANK_83_BANDIT_ROUTE_PRESERVES_CANONICAL_CASE=PASS")
}

function run(): void {
  testCanonicalCasePassesTheGate()
  testOldUppercasedFormStillFails()
  testResolveConfiguredTokenSymbolCaseInsensitive()
  testWrongCaseWouldHaveSilentlyBrokenDecimals()
  testOtherCaseSensitivePointsInExecutionPath()
  testBanditRouteNoLongerUppercases()
}

try {
  run()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
