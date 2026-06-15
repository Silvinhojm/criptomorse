import { NextRequest, NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { txid, vout, address, yourAddress, amountBTC } = body;

    if (!txid || vout === undefined || !address || !yourAddress || !amountBTC) {
      return NextResponse.json(
        { success: false, message: 'Parâmetros obrigatórios: txid, vout, address, yourAddress, amountBTC' },
        { status: 400 }
      );
    }

    if (amountBTC <= 0 || amountBTC > 21_000_000) {
      return NextResponse.json(
        { success: false, message: 'amountBTC inválido' },
        { status: 400 }
      );
    }

    const psbtSystem = new PSBTOfferSystem();
    const offer = await psbtSystem.createOffer(txid, vout, address, yourAddress, amountBTC);

    return NextResponse.json({
      success: true,
      message: 'Oferta criada com sucesso',
      offer: {
        id: offer.id,
        amountBTC: offer.amountBTC,
        feeBTC: offer.feeBTC,
        returnBTC: offer.returnBTC,
        ownerAddress: offer.ownerAddress,
        targetAddress: offer.targetAddress,
        status: offer.status,
        expiresAt: offer.expiresAt,
        txid: offer.txid,
        vout: offer.vout,
      }
    });

  } catch (error: any) {
    console.error('Erro ao criar oferta:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Erro interno no servidor' },
      { status: 500 }
    );
  }
}
