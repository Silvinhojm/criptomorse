export function applyCircleProxyFix(): void {
  if (typeof window === "undefined") return
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("api.circle.com")) {
      const path = url.replace("https://api.circle.com", "")
      const proxyUrl = `/api/circle-proxy${path}`
      const newInit = { ...(init ?? {}), headers: { ...((init?.headers as Record<string, string>) ?? {}) } }
      delete (newInit.headers as Record<string, string>)["x-user-agent"]
      return originalFetch(proxyUrl, { ...newInit, headers: newInit.headers })
    }
    return originalFetch(input, init)
  }
}
