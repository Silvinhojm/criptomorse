// Proxy server-side para ArcScan API
// Elimina erros 422 no console do navegador

import { NextRequest, NextResponse } from "next/server"

const ARSCAN_BASE = "https://testnet.arcscan.app/api/v2"

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || ""
  const url = `${ARSCAN_BASE}${path}`

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      // Fallback silencioso — retorna dados vazios em vez de 422
      return NextResponse.json({ items: [] })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    // Timeout ou erro de rede — retorna vazio
    return NextResponse.json({ items: [] })
  }
}
