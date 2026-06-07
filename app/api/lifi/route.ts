import { NextResponse } from 'next/server';

const LIFI_API_URL = 'https://li.quest/v1';
// ⚠️ Use variável de ambiente! Nunca hardcode no código.
const LIFI_API_KEY = process.env.LIFI_API_KEY; 

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromChain = searchParams.get('fromChain');
  const fromToken = searchParams.get('fromToken');
  const toChain = searchParams.get('toChain');
  const toToken = searchParams.get('toToken');
  const fromAmount = searchParams.get('fromAmount');
  const fromAddress = searchParams.get('fromAddress');

  // 1. Buscar cotação (quote)
  const quoteUrl = `${LIFI_API_URL}/quote?${new URLSearchParams({
    fromChain: fromChain!,
    fromToken: fromToken!,
    toChain: toChain!,
    toToken: toToken!,
    fromAmount: fromAmount!,
    fromAddress: fromAddress!,
    slippage: '0.03'
  })}`;

  const quoteResponse = await fetch(quoteUrl, {
    headers: { 'x-lifi-api-key': LIFI_API_KEY! }
  });
  
  if (!quoteResponse.ok) {
    return NextResponse.json({ error: 'Erro na cotação LI.FI' }, { status: 500 });
  }

  const quoteData = await quoteResponse.json();
  
  // 2. (Opcional) Buscar saldo de tokens - você pode usar o /balances da LI.FI
  const balancesUrl = `${LIFI_API_URL}/balances?${new URLSearchParams({
    chainId: fromChain!,
    token: fromToken!,
    address: fromAddress!
  })}`;
  
  const balanceResponse = await fetch(balancesUrl, {
    headers: { 'x-lifi-api-key': LIFI_API_KEY! }
  });
  const balanceData = await balanceResponse.json();

  return NextResponse.json({
    quote: quoteData,
    balance: balanceData
  });
}