import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = body.reason || 'deliverable-approved';

    return Response.json({
      jobId: Number(id),
      reason,
      contract: '0x0747EEf0706327138c69792bF28Cd525089e4583',
      message: 'Use MetaMask to sign the completion on Arc Testnet',
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
