import { NextRequest, NextResponse } from 'next/server'

const CIRCLE_API_FAUCET = 'https://api.circle.com/v1/faucet/drips'
const PUBLIC_FAUCET_GRAPHQL = 'https://faucet.circle.com/api/graphql'
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
  cirbtc?: boolean
}

/** Tenta a API oficial Circle (/v1/faucet/drips) — requer chave mainnet */
async function tryCircleApi(body: FaucetRequest): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey || apiKey.startsWith('TEST_API_KEY')) {
    return { ok: false, error: 'API key sandbox — faucet requer chave mainnet' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const res = await fetch(CIRCLE_API_FAUCET, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        address: body.address,
        blockchain: body.blockchain,
        native: body.native ?? true,
        usdc: body.usdc ?? true,
        eurc: body.eurc ?? true,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.status === 204) return { ok: true }
    const err = await res.text()
    return { ok: false, error: `API Circle: ${res.status} ${err.slice(0, 200)}` }
  } catch (e: any) {
    clearTimeout(timeoutId)
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : e?.message }
  }
}

/** Fallback: tenta o faucet público via GraphQL (funciona sem API key) */
async function tryPublicFaucet(body: FaucetRequest): Promise<{ ok: boolean; error?: string }> {
  const tokens: string[] = []
  if (body.usdc ?? true) tokens.push('USDC')
  if (body.eurc ?? true) tokens.push('EURC')
  if (body.cirbtc ?? true) tokens.push('CIRBTC')
  if (tokens.length === 0) tokens.push('USDC')

  const networkMap: Record<string, string> = {
    'ARC-TESTNET': 'ARC',
    'ETH-SEPOLIA': 'ETH-SEPOLIA',
    'AVAX-FUJI': 'AVAX-FUJI',
    'MATIC-AMOY': 'MATIC-AMOY',
    'SOL-DEVNET': 'SOL-DEVNET',
    'ARB-SEPOLIA': 'ARB-SEPOLIA',
    'BASE-SEPOLIA': 'BASE-SEPOLIA',
  }
  const blockchain = networkMap[body.blockchain] || body.blockchain

  const results: string[] = []
  for (const token of tokens) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(PUBLIC_FAUCET_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation RequestToken($input: RequestTokenInput!) {
            requestToken(input: $input) { status amount hash explorerLink }
          }`,
          variables: {
            input: { destinationAddress: body.address, token, blockchain }
          }
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        const data = await res.json()
        if (data?.data?.requestToken?.status === 'ok' || data?.data?.requestToken?.hash) {
          results.push(`${token}: ✅`)
        } else {
          results.push(`${token}: ❌ ${data?.data?.requestToken?.status || 'recusado'}`)
        }
      } else {
        const text = await res.text()
        results.push(`${token}: ❌ HTTP ${res.status}`)
      }
    } catch {
      results.push(`${token}: ❌ erro de rede`)
    }
  }

  const allOk = results.every(r => r.includes('✅'))
  return {
    ok: allOk,
    error: allOk ? undefined : `Resultados: ${results.join(' · ')}`,
  }
}

export async function GET() {
  const apiKey = process.env.CIRCLE_API_KEY
  const hasMainnetKey = !!apiKey && !apiKey.startsWith('TEST_API_KEY')
  return NextResponse.json({
    configured: hasMainnetKey,
    publicFaucet: true,
    faucetUrl: 'https://faucet.circle.com',
  })
}

export async function POST(req: NextRequest) {
  try {
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

    // Layer 1: API oficial Circle (requer chave mainnet)
    const apiResult = await tryCircleApi(body)
    if (apiResult.ok) {
      return NextResponse.json({ success: true, method: 'circle-api' })
    }

    // Layer 2: Faucet público via GraphQL
    const publicResult = await tryPublicFaucet(body)
    if (publicResult.ok) {
      return NextResponse.json({ success: true, method: 'public-faucet' })
    }

    // Layer 3: Both failed — retorna erro + link
    return NextResponse.json({
      error: `API: ${apiResult.error}. Público: ${publicResult.error}`,
      faucetUrl: `https://faucet.circle.com/`,
      method: 'failed',
    }, { status: 502 })

  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Falha interna' }, { status: 502 })
  }
}
