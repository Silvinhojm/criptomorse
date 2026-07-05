// Cliente Solana via RPC JSON — sem dependência @solana/web3.js
import { SOLANA_CONFIG } from "./config"

export class SolanaClient {
  private rpc: string

  constructor(rpcUrl?: string) {
    this.rpc = rpcUrl ?? SOLANA_CONFIG.rpcUrl
  }

  private async call(method: string, params: unknown[] = []): Promise<any> {
    const res = await fetch(this.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
    if (!res.ok) throw new Error(`Solana RPC ${res.status}: ${res.statusText}`)
    const data = await res.json()
    if (data.error) throw new Error(`Solana RPC error: ${data.error.message}`)
    return data.result
  }

  async getBalance(address: string): Promise<number> {
    const lamports: number = await this.call("getBalance", [address])
    return lamports / 1e9
  }

  async getTokenBalance(wallet: string, mint: string): Promise<number> {
    try {
      const accounts = await this.call("getTokenAccountsByOwner", [
        wallet,
        { mint },
        { encoding: "jsonParsed" },
      ])
      if (!accounts?.value?.length) return 0
      const info = accounts.value[0].account.data.parsed.info
      return Number(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals)
    } catch {
      return 0
    }
  }

  async getTokenPrice(mintA: string, mintB: string): Promise<number | null> {
    try {
      const res = await fetch(`${SOLANA_CONFIG.jupiterApi}/quote?inputMint=${mintA}&outputMint=${mintB}&amount=1000000&slippageBps=50`)
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.outAmount) return null
      return Number(data.outAmount) / 1e6 / (1e6 / 1e6)
    } catch {
      return null
    }
  }
}

export const solanaClient = new SolanaClient()
