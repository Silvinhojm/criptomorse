// lib/lifi-agent.ts
// Agente Oficial LI.FI - Integração via REST API

import { parseUnits, formatUnits } from 'ethers';

const LI_FI_API = 'https://li.quest/v1';
const INTEGRATOR_ID = 'CriptoMorse-ARC---Main';
const USER_AGENT = 'CriptoMorse-ARC-Agent/1.0';

export interface QuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export interface QuoteResponse {
  transactionRequest: {
    data: string;
    to: string;
    value: string;
    gasPrice: string;
    gasLimit: string;
  };
  fromAmount: string;
  toAmount: string;
  estimatedGas: string;
  tool: string;
  bridge: string;
  expectedTime: number;
}

export interface StatusResponse {
  status: 'NOT_FOUND' | 'PENDING' | 'DONE' | 'FAILED';
  substatus?: 'COMPLETED' | 'PARTIAL' | 'REFUNDED';
  txHash?: string;
  toAmount?: string;
  error?: string;
}

export async function getQuote(params: QuoteParams): Promise<QuoteResponse | null> {
  try {
    const url = new URL(`${LI_FI_API}/quote`);
    url.searchParams.append('fromChain', params.fromChain.toString());
    url.searchParams.append('toChain', params.toChain.toString());
    url.searchParams.append('fromToken', params.fromToken);
    url.searchParams.append('toToken', params.toToken);
    url.searchParams.append('fromAmount', params.fromAmount);
    url.searchParams.append('fromAddress', params.fromAddress);
    url.searchParams.append('slippage', (params.slippage || 0.005).toString());
    url.searchParams.append('integrator', INTEGRATOR_ID);

    if (params.toAddress) {
      url.searchParams.append('toAddress', params.toAddress);
    }

    console.log(`🤖 LI.FI Agent: Buscando cotação...`);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('⚠️ Rate limit atingido! Aguardando...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return getQuote(params);
      }
      console.error(`❌ LI.FI API erro: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.transactionRequest) {
      console.log(`✅ Cotação obtida via ${data.tool}`);
      return {
        transactionRequest: data.transactionRequest,
        fromAmount: data.fromAmount,
        toAmount: data.toAmount,
        estimatedGas: data.estimatedGas,
        tool: data.tool,
        bridge: data.bridge || data.tool,
        expectedTime: data.expectedTime || 30,
      };
    }

    return null;
  } catch (error) {
    console.error('❌ Erro ao buscar cotação:', error);
    return null;
  }
}

export async function checkTransferStatus(
  txHash: string,
  fromChain: number,
  toChain: number
): Promise<StatusResponse | null> {
  try {
    const url = new URL(`${LI_FI_API}/status`);
    url.searchParams.append('txHash', txHash);
    url.searchParams.append('fromChain', fromChain.toString());
    url.searchParams.append('toChain', toChain.toString());

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();

    return {
      status: data.status,
      substatus: data.substatus,
      txHash: data.txHash,
      toAmount: data.toAmount,
      error: data.error,
    };
  } catch (error) {
    console.error('❌ Erro ao verificar status:', error);
    return null;
  }
}

export async function prepareSwapTransaction(params: QuoteParams): Promise<{
  transaction: any;
  quote: QuoteResponse;
} | null> {
  const quote = await getQuote(params);

  if (!quote || !quote.transactionRequest) {
    console.error('❌ Não foi possível obter cotação');
    return null;
  }

  return {
    transaction: quote.transactionRequest,
    quote,
  };
}

/**
 * Converte valor legível (ex: 2) para unidades brutas do token (ex: "2000000000000000000")
 * @param amount  Valor que o usuário digitou (ex: 2)
 * @param decimals Decimais do token: USDC=6, EURC/EURA=18, MATIC=18
 */
export function toTokenUnits(amount: number | string, decimals: number): string {
  return parseUnits(amount.toString(), decimals).toString();
}

/**
 * Converte unidades brutas do token (ex: "2000000") para valor legível (ex: 2)
 * @param amount  Valor bruto em string (ex: "2000000")
 * @param decimals Decimais do token: USDC=6, EURC/EURA=18, MATIC=18
 */
export function fromTokenUnits(amount: string, decimals: number): number {
  return parseFloat(formatUnits(amount, decimals));
}
