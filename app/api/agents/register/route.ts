import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { metadataURI } = body;

    if (!metadataURI || typeof metadataURI !== 'string') {
      return Response.json({ error: 'metadataURI is required' }, { status: 400 });
    }

    return Response.json({
      contract: '0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b',
      metadataURI,
      message: 'Use MetaMask to sign the registration transaction on Arc Testnet',
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
