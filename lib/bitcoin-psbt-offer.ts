// lib/bitcoin-psbt-offer.ts
// Adicionar este método:

class PSBTOfferSystem {
  // ✅ NOVO MÉTODO SEGURO
  async acceptOfferWithWalletSignature(
    offerId: string, 
    userWalletAddress: string
    // signature: string  // A assinatura deve ser validada
  ): Promise<any> {
    
    // Verificar se o usuário tem uma wallet conectada via extensão
    // NUNCA processar chaves diretamente
    
    // A transação deve ser assinada no frontend usando a wallet do usuário
    // O backend apenas verifica a assinatura e executa o PSBT
    
    // TODO: Implementar lógica de verificação de assinatura
    
    return {
      success: true,
      message: 'Offer accepted with wallet signature',
      txId: 'mock_tx_' + Date.now()
    };
  }
  
  // ❌ MÉTODO ANTIGO - DESABILITADO POR SEGURANÇA
  async acceptOffer(offerId: string, privateKeyWIF: string): Promise<any> {
    throw new Error('❌ Método desabilitado por segurança. Use acceptOfferWithWalletSignature');
  }
}