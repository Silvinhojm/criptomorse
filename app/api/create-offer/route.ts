import { NextRequest, NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { offerId, acceptedBy, signature, walletAddress } = body;

    if (!offerId || !acceptedBy || !signature || !walletAddress) {
      return NextResponse.json(
        { success: false, message: 'Parâmetros incompletos.' },
        { status: 400 }
      );
    }

    const psbtSystem = new PSBTOfferSystem();
    const offer = await psbtSystem.getOffer(offerId);
    
    if (!offer) {
      return NextResponse.json(
        { success: false, message: `Oferta ${offerId} não encontrada` },
        { status: 404 }
      );
    }

    const result = await psbtSystem.acceptOfferWithWalletSignature(
      offerId,
      acceptedBy,
      signature,
      walletAddress
    );

    return NextResponse.json({
      success: true,
      message: result?.message || 'Oferta processada com sucesso',
      txId: result?.txId || 'N/A',
      data: {
        id: offer.id,
        amountBTC: offer.amountBTC,
        feeBTC: offer.feeBTC,
        returnBTC: offer.returnBTC,
        ownerAddress: offer.ownerAddress,
        status: 'accepted',
        expiresAt: offer.expiresAt
      }
    });

  } catch (error: any) {
    console.error('Erro ao aceitar oferta:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Erro interno no servidor' },
      { status: 500 }
    );
  }
}