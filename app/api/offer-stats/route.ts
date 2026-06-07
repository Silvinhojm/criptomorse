// app/api/offer-stats/route.ts

import { NextResponse } from 'next/server';
import { psbtOfferSystem } from '../../../lib/bitcoin-psbt-offer';

export async function GET() {
  try {
    const stats = psbtOfferSystem.getStats();
    
    return NextResponse.json({
      success: true,
      stats: {
        totalOffers: stats.totalOffers,
        totalValueBTC: stats.totalValueBTC.toFixed(8),
        totalPendingFeesBTC: stats.totalPendingFeesBTC.toFixed(8),
        totalCompletedFeesBTC: stats.totalCompletedFeesBTC.toFixed(8)
      }
    });
    
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}