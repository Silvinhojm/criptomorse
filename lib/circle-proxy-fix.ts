// lib/circle-proxy-fix.ts
// Stub: aplica correção de proxy para Circle API (evita CORS em ambiente de desenvolvimento)
export function applyCircleProxyFix(): void {
  // Aplica patch no fetch para redirecionar chamadas Circle via proxy local
  if (typeof window === "undefined") return
  // No-op: o proxy já é tratado via /api/circle-proxy no servidor
}
