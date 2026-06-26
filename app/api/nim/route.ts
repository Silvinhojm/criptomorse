import { NextRequest } from 'next/server';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model, messages, temperature = 0.3, max_tokens = 256 } = body;

    if (!NVIDIA_API_KEY) {
      return Response.json({ error: 'NVIDIA_API_KEY not configured' }, { status: 500 });
    }

    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'nvidia/nemotron-3-nano-30b-a3b',
        messages,
        temperature,
        max_tokens,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `NVIDIA API ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
