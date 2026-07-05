import { NextRequest, NextResponse } from "next/server"

const RPC_URL = "https://api.mainnet-beta.solana.com"
const JUPITER_API = "https://quote-api.jup.ag/v6"

export async function POST(req: NextRequest) {
  try {
    const { method, params, jupiter } = await req.json()

    if (jupiter) {
      const url = `${JUPITER_API}/${jupiter}`
      const res = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      return NextResponse.json(data)
    }

    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}
