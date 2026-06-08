// app/api/create-offer/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { treasure, yourAddress } = body;
    
    // Validar dados recebidos
    if (!treasure || !yourAddress) {
      return NextResponse.json(
        { success: false, message: 'Dados incompletos' },
        { status: 400 }
      );
    }
    
    // Instanciar o sistema de ofertas PSBT do Bitcoin
    const psbtSystem = new PSBTOfferSystem();
    
    // Criar oferta utilizando a instância e o método correto do sistema
    const offer = await psbtSystem.createOffer(
      treasure.txid,
      treasure.vout,
      treasure.address,
      yourAddress,
      treasure.amountBTC
    );
    
    // Criar link de aceite
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const acceptLink = `${baseUrl}/accept-offer?id=${offer.id}`;
    
    return NextResponse.json({
      success: true,
      offer: {
        id: offer.id,
        amountBTC: offer.amountBTC,
        feeBTC: offer.feeBTC,
        returnBTC: offer.returnBTC,
        ownerAddress: offer.ownerAddress,
        expiresAt: offer.expiresAt,
        acceptLink: acceptLink
      },
      message: `Oferta criada com sucesso! Compartilhe: ${acceptLink}`
    });
    
  } catch (error: any) {
    console.error('Erro ao criar oferta:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}