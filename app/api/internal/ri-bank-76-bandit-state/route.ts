import { NextRequest, NextResponse } from "next/server"

import { ARC_BANDIT_PAIRS, readBanditState } from "@/lib/bandit-state-redis"
import { getRedis, isKvConfigured, banditStateKvKey } from "@/lib/kv"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-76 Etapa 1 — rota somente leitura, mesmo padrão de autenticação
// da RI-BANK-51 (bearer admin). Só inspeciona o estado do Bandit em Redis
// para validação manual; não aciona execução nem geração de plano nenhuma.
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
    const state = await readBanditState(getRedis(), banditStateKvKey(), ARC_BANDIT_PAIRS)
    return json({ ok: true, state, timestamp: Date.now() })
  } catch (error) {
    console.error("[RI-BANK-76] bandit state read failed", error)
    return json({
      ok: false,
      error: "bandit_state_read_failed",
      detail: error instanceof Error ? error.message : "unknown error",
    }, 500)
  }
}

export async function POST(): Promise<Response> {
  return json({ error: "method_not_allowed" }, 405)
}
