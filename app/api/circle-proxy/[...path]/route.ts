import { NextRequest, NextResponse } from 'next/server'

const CIRCLE_API = 'https://api.circle.com'
const REQUEST_TIMEOUT = 30000

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET')
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST')
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req, 'PUT')
}

export async function PATCH(req: NextRequest) {
  return proxyRequest(req, 'PATCH')
}

export async function DELETE(req: NextRequest) {
  return proxyRequest(req, 'DELETE')
}

async function proxyRequest(req: NextRequest, method: string) {
  try {
    const path = req.nextUrl.pathname.replace('/api/circle-proxy', '')
    const searchParams = req.nextUrl.searchParams.toString()
    const url = `${CIRCLE_API}${path}${searchParams ? `?${searchParams}` : ''}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === 'host') return
      headers[key] = value
    })

    let body: BodyInit | undefined
    if (method !== 'GET' && method !== 'DELETE') {
      try {
        const raw = await req.text()
        if (raw) body = raw
        else console.log('[CircleProxy] empty body for', url)
      } catch (e) {
        console.warn(`[CircleProxy] body read error:`, e?.message)
        body = '{}'
      }
    }

    console.log(`[CircleProxy] ${method} ${path}: forwarding to Circle (body=${body ? body.length : 0} chars)`)

    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e: any) {
    console.error(`[CircleProxy] ${req.method} ${req.nextUrl.pathname}:`, e?.message ?? e, e?.cause ?? '')
    if (e?.name === 'AbortError') {
      return NextResponse.json({ error: 'timeout', detail: `upstream timeout after ${REQUEST_TIMEOUT}ms` }, { status: 504 })
    }
    const detail = e?.cause ? `cause=${e.cause?.code ?? e.cause}` : e?.message ?? 'unknown'
    return NextResponse.json({ error: e?.message ?? 'unknown', detail }, { status: 502 })
  }
}
