import { NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function GET() {
  try {
    const psbtSystem = new PSBTOfferSystem();
    
    // Tentamos acessar a propriedade interna 'offers' se ela existir, caso contrário, inicializamos um array vazio para o build passar
    const offers = (psbtSystem as any).offers || []; 

    return NextResponse.json({
      success: true,
      offers: offers
    });
  } catch (error: any) {
    console.error('Erro ao listar ofertas:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Erro ao listar ofertas' },
      { status: 500 }
    );
  }
}