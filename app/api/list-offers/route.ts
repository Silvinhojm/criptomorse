import { NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function GET() {
  try {
    const psbtSystem = new PSBTOfferSystem();
    const offers = await psbtSystem.getPendingOffers();

    return NextResponse.json({
      success: true,
      offers: offers.map(o => ({
        id: o.id,
        amountBTC: o.amountBTC,
        feeBTC: o.feeBTC,
        returnBTC: o.returnBTC,
        ownerAddress: o.ownerAddress,
        targetAddress: o.targetAddress,
        status: o.status,
        expiresAt: o.expiresAt,
      }))
    });
  } catch (error: any) {
    console.error('Erro ao listar ofertas:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Erro ao listar ofertas' },
      { status: 500 }
    );
  }
}
