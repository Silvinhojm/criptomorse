import { NextRequest } from "next/server"

import {
  appendObservation,
  collectObservation,
  getRedis,
  isKvConfigured,
} from "@/lib/ri-bank-99-collector"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-99 — rota de coleta (uma leitura por chamada, read-only). Chamada
// pelo GitHub Actions schedule (a cada 15min). Persiste no Redis, nunca em
// arquivo local. Nenhuma transação é disparada: pool via eth_call, LI.Fi via
// quote, Frankfurter via GET público.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }
  if (!isKvConfigured()) {
    return json({ ok: false, error: "redis_not_configured" }, 503)
  }

  try {
    const obs = await collectObservation(0)
    const length = await appendObservation(getRedis(), obs)
    return json({ ok: true, observation: obs, totalObservations: length })
  } catch (error) {
    console.error("[RI-BANK-99] collect failed", error)
    return json({
      ok: false,
      error: "collect_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}

export async function GET(): Promise<Response> {
  return json({ error: "method_not_allowed" }, 405)
}
