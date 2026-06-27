import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { rpcUrl, body } = await req.json()
    if (!rpcUrl || !body) {
      return NextResponse.json({ error: 'rpcUrl and body required' }, { status: 400 })
    }

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    })

    const text = await res.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'RPC returned non-JSON', raw: text.slice(0, 200) }, { status: 502 })
    }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
