// lib/bitcoin-psbt-offer.ts

export interface PSBTOffer {
  id: string;
  utxoTxid: string;
  utxoVout: number;
  ownerAddress: string;
  yourAddress: string;
  amountBTC: number;
  amountSats: number;
  feePercent: number;
  feeBTC: number;
  feeSats: number;
  returnBTC: number;
  returnSats: number;
  psbtBase64: string;
  status: 'pending' | 'accepted' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  completedAt?: number;
  txid?: string;
  signature?: string;
}

class BitcoinPSBTOfferSystem {
  private offers: Map<string, PSBTOffer> = new Map();
  private readonly FEE_PERCENT = 5;
  private readonly OFFER_EXPIRY_DAYS = 30;
  
  async createOffer(
    utxoTxid: string,
    utxoVout: number,
    ownerAddress: string,
    yourAddress: string,
    amountBTC: number
  ): Promise<PSBTOffer> {
    
    const amountSats = Math.floor(amountBTC * 1e8);
    const feeSats = Math.floor(amountSats * this.FEE_PERCENT / 100);
    const returnSats = amountSats - feeSats;
    const feeBTC = feeSats / 1e8;
    const returnBTC = returnSats / 1e8;
    
    const offerId = `offer_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const psbtData = {
      outputs: [
        { address: ownerAddress, amount: returnSats, description: "95% do valor" },
        { address: yourAddress, amount: feeSats, description: "5% de taxa" }
      ],
      inputs: [],
      feePercent: this.FEE_PERCENT
    };
    
    const psbtBase64 = Buffer.from(JSON.stringify(psbtData)).toString('base64');
    
    const offer: PSBTOffer = {
      id: offerId,
      utxoTxid,
      utxoVout,
      ownerAddress,
      yourAddress,
      amountBTC,
      amountSats,
      feePercent: this.FEE_PERCENT,
      feeBTC,
      feeSats,
      returnBTC,
      returnSats,
      psbtBase64,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    };
    
    this.offers.set(offerId, offer);
    
    console.log(`📝 Oferta criada: ${offerId} | ${amountBTC} BTC | Taxa: ${feeBTC} BTC`);
    
    return offer;
  }
  
  getOffer(offerId: string): PSBTOffer | undefined {
    return this.offers.get(offerId);
  }
  
  async acceptOffer(offerId: string, privateKeyWIF: string): Promise<{ success: boolean; txid?: string; message: string }> {
    const offer = this.offers.get(offerId);
    if (!offer) return { success: false, message: 'Oferta não encontrada' };
    
    if (offer.status !== 'pending') {
      return { success: false, message: `Oferta já ${offer.status}` };
    }
    
    if (Date.now() > offer.expiresAt) {
      offer.status = 'expired';
      return { success: false, message: 'Oferta expirada' };
    }
    
    // Simular aceite bem-sucedido
    const mockTxid = `tx_${offerId}_${Date.now()}`;
    const signature = `sig_${Date.now()}_${Math.random().toString(36)}`;
    
    offer.signature = signature;
    offer.txid = mockTxid;
    offer.status = 'completed';
    offer.completedAt = Date.now();
    
    console.log(`✅ Oferta aceita: ${offerId}`);
    console.log(`   Dono recebeu: ${offer.returnBTC} BTC (95%)`);
    console.log(`   Você recebeu: ${offer.feeBTC} BTC (5%)`);
    
    return {
      success: true,
      txid: mockTxid,
      message: `Resgate concluído! Você recebeu ${offer.returnBTC} BTC.`
    };
  }
  
  getPendingOffers(): PSBTOffer[] {
    return Array.from(this.offers.values())
      .filter(o => o.status === 'pending' && Date.now() < o.expiresAt);
  }
  
  getStats() {
    const offers = Array.from(this.offers.values());
    return {
      totalOffers: offers.length,
      totalValueBTC: offers.reduce((sum, o) => sum + o.amountBTC, 0),
      totalPendingFeesBTC: offers.filter(o => o.status === 'pending').reduce((sum, o) => sum + o.feeBTC, 0),
      totalCompletedFeesBTC: offers.filter(o => o.status === 'completed').reduce((sum, o) => sum + o.feeBTC, 0)
    };
  }
}

export const psbtOfferSystem = new BitcoinPSBTOfferSystem();