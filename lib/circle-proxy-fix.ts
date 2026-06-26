// Monkey-patch global fetch to redirect api.circle.com requests to local proxy
// This avoids CORS issues with x-user-agent header on swap/bridge calls

let patched = false

export function applyCircleProxyFix() {
  if (patched || typeof globalThis === 'undefined') return
  patched = true

  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    if (url && url.startsWith('https://api.circle.com')) {
      const proxyUrl = url.replace('https://api.circle.com', '/api/circle-proxy')
      return originalFetch(proxyUrl, init)
    }
    return originalFetch(input, init)
  }
}
