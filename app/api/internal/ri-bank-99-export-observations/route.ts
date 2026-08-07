import { NextRequest } from "next/server"

import { getRedis, isKvConfigured, readObservations } from "@/lib/ri-bank-99-collector"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-99 — rota de consulta/exportação: retorna todas as observações
// coletadas até o momento (mais antiga primeiro), para busca manual a
// qualquer momento, sem depender do computador local.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }
  if (!isKvConfigured()) {
    return json({ ok: false, error: "redis_not_configured" }, 503)
  }

  try {
    const observations = await readObservations(getRedis())
    return json({ ok: true, count: observations.length, observations })
  } catch (error) {
    console.error("[RI-BANK-99] export failed", error)
    return json({
      ok: false,
      error: "export_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}

export async function POST(): Promise<Response> {
  return json({ error: "method_not_allowed" }, 405)
}
