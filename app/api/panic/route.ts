// app/api/panic/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { circuitBreaker } from '@/lib/circuit-breaker';

export async function POST(req: NextRequest) {
  try {
    const { action, reason, adminKey } = await req.json();
    
    if (action === 'activate') {
      const result = circuitBreaker.activatePanic(reason || 'Manual panic activation', adminKey);
      return NextResponse.json(result);
    }
    
    if (action === 'deactivate') {
      const result = circuitBreaker.deactivatePanic(adminKey);
      return NextResponse.json(result);
    }
    
    return NextResponse.json({ error: 'Invalid action. Use "activate" or "deactivate"' }, { status: 400 });
    
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process panic action' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(circuitBreaker.getState());
}
