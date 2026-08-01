import { NextRequest, NextResponse } from 'next/server';
import { getCircuitBreakerState, activatePanic, resumeFromPanic } from '@/lib/circuit-breaker';
import { timingSafeEqualStrings } from '@/lib/security/timing-safe-compare';

// RI-BANK-4 Stage 2 fix: this used to fall back to a hardcoded default
// ("arcflow-master-key-2024") when ADMIN_PANIC_KEY wasn't set in the
// environment — anyone reading this file (or the repo) then knew the key
// that arms/disarms the panic kill switch. No fallback now: if the env var
// is missing, every request is rejected, never silently accepted.
const ADMIN_PANIC_KEY = process.env.ADMIN_PANIC_KEY;

export async function GET() {
  return NextResponse.json(getCircuitBreakerState());
}

export async function POST(request: NextRequest) {
  try {
    if (!ADMIN_PANIC_KEY) {
      return NextResponse.json({ error: 'ADMIN_PANIC_KEY não configurada no ambiente' }, { status: 401 });
    }
    const body = await request.json();
    const { action, key } = body;
    if (typeof key !== 'string' || !timingSafeEqualStrings(key, ADMIN_PANIC_KEY)) {
      return NextResponse.json({ error: 'Chave inválida' }, { status: 401 });
    }
    if (action === 'panic') {
      await activatePanic(body.reason || 'Ação manual');
      return NextResponse.json({ success: true, state: getCircuitBreakerState() });
    }
    if (action === 'resume') {
      await resumeFromPanic();
      return NextResponse.json({ success: true, state: getCircuitBreakerState() });
    }
    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
