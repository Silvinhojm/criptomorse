// BLOQUEIO TEMPORÁRIO (RI-BANK-2) — esta rota assinava e enviava transações
// on-chain reais com a PRIVATE_KEY do servidor sem nenhum controle de
// acesso. Bloqueada incondicionalmente até uma solução de autenticação
// real ser desenhada. Não remover sem decisão explícita equivalente.
function blocked() {
  return Response.json(
    { error: "Rota desativada temporariamente por bloqueio de segurança." },
    { status: 403 },
  );
}

export const GET = blocked;
export const POST = blocked;
export const PUT = blocked;
export const PATCH = blocked;
export const DELETE = blocked;
export const HEAD = blocked;
export const OPTIONS = blocked;
