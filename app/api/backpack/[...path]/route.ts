import { NextRequest, NextResponse } from 'next/server'

const BACKPACK_API = 'https://api.backpack.exchange'
const REQUEST_TIMEOUT = 15000

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: segments } = await params
    const path = segments.join('/')
    const search = req.nextUrl.search
    const url = `${BACKPACK_API}/${path}${search}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (res.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: err.slice(0, 500) }, { status: res.status })
    }

    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return NextResponse.json({ error: 'timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 502 })
  }
}
