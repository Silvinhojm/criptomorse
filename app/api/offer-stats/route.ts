import { NextResponse } from 'next/server';
import { PSBTOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function GET() {
  try {
    const psbtSystem = new PSBTOfferSystem();
    const offers = (psbtSystem as any).offers || [];

    const totalOffers = offers.length;
    const activeOffers = offers.filter((o: any) => o.status === 'active' || o.status === 'pending').length;
    const acceptedOffers = offers.filter((o: any) => o.status === 'accepted').length;

    return NextResponse.json({
      success: true,
      stats: {
        total: totalOffers,
        active: activeOffers,
        accepted: acceptedOffers
      }
    });
  } catch (error: any) {
    console.error('Erro ao buscar estatísticas:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Erro ao buscar estatísticas' },
      { status: 500 }
    );
  }
}