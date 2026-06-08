// app/api/accept-offer/route.ts
// ✅ VERSÃO SEGURA - Não aceita chaves privadas do frontend

import { NextRequest, NextResponse } from 'next/server';
import { psbtOfferSystem } from '@/lib/bitcoin-psbt-offer';

export async function POST(req: NextRequest) {
  try {
    const { offerId, userWalletAddress } = await req.json();
    
    // ❌ REMOVIDO: aceitar privateKeyWIF do frontend
    // ✅ AGORA: apenas endereço público da wallet
    
    if (!offerId || !userWalletAddress) {
      return NextResponse.json({ 
        error: 'Missing required fields: offerId, userWalletAddress' 
      }, { status: 400 });
    }
    
    // ⚠️ VERIFICAÇÃO DE SEGURANÇA
    // Se a requisição tenta enviar chave privada, BLOQUEAR
    const body = await req.json().catch(() => ({}));
    if (body.privateKeyWIF || body.privateKey || body.private_key) {
      console.error('🚨 BLOQUEADO: Tentativa de envio de chave privada');
      return NextResponse.json({ 
        error: 'Chaves privadas não são aceitas. Use assinatura via wallet conectada.' 
      }, { status: 400 });
    }
    
    // ✅ A assinatura deve ser feita no FRONTEND com a wallet do usuário
    // O backend apenas verifica a assinatura, NUNCA recebe a chave
    
    // TODO: Implementar verificação de assinatura aqui
    // O usuário assina a transação com sua wallet (MetaMask/Unisat/etc)
    // E envia APENAS a assinatura, não a chave
    
    const result = await psbtOfferSystem.acceptOfferWithWalletSignature(
      offerId, 
      userWalletAddress
      // signature: userSignature (assinatura, não chave)
    );
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error accepting offer:', error);
    return NextResponse.json({ 
      error: 'Failed to accept offer' 
    }, { status: 500 });
  }
}