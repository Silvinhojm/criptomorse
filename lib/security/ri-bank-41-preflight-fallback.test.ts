import { realSwap } from "../real-swap-executor"

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch
  const originalVercelUrl = process.env.VERCEL_URL
  process.env.VERCEL_URL = "arcflow-ri-bank-41.vercel.app"
  // API interna indisponível (falha de rede) → stable deve cair em $1.00
  globalThis.fetch = (async () => {
    throw new Error("RI_BANK_41_NETWORK_DOWN")
  }) as typeof fetch
  try {
    const price = await realSwap.fetchTokenPrice("USDC")
    expect(price === 1.0, `USDC fallback should be 1.0, got ${price}`)
    console.log("RI_BANK_41_STABLE_FALLBACK=PASS")
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