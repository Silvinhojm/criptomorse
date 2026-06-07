// app/api/list-offers/route.ts

import { NextResponse } from 'next/server';
import { psbtOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function GET() {
  try {
    const offers = psbtOfferSystem.getPendingOffers();
    
    const formattedOffers = offers.map(offer => ({
      id: offer.id,
      amountBTC: offer.amountBTC,
      feeBTC: offer.feeBTC,
      returnBTC: offer.returnBTC,
      ownerAddress: offer.ownerAddress.substring(0, 16) + '...',
      expiresAt: new Date(offer.expiresAt).toLocaleString(),
      acceptLink: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/accept-offer?id=${offer.id}`
    }));
    
    return NextResponse.json({
      success: true,
      count: formattedOffers.length,
      offers: formattedOffers
    });
    
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}