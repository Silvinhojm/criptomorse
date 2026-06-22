import { NextRequest, NextResponse } from 'next/server'

const LI_FI_API = 'https://li.quest/v1'
const REQUEST_TIMEOUT = 15000

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams.toString()
    const url = `${LI_FI_API}/quote?${searchParams}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (res.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: err.slice(0, 500) }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return NextResponse.json({ error: 'timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 502 })
  }
}
