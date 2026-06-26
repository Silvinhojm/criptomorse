export function applyCircleProxyFix(): void {
  if (typeof window === "undefined") return
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("/api/circle-proxy")) return originalFetch(input, init)
    if (url.includes("api.circle.com") || url.includes("gateway-api.circle.com")) {
      const u = new URL(url)
      const proxyUrl = `/api/circle-proxy${u.pathname}${u.search}`
      const newHeaders: Record<string, string> = {}
      if (init?.headers) {
        const h = init.headers as Record<string, string>
        for (const [k, v] of Object.entries(h)) {
          if (k.toLowerCase() !== "x-user-agent") newHeaders[k] = v
        }
      }
      return originalFetch(proxyUrl, { ...init, headers: newHeaders })
    }
    return originalFetch(input, init)
  }
}
