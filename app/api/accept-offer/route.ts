import { NextRequest, NextResponse } from 'next/server';
import { btOfferSystem } from '@/lib/bitcoin-psbt-offer';

export async function POST(req: NextRequest) {
  try {
    // ✅ CORREÇÃO DE SEGURANÇA: Verificar se há chaves privadas na requisição
    const body = await req.json();
    const { offerId, acceptedBy, signature, walletAddress } = body;
    
    // VALIDAÇÃO DE SEGURANÇA CRÍTICA
    if (body.privateKey || body.privKey || body.wif || body.key || body.privateKeyWIF) {
      console.error('[SECURITY] Tentativa de envio de chave privada detectada e bloqueada');
      return NextResponse.json(
        { 
          error: 'Chaves privadas não são permitidas nesta API',
          message: 'Use assinatura de wallet em vez de enviar chave privada'
        },
        { status: 400 }
      );
    }
    
    // Validar campos obrigatórios
    if (!offerId || !acceptedBy || !signature || !walletAddress) {
      return NextResponse.json(
        { 
          error: 'Campos obrigatórios faltando',
          required: ['offerId', 'acceptedBy', 'signature', 'walletAddress']
        },
        { status: 400 }
      );
    }
    
    // Validar formato da assinatura (deve ser hexadecimal)
    const signatureRegex = /^0x[a-fA-F0-9]{130}$/;
    if (!signatureRegex.test(signature)) {
      return NextResponse.json(
        { error: 'Assinatura inválida - formato esperado: 0x seguido de 130 caracteres hexadecimais' },
        { status: 400 }
      );
    }
    
    // Validar formato do endereço da carteira (Ethereum/Base)
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Endereço de carteira inválido - formato esperado: 0x seguido de 40 caracteres hexadecimais' },
        { status: 400 }
      );
    }
    
    // Validar se os endereços conferem
    if (acceptedBy.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Endereço da wallet não confere com o aceitante' },
        { status: 400 }
      );
    }
    
    // Processar a aceitação da oferta usando método seguro
    const result = await btOfferSystem.acceptOfferWithWalletSignature(
      offerId,
      acceptedBy,
      signature,
      walletAddress
    );
    
    return NextResponse.json({ 
      success: true, 
      message: 'Oferta aceita com sucesso',
      data: result 
    });
    
  } catch (error: any) {
    console.error('[API] Erro ao aceitar oferta:', error);
    
    // Retornar erro apropriado
    const statusCode = error.message.includes('não encontrada') ? 404 :
                      error.message.includes('expirada') ? 410 :
                      error.message.includes('inválida') ? 400 : 500;
    
    return NextResponse.json(
      { 
        error: error.message || 'Erro interno do servidor',
        success: false
      },
      { status: statusCode }
    );
  }
}

// GET: Verificar status de uma oferta
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const offerId = searchParams.get('offerId');
    
    if (!offerId) {
      return NextResponse.json(
        { error: 'offerId é obrigatório' },
        { status: 400 }
      );
    }
    
    const offer = await btOfferSystem.getOffer(offerId);
    
    if (!offer) {
      return NextResponse.json(
        { error: 'Oferta não encontrada' },
        { status: 404 }
      );
    }
    
    // Retornar apenas dados seguros (sem chaves privadas)
    return NextResponse.json({ 
      success: true, 
      data: {
        id: offer.id,
        amount: offer.amount,
        price: offer.price,
        status: offer.status,
        expiresAt: offer.expiresAt
      }
    });
    
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// OPTIONS: Suporte para CORS
export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      headers: {
        'Allow': 'GET, POST, OPTIONS',
      },
    }
  );
}