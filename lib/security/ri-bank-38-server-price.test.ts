import { realSwap } from "../real-swap-executor"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

// RI-BANK-38 originalmente confirmava que o preço buscado server-side usava
// uma URL ABSOLUTA (via VERCEL_URL) em vez de relativa (que falha
// server-side, sem um DOM/base URL). RI-BANK-86 foi além: descobriu que
// mesmo a URL absoluta (um serverless function chamando a si mesmo via
// HTTP) é uma classe inteira de fragilidade -- e eliminou o self-call por
// completo. O caminho server-side agora resolve preço EM PROCESSO
// (lib/sosovalue-price-agent.ts's resolvePriceWithFallback()), sem fetch()
// nenhum pra própria aplicação -- só o fetch direto pra API externa da
// SoSoValue. Este teste foi atualizado para refletir isso: já não faz
// sentido afirmar "a URL do server deve ser absoluta" quando não há mais
// URL nenhuma da aplicação envolvida nesse caminho.
async function run(): Promise<void> {
  const originalFetch = globalThis.fetch
  let requestedUrl = ""

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify({
      data: { price: 1, change_pct_24h: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch

  try {
    const price = await realSwap.fetchTokenPrice("USDC")
    expect(price === 1, `server price should be 1, received ${price}`)
    expect(
      requestedUrl.startsWith("https://openapi.sosovalue.com/"),
      `server-side price resolution should call the upstream SoSoValue API directly (in-process, RI-BANK-86), not any URL of this application, received ${requestedUrl}`,
    )
    console.log("RI_BANK_38_SERVER_PRICE=PASS")
    console.log("RI_BANK_38_ABSOLUTE_PRICE_URL=PASS")
  } finally {
    globalThis.fetch = originalFetch
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
