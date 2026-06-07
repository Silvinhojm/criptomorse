// lib/lifi-executor.ts
// Executor de transações LI.FI via API REST

const LI_FI_API = 'https://li.quest/v1';
const INTEGRATOR_ID = 'CriptoMorse-ARC---Main';
const USER_AGENT = 'CriptoMorse-ARC-Agent/1.0';

export interface SwapParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export interface QuoteResult {
  fromAmount: string;
  toAmount: string;
  tool: string;
  estimatedGas: string;
  expectedTime: number;
  transactionRequest?: {
    data: string;
    to: string;
    value: string;
    gasPrice: string;
    gasLimit: string;
  };
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  error?: string;
  amountReceived?: string;
  tool?: string;
}

// 1. Buscar cotação (quote)
export async function getQuote(params: SwapParams): Promise<QuoteResult | null> {
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
    
    console.log(`🤖 LI.FI: Buscando cotação para swap...`);
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('⚠️ Rate limit atingido, aguardando...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return getQuote(params);
      }
      console.error(`❌ LI.FI erro: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.transactionRequest) {
      console.log(`✅ LI.FI: Rota via ${data.tool} | Saída: ${data.toAmount}`);
      return {
        fromAmount: data.fromAmount,
        toAmount: data.toAmount,
        tool: data.tool,
        estimatedGas: data.estimatedGas || '0',
        expectedTime: data.expectedTime || 30,
        transactionRequest: data.transactionRequest,
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ LI.FI erro:', error);
    return null;
  }
}

// 2. Executar swap (prepara a transação para assinar)
export async function prepareSwap(params: SwapParams): Promise<{
  transaction: any;
  quote: QuoteResult;
} | null> {
  const quote = await getQuote(params);
  
  if (!quote || !quote.transactionRequest) {
    console.error('❌ LI.FI: Não foi possível obter cotação');
    return null;
  }
  
  return {
    transaction: quote.transactionRequest,
    quote,
  };
}

// 3. Simular execução de swap (para demonstração)
export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  try {
    const quote = await getQuote(params);
    
    if (!quote) {
      return { success: false, error: 'Nenhuma rota disponível' };
    }
    
    console.log(`📊 LI.FI: Executando swap via ${quote.tool}`);
    console.log(`   De: ${params.fromAmount} → Para: ${quote.toAmount}`);
    
    // Simular hash de transação (em produção, usuário assinaria)
    const mockTxHash = `0x${Math.random().toString(36).substring(2, 42)}`;
    
    // Simular delay de processamento
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      txHash: mockTxHash,
      amountReceived: quote.toAmount,
      tool: quote.tool,
    };
  } catch (error) {
    console.error('❌ LI.FI erro:', error);
    return { success: false, error: String(error) };
  }
}

// 4. Converter valor para unidades do token
export function toTokenUnits(amount: number, decimals: number = 6): string {
  return (amount * Math.pow(10, decimals)).toString();
}

// 5. Converter de unidades para número
export function fromTokenUnits(amount: string, decimals: number = 6): number {
  return parseInt(amount) / Math.pow(10, decimals);
}

// 6. Configurações das chains
export const SUPPORTED_CHAINS = {
  base: { id: 8453, name: 'Base', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  polygon: { id: 137, name: 'Polygon', usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  arbitrum: { id: 42161, name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  optimism: { id: 10, name: 'Optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
};