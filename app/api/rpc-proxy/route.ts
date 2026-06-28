import { NextRequest, NextResponse } from 'next/server'

async function tryFetch(rpcUrl: string, body: unknown, timeoutMs: number): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`RPC returned non-JSON from ${rpcUrl}: ${text.slice(0, 100)}`)
  }
  if (data.error) {
    throw new Error(`RPC error from ${rpcUrl}: ${data.error.message ?? JSON.stringify(data.error)}`)
  }
  return data
}

export async function POST(req: NextRequest) {
  const timeoutMs = 25000
  const { rpcUrl, body, fallbacks } = await req.json()
  if (!body) {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }

  const urlsToTry: string[] = []
  if (rpcUrl) urlsToTry.push(rpcUrl)
  if (Array.isArray(fallbacks)) {
    for (const fb of fallbacks) {
      if (!urlsToTry.includes(fb)) urlsToTry.push(fb)
    }
  }

  if (urlsToTry.length === 0) {
    return NextResponse.json({ error: 'rpcUrl or fallbacks required' }, { status: 400 })
  }

  const errors: string[] = []
  for (const url of urlsToTry) {
    try {
      const data = await tryFetch(url, body, timeoutMs)
      return NextResponse.json(data)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  return NextResponse.json(
    { error: `All RPCs failed (${urlsToTry.length} tried)`, details: errors },
    { status: 502 }
  )
}
