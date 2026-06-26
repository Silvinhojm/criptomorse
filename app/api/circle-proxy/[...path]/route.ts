import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  return proxyCircle(req)
}

export async function POST(req: NextRequest) {
  return proxyCircle(req)
}

async function proxyCircle(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const path = url.pathname.replace("/api/circle-proxy", "")
    const circleUrl = `https://api.circle.com${path}${url.search}`

    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === "host" || lower === "origin" || lower === "referer" || lower === "x-user-agent") return
      headers[key] = value
    })

    const res = await fetch(circleUrl, {
      method: req.method,
      headers,
      body: req.method === "GET" ? undefined : await req.text(),
      signal: AbortSignal.timeout(30000),
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}
