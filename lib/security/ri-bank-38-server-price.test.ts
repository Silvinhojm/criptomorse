import { realSwap } from "../real-swap-executor"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch
  const originalVercelUrl = process.env.VERCEL_URL
  let requestedUrl = ""

  process.env.VERCEL_URL = "arcflow-ri-bank-38.vercel.app"
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify({
      prices: { "1673723677362319870": 1 },
      change24h: { "1673723677362319870": 0 },
    }), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch

  try {
    const price = await realSwap.fetchTokenPrice("USDC")
    expect(price === 1, `server price should be 1, received ${price}`)
    expect(
      requestedUrl === "https://arcflow-ri-bank-38.vercel.app/api/price?ids=1673723677362319870",
      `server request must be absolute, received ${requestedUrl}`,
    )
    console.log("RI_BANK_38_SERVER_PRICE=PASS")
    console.log("RI_BANK_38_ABSOLUTE_PRICE_URL=PASS")
  } finally {
    globalThis.fetch = originalFetch
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = originalVercelUrl
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
