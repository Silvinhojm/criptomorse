// app/api/accept-offer/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { psbtOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { offerId, privateKeyWIF } = body;
    
    // Validar dados
    if (!offerId || !privateKeyWIF) {
      return NextResponse.json(
        { success: false, message: 'ID da oferta e chave privada são obrigatórios' },
        { status: 400 }
      );
    }
    
    // Verificar se a oferta existe
    const offer = psbtOfferSystem.getOffer(offerId);
    if (!offer) {
      return NextResponse.json(
        { success: false, message: 'Oferta não encontrada' },
        { status: 404 }
      );
    }
    
    // Aceitar oferta
    const result = await psbtOfferSystem.acceptOffer(offerId, privateKeyWIF);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        txid: result.txid,
        message: result.message
      });
    } else {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }
    
  } catch (error: any) {
    console.error('Erro ao aceitar oferta:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}