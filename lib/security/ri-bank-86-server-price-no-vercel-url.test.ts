// RI-BANK-86 — reproduz o cenário de falha do RI-BANK-85: um plano real
// cirBTC→USDC foi bloqueado por "saldo insuficiente: $0,0000" apesar do
// saldo real (0,0002 cirBTC) estar correto. A causa suspeita era
// `VERCEL_URL` ausente/malformado quebrando `buildVercelInternalUrl()`,
// fazendo o preço nunca ser buscado. Investigação adicional (RI-BANK-86)
// encontrou uma contraevidência: `/api/rpc-proxy` usa exatamente a mesma
// função para leitura de saldo, e isso funciona de forma confiável em
// produção (confirmado por várias execuções reais bem-sucedidas nesta
// sessão) -- então "VERCEL_URL ausente" não é a explicação completa.
// Independente da causa exata, fazer um serverless function chamar a si
// mesmo via HTTP pra buscar preço é uma classe inteira de fragilidade
// (resolução de URL, timeout ausente, self-call de função pra função) que
// a correção elimina de vez: o caminho server-side agora resolve preço EM
// PROCESSO (lib/sosovalue-price-agent.ts's resolvePriceWithFallback()),
// sem fetch() nenhum, então funciona corretamente independente do estado
// de VERCEL_URL.
//
// Estes testes mockam apenas o fetch() para a API externa da SoSoValue
// (dentro de sosovalue-price-agent.ts) -- nenhuma rede real, nenhum
// self-call, nenhuma dependência de VERCEL_URL.

import { realSwap } from "../real-swap-executor"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function expectClose(actual: number, expected: number, message: string, epsilon = 1e-6): void {
  expect(Math.abs(actual - expected) < epsilon, `${message} (actual=${actual}, expected=${expected})`)
}

// RealSwapExecutor.priceCache (por símbolo) e o cache interno de
// sosovalue-price-agent.ts (por coinId) têm TTL de 15s -- para evitar que
// um teste silenciosamente reaproveite o resultado cacheado de outro
// (mascarando se o mock de fato foi exercitado), cada cenário abaixo usa um
// token/coinId DIFERENTE, exceto o cenário final, que usa "cirBTC"
// especificamente (o par real do RI-BANK-85) e roda isolado, sem nenhum
// teste anterior tocando o mesmo coinId (BTC).
function withMockedSosoFetch<T>(
  responder: (url: string) => { ok: boolean; body?: unknown; throwError?: Error },
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = async (input: string | URL | Request) => {
    const url = String(input)
    const r = responder(url)
    if (r.throwError) throw r.throwError
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    })
  }
  return fn().finally(() => {
    globalThis.fetch = originalFetch
  })
}

// ── Cenário 1: VERCEL_URL completamente ausente -- o preço server-side
// ainda deve ser resolvido corretamente, porque não depende mais dele. ────
async function testServerPriceResolvesWithoutVercelUrl(): Promise<void> {
  const original = process.env.VERCEL_URL
  delete process.env.VERCEL_URL

  try {
    // WETH (coinId próprio, nunca tocado por outro teste aqui) -- não é o
    // par real do bug, só prova o mecanismo geral: preço server-side
    // resolvido corretamente mesmo sem VERCEL_URL.
    const price = await withMockedSosoFetch(
      () => ({
        ok: true,
        body: { data: { price: 1850, change_pct_24h: 1.2 } },
      }),
      () => realSwap.fetchTokenPrice("WETH"),
    )
    expect(price === 1850, `expected the real SoSoValue price (1850) to resolve even with VERCEL_URL missing, got ${price}`)
    console.log(`RI_BANK_86_SERVER_PRICE_RESOLVES_WITHOUT_VERCEL_URL=PASS (price=${price})`)
  } finally {
    if (original === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = original
  }
}

// ── Cenário 2: VERCEL_URL presente mas malformado (não bate no regex
// .vercel.app que buildVercelInternalUrl() exigia) -- mesmo resultado. ────
async function testServerPriceResolvesWithMalformedVercelUrl(): Promise<void> {
  const original = process.env.VERCEL_URL
  process.env.VERCEL_URL = "not-a-real-vercel-host"

  try {
    // ARB (coinId genuinamente distinto -- WBTC foi descartado aqui de
    // propósito: coin-ids.ts mapeia WBTC pro MESMO coinId do BTC que
    // cirBTC usa, o que colidiria com o cache do cenário 3 abaixo) --
    // mesmo raciocínio do cenário anterior, com VERCEL_URL malformado em
    // vez de ausente.
    const price = await withMockedSosoFetch(
      () => ({ ok: true, body: { data: { price: 0.55, change_pct_24h: 1.2 } } }),
      () => realSwap.fetchTokenPrice("ARB"),
    )
    expect(price === 0.55, `expected the real price to resolve even with a malformed VERCEL_URL, got ${price}`)
    console.log("RI_BANK_86_SERVER_PRICE_RESOLVES_WITH_MALFORMED_VERCEL_URL=PASS")
  } finally {
    if (original === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = original
  }
}

// ── Cenário 3: a API externa (SoSoValue) falha -- o fallback correto é
// FALLBACK_PRICES (68000 pro id do BTC/cirBTC), NUNCA o zero cego que
// bloqueou o trade real do RI-BANK-85. Confirma também que isso já é
// suficiente para passar no preflight de saldo mínimo real. ───────────────
async function testFallsBackToRealFallbackPriceNotZero(): Promise<void> {
  const price = await withMockedSosoFetch(
    () => ({ throwError: new Error("simulated SoSoValue upstream failure") }),
    () => realSwap.fetchTokenPrice("cirBTC"),
  )
  expect(price === 68000, `expected the fallback price table (68000 for BTC/cirBTC) when the upstream API fails, got ${price} -- returning 0 here is exactly the RI-BANK-85 bug`)

  // Mesma fórmula do preflight real (lib/real-swap-executor.ts:~1076-1092):
  // fromBalanceUsd = fromBalance * fromPrice; precisa ser >= amountUsd*0.95.
  const realCirbtcBalance = 0.0002 // confirmado on-chain no RI-BANK-84
  const fromBalanceUsd = realCirbtcBalance * price
  const amountUsd = 0.10
  expect(fromBalanceUsd >= amountUsd * 0.95, `expected $${fromBalanceUsd.toFixed(4)} (0.0002 cirBTC * $${price}) to clear the $${(amountUsd * 0.95).toFixed(4)} minimum -- this is exactly the trade RI-BANK-85 found blocked at $0.0000`)

  console.log(`RI_BANK_86_FALLBACK_IS_REAL_PRICE_NOT_ZERO=PASS (price=${price}, fromBalanceUsd=$${fromBalanceUsd.toFixed(4)})`)
}

// ── Confirma que o caminho do navegador (client-side) continua intocado --
// checagem estática de código-fonte, mesmo padrão de
// ri-bank-39-manual-test-route.test.ts / ri-bank-83-token-case-fix.test.ts. ─
function testBrowserPathStillUsesRelativeFetch(): void {
  const { readFileSync } = require("node:fs")
  const { join } = require("node:path")
  const source = readFileSync(join(__dirname, "..", "real-swap-executor.ts"), "utf8") as string
  expect(source.includes('typeof window === "undefined"'), "expected the server/browser branch to still exist")
  expect(source.includes("resolvePriceWithFallback(coinId)"), "expected the server-side branch to call the in-process resolver")
  // O branch de navegador (else / typeof window !== "undefined") continua
  // montando a URL relativa e usando fetch() -- não foi tocado.
  const browserBranchIndex = source.indexOf('const priceUrl = `/api/price?ids=${coinId}`;')
  expect(browserBranchIndex > -1, "expected the browser-side relative-URL fetch to still be present, unmodified")
  console.log("RI_BANK_86_BROWSER_PATH_UNCHANGED=PASS")
}

async function run(): Promise<void> {
  await testServerPriceResolvesWithoutVercelUrl()
  await testServerPriceResolvesWithMalformedVercelUrl()
  await testFallsBackToRealFallbackPriceNotZero()
  testBrowserPathStillUsesRelativeFetch()
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
