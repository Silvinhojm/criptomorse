// lib/bitcoin-psbt-offer.ts
// Sistema seguro de PSBT para ofertas Bitcoin

export interface Offer {
  id: string;
  amount: number;
  price: number;
  seller: string;
  status: 'pending' | 'accepted' | 'expired' | 'completed';
  expiresAt: number;
  psbtData?: string;
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
    // Inicializar com algumas ofertas de exemplo
    this.initMockOffers();
  }
  
  private initMockOffers() {
    const mockOffers: Offer[] = [
      {
        id: 'offer_1',
        amount: 0.01,
        price: 45000,
        seller: '0xSeller1...',
        status: 'pending',
        expiresAt: Date.now() + 86400000, // 24 horas
        psbtData: 'mock_psbt_data_1'
      },
      {
        id: 'offer_2',
        amount: 0.05,
        price: 44800,
        seller: '0xSeller2...',
        status: 'pending',
        expiresAt: Date.now() + 172800000, // 48 horas
        psbtData: 'mock_psbt_data_2'
      },
      {
        id: 'offer_3',
        amount: 0.1,
        price: 45500,
        seller: '0xSeller3...',
        status: 'pending',
        expiresAt: Date.now() + 3600000, // 1 hora
        psbtData: 'mock_psbt_data_3'
      }
    ];
    
    mockOffers.forEach(offer => {
      this.offers.set(offer.id, offer);
    });
  }
  
  /**
   * ✅ MÉTODO SEGURO - Aceita oferta usando assinatura da wallet
   * NUNCA recebe chaves privadas diretamente
   */
  async acceptOfferWithWalletSignature(
    offerId: string, 
    acceptedBy: string,
    signature: string,
    walletAddress: string
  ): Promise<AcceptOfferResult> {
    
    // 1. Validar parâmetros
    if (!offerId || !acceptedBy || !signature || !walletAddress) {
      throw new Error('Parâmetros inválidos: offerId, acceptedBy, signature e walletAddress são obrigatórios');
    }
    
    // 2. Verificar se a oferta existe
    const offer = this.offers.get(offerId);
    if (!offer) {
      throw new Error(`Oferta ${offerId} não encontrada`);
    }
    
    // 3. Verificar se a oferta ainda está pendente
    if (offer.status !== 'pending') {
      throw new Error(`Oferta não está mais disponível. Status: ${offer.status}`);
    }
    
    // 4. Verificar se não expirou
    if (offer.expiresAt < Date.now()) {
      offer.status = 'expired';
      this.offers.set(offerId, offer);
      throw new Error('Oferta expirada');
    }
    
    // 5. Validar assinatura (simulação - em produção usar biblioteca de criptografia)
    const isValidSignature = this.validateSignature(acceptedBy, offerId, signature, walletAddress);
    if (!isValidSignature) {
      throw new Error('Assinatura inválida');
    }
    
    // 6. Processar o PSBT (Partially Signed Bitcoin Transaction)
    const txId = await this.processPSBT(offer, acceptedBy);
    
    // 7. Atualizar status da oferta
    offer.status = 'accepted';
    this.offers.set(offerId, offer);
    
    // 8. Registrar log seguro (sem chaves privadas)
    console.log(`[SECURE] Oferta ${offerId} aceita por ${acceptedBy} (wallet: ${walletAddress})`);
    
    return {
      success: true,
      message: 'Oferta aceita com sucesso',
      txId: txId,
      offerId: offerId
    };
  }
  
  /**
   * Valida a assinatura da wallet
   * Em produção, usar: ethers.verifyMessage() ou biblioteca similar
   */
  private validateSignature(
    acceptedBy: string, 
    offerId: string, 
    signature: string, 
    walletAddress: string
  ): boolean {
    // Validação básica de formato
    if (!signature.match(/^0x[a-fA-F0-9]{130}$/)) {
      console.error('[SECURITY] Formato de assinatura inválido');
      return false;
    }
    
    // Verificar se o endereço da wallet corresponde ao aceitante
    if (acceptedBy.toLowerCase() !== walletAddress.toLowerCase()) {
      console.error('[SECURITY] Endereço da wallet não corresponde ao aceitante');
      return false;
    }
    
    // Em produção, aqui você deve verificar a assinatura criptograficamente
    // Exemplo com ethers:
    // const message = `Accept offer ${offerId} from ${acceptedBy}`;
    // const recoveredAddress = ethers.verifyMessage(message, signature);
    // return recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
    
    // Por enquanto, aceitamos assinaturas que começam com 0x e têm 132 caracteres
    // (simulação - em produção use verificação real)
    return true;
  }
  
  /**
   * Processa o PSBT (Partially Signed Bitcoin Transaction)
   */
  private async processPSBT(offer: Offer, acceptedBy: string): Promise<string> {
    // Simular processamento de transação Bitcoin
    // Em produção, aqui você:
    // 1. Carregaria o PSBT da oferta
    // 2. Adicionaria a assinatura do comprador
    // 3. Combinaria as assinaturas
    // 4. Transmitiria a transação para a rede
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simular delay
    
    // Gerar ID de transação mock
    const mockTxId = '0x' + Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)).join('');
    
    console.log(`[PSBT] Transação processada: ${mockTxId}`);
    
    return mockTxId;
  }
  
  /**
   * Obtém detalhes de uma oferta
   */
  async getOffer(offerId: string): Promise<Offer | null> {
    return this.offers.get(offerId) || null;
  }
  
  /**
   * Lista todas as ofertas pendentes
   */
  async getPendingOffers(): Promise<Offer[]> {
    const pendingOffers: Offer[] = [];
    
    for (const offer of this.offers.values()) {
      if (offer.status === 'pending' && offer.expiresAt > Date.now()) {
        pendingOffers.push(offer);
      }
    }
    
    return pendingOffers;
  }
  
  /**
   * ❌ MÉTODO DESABILITADO - Aceita oferta usando chave privada
   * Este método NÃO DEVE SER USADO por razões de segurança
   */
  async acceptOffer(offerId: string, privateKeyWIF: string): Promise<any> {
    // Bloquear imediatamente
    throw new Error(
      '❌ MÉTODO DESABILITADO POR SEGURANÇA.\n' +
      'Este método aceitava chaves privadas e foi removido.\n' +
      'Use acceptOfferWithWalletSignature() que NUNCA recebe chaves privadas.'
    );
  }
  
  /**
   * Verifica se um método envolve envio de chave privada
   */
  isMethodSafe(methodName: string): boolean {
    const unsafeMethods = ['acceptOffer', 'acceptOfferWithPrivateKey'];
    return !unsafeMethods.includes(methodName);
  }
}

// Exportar instância única (singleton)
export const btOfferSystem = new PSBTOfferSystem();

// Export default para compatibilidade
export default PSBTOfferSystem;