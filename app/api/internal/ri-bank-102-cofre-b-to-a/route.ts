import { NextRequest } from "next/server"

import { getRiskBoxesState, moverCofreParaPrincipalManual, getCofreMovimentos } from "@/lib/risk-boxes"
import { isValidCronAdminRequest } from "@/lib/security/cron-auth"

// RI-BANK-102 — movimento MANUAL do cofre (Caixa B) para o principal (Caixa
// A). Regras travadas em copia10/copia11:
// - B→A é a ÚNICA porta de saída do cofre e é 100% manual: esta rota exige
//   Authorization: Bearer <ADMIN_PANIC_KEY> e nunca é acionada por automação.
// - Sem corpo: move TODO o saldo de B. Com corpo { valorUsd }: move no
//   máximo esse valor (nunca mais do que o saldo).
// - Cada movimento fica auditado (valor, timestamp, lado B_TO_A_MANUAL).
// - Perdas não geram movimento; quem decide migrar é o operador.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  let valorUsd: number | undefined
  try {
    const body = (await request.json()) as { valorUsd?: unknown }
    if (body.valorUsd !== undefined) {
      const parsed = Number(body.valorUsd)
      if (!Number.isFinite(parsed) || parsed < 0) {
        return json({ ok: false, error: "valorUsd_invalido" }, 400)
      }
      valorUsd = parsed
    }
  } catch {
    // corpo vazio/ausente → move o saldo inteiro (válido)
  }

  try {
    const estado = await moverCofreParaPrincipalManual(valorUsd)
    return json({
      ok: true,
      valorSolicitado: valorUsd ?? "todo_o_saldo",
      estadoAtual: estado,
      movimentos: getCofreMovimentos(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.error("[RI-BANK-102] cofre B→A failed", error)
    return json({ ok: false, error: "cofre_b_to_a_failed", detail: message }, 500)
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isValidCronAdminRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401)
  }
  // GET é somente leitura — nenhuma alteração de estado em método leitura.
  return json({
    ok: true,
    estadoAtual: getRiskBoxesState(),
    movimentos: getCofreMovimentos(),
  })
}