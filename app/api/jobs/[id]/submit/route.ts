import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { deliverableHash } = body;

    if (!deliverableHash) {
      return Response.json({ error: 'deliverableHash is required' }, { status: 400 });
    }

    return Response.json({
      jobId: Number(id),
      deliverableHash,
      contract: '0x0747EEf0706327138c69792bF28Cd525089e4583',
      message: 'Use MetaMask to sign the submission on Arc Testnet',
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
