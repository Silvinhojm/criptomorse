import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { metadataURI } = body;

    if (!metadataURI || typeof metadataURI !== 'string') {
      return Response.json({ error: 'metadataURI is required' }, { status: 400 });
    }

    return Response.json({
      contract: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      metadataURI,
      message: 'Use MetaMask to sign the registration transaction on Arc Testnet',
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
