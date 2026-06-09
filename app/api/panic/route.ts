import { NextRequest, NextResponse } from 'next/server';
import { getCircuitBreakerState, activatePanic, resumeFromPanic } from '@/lib/circuit-breaker';

const ADMIN_PANIC_KEY = process.env.ADMIN_PANIC_KEY || "arcflow-master-key-2024";

export async function GET() {
  return NextResponse.json(getCircuitBreakerState());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, key } = body;
    if (key !== ADMIN_PANIC_KEY) {
      return NextResponse.json({ error: 'Chave inválida' }, { status: 401 });
    }
    if (action === 'panic') {
      activatePanic(body.reason || 'Ação manual');
      return NextResponse.json({ success: true, state: getCircuitBreakerState() });
    }
    if (action === 'resume') {
      resumeFromPanic();
      return NextResponse.json({ success: true, state: getCircuitBreakerState() });
    }
    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
