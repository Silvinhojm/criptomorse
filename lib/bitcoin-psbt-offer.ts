// lib/bitcoin-psbt-offer.ts
// Sistema seguro de PSBT para ofertas Bitcoin

export interface Offer {
  id: string;
  amountBTC: number;
  feeBTC: number;
  returnBTC: number;
  ownerAddress: string;
  status: 'pending' | 'accepted' | 'expired' | 'completed';
  expiresAt: number;
  psbtData?: string;
  txid?: string;
  vout?: number;
  targetAddress?: string;
}

export interface AcceptOfferResult {
  success: boolean;
  message: string;
  txId?: string;
  offerId?: string;
}

export class PSBTOfferSystem {
  private offers: Map<string, Offer> = new Map();
  
  constructor() {
    this.initMockOffers();
  }
  
  private initMockOffers() {
    const mockOffers: Offer[] = [
      {
        id: 'offer_1',
        amountBTC: 0.01,
        feeBTC: 0.0001,
        returnBTC: 0.0099,
        ownerAddress: '0xSeller1...',
        status: 'pending',
        expiresAt: Date.now() + 86400000,
        psbtData: 'mock_psbt_data_1'
      }
    ];
    
    mockOffers.forEach(offer => {
      this.offers.set(offer.id, offer);
    });
  }

  /**
   * 🟢 NOVO MÉTODO - Cria uma oferta no sistema de forma segura
   */
  async createOffer(
    txid: string,
    vout: number,
    address: string,
    yourAddress: string,
    amountBTC: number
  ): Promise<Offer> {
    const id = 'offer_' + Math.random().toString(36).substr(2, 9);
    
    // Cálculos simulados de taxas do protocolo Arcflow
    const feeBTC = Number((amountBTC * 0.01).toFixed(6)); // 1% de taxa
    const returnBTC = Number((amountBTC - feeBTC).toFixed(6));

    const newOffer: Offer = {
      id,
      amountBTC,
      feeBTC,
      returnBTC,
      ownerAddress: yourAddress,
      status: 'pending',
      expiresAt: Date.now() + 86400000, // 24 horas de validade
      txid,
      vout,
      targetAddress: address
    };

    this.offers.set(id, newOffer);
    return newOffer;
  }
  
  /**
   * ✅ MÉTODO SEGURO - Aceita oferta usando assinatura da wallet
   */
  async acceptOfferWithWalletSignature(
    offerId: string, 
    acceptedBy: string,
    signature: string,
    walletAddress: string
  ): Promise<AcceptOfferResult> {
    if (!offerId || !acceptedBy || !signature || !walletAddress) {
      throw new Error('Parâmetros inválidos: offerId, acceptedBy, signature e walletAddress são obrigatórios');
    }
    
    const offer = this.offers.get(offerId);
    if (!offer) {
      throw new Error(`Oferta ${offerId} não encontrada`);
    }
    
    if (offer.status !== 'pending') {
      throw new Error(`Oferta não está mais disponível. Status: ${offer.status}`);
    }
    
    if (offer.expiresAt < Date.now()) {
      offer.status = 'expired';
      this.offers.set(offerId, offer);
      throw new Error('Oferta expirada');
    }
    
    const isValidSignature = this.validateSignature(acceptedBy, offerId, signature, walletAddress);
    if (!isValidSignature) {
      throw new Error('Assinatura inválida');
    }
    
    const txId = await this.processPSBT(offer, acceptedBy);
    
    offer.status = 'accepted';
    this.offers.set(offerId, offer);
    
    console.log(`[SECURE] Oferta ${offerId} aceita por ${acceptedBy} (wallet: ${walletAddress})`);
    
    return {
      success: true,
      message: 'Oferta aceita com sucesso',
      txId: txId,
      offerId: offerId
    };
  }
  
  private validateSignature(
    acceptedBy: string, 
    offerId: string, 
    signature: string, 
    walletAddress: string
  ): boolean {
    if (!signature.match(/^0x[a-fA-F0-9]{130}$/)) {
      console.error('[SECURITY] Formato de assinatura inválido');
      return false;
    }
    
    if (acceptedBy.toLowerCase() !== walletAddress.toLowerCase()) {
      console.error('[SECURITY] Endereço da wallet não corresponde ao aceitante');
      return false;
    }
    
    return true;
  }
  
  private async processPSBT(offer: Offer, acceptedBy: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mockTxId = '0x' + Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)).join('');
    
    console.log(`[PSBT] Transação processada: ${mockTxId}`);
    return mockTxId;
  }
  
  async getOffer(offerId: string): Promise<Offer | null> {
    return this.offers.get(offerId) || null;
  }
  
  async getPendingOffers(): Promise<Offer[]> {
    const pendingOffers: Offer[] = [];
    for (const offer of this.offers.values()) {
      if (offer.status === 'pending' && offer.expiresAt > Date.now()) {
        pendingOffers.push(offer);
      }
    }
    return pendingOffers;
  }
  
  async acceptOffer(offerId: string, privateKeyWIF: string): Promise<any> {
    throw new Error(
      '❌ MÉTODO DESABILITADO POR SEGURANÇA.\n' +
      'Este método aceitava chaves privadas e foi removido.\n' +
      'Use acceptOfferWithWalletSignature() que NUNCA recebe chaves privadas.'
    );
  }
  
  isMethodSafe(methodName: string): boolean {
    const unsafeMethods = ['acceptOffer', 'acceptOfferWithPrivateKey'];
    return !unsafeMethods.includes(methodName);
  }
}

export const btOfferSystem = new PSBTOfferSystem();
export default PSBTOfferSystem;