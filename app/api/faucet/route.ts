import { NextRequest, NextResponse } from 'next/server'

const CIRCLE_FAUCET_API = 'https://api.circle.com/v1/faucet/drips'
const REQUEST_TIMEOUT = 15000

const SUPPORTED_NETWORKS = [
  'ARC-TESTNET',
  'ETH-SEPOLIA',
  'AVAX-FUJI',
  'MATIC-AMOY',
  'SOL-DEVNET',
  'ARB-SEPOLIA',
  'BASE-SEPOLIA',
] as const

type FaucetRequest = {
  address: string
  blockchain: typeof SUPPORTED_NETWORKS[number]
  native?: boolean
  usdc?: boolean
  eurc?: boolean
}

export async function GET() {
  return NextResponse.json({ configured: !!process.env.CIRCLE_API_KEY })
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.CIRCLE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CIRCLE_API_KEY não configurada. Adicione no .env.local: CIRCLE_API_KEY=seu_valor' },
        { status: 503 }
      )
    }

    const body: FaucetRequest = await req.json()

    if (!body.address || !body.blockchain) {
      return NextResponse.json(
        { error: 'address e blockchain são obrigatórios' },
        { status: 400 }
      )
    }

    if (!SUPPORTED_NETWORKS.includes(body.blockchain)) {
      return NextResponse.json(
        { error: `Rede não suportada. Suportadas: ${SUPPORTED_NETWORKS.join(', ')}` },
        { status: 400 }
      )
    }

    const payload = {
      address: body.address,
      blockchain: body.blockchain,
      native: body.native ?? true,
      usdc: body.usdc ?? true,
      eurc: body.eurc ?? true,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const res = await fetch(CIRCLE_FAUCET_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.status === 204) {
      return NextResponse.json({ success: true })
    }

    const err = await res.text()
    return NextResponse.json(
      { error: `Faucet API: ${res.status} ${err.slice(0, 300)}` },
      { status: res.status }
    )
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return NextResponse.json({ error: 'timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message ?? 'Falha interna' }, { status: 502 })
  }
}
