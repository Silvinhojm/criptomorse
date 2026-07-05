// Trading module — auto-contido, sem interferir no sistema EVM
import { SOLANA_CONFIG } from "./config"

export interface SwapQuote {
  inAmount: number
  outAmount: number
  route: string
  priceImpact: number
}

export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: number,
): Promise<SwapQuote | null> {
  try {
    const url = `${SOLANA_CONFIG.jupiterApi}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=50`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return {
      inAmount: amountRaw,
      outAmount: Number(data.outAmount),
      route: data.routePlan?.map((r: any) => r.swapInfo?.label ?? "?").join(" → ") ?? "Jupiter",
      priceImpact: data.priceImpactPct ?? 0,
    }
  } catch {
    return null
  }
}

export async function buildSwapTx(
  inputMint: string,
  outputMint: string,
  amountRaw: number,
  userPublicKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${SOLANA_CONFIG.jupiterApi}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: { inputMint, outputMint, amount: amountRaw },
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.swapTransaction ?? null
  } catch {
    return null
  }
}
