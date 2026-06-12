// lib/lifi-executor.ts
// Executor REAL de swaps via LI.FI API REST + assinatura ethers
// Retorna txHash confirmado na blockchain

import { ethers } from 'ethers';

const LI_FI_API = 'https://li.quest/v1';
const INTEGRATOR_ID = 'CriptoMorse-ARC---Main';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface SwapParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;       // em unidades do token (ex: "10000000" = 10 USDC)
  fromAddress: string;
  toAddress?: string;
  slippage?: number;        // ex: 0.005 = 0.5%
}

export interface QuoteResult {
  fromAmount: string;
  toAmount: string;
  tool: string;
  estimatedGas: string;
  expectedTime: number;
  transactionRequest: {
    data: string;
    to: string;
    value: string;
    gasPrice: string;
    gasLimit: string;
    chainId: number;
  };
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  amountReceived?: string;
  tool?: string;
  error?: string;
}

// ─── Explorer por chainId ──────────────────────────────────────────────────────

const EXPLORERS: Record<number, string> = {
  8453:    'https://basescan.org',
  137:     'https://polygonscan.com',
  42161:   'https://arbiscan.io',
  10:      'https://optimistic.etherscan.io',
  1:       'https://etherscan.io',
  5042002: 'https://testnet.arcscan.app',
};

function explorerTx(chainId: number, txHash: string): string {
  const base = EXPLORERS[chainId] ?? 'https://etherscan.io';
  return `${base}/tx/${txHash}`;
}

// ─── Mapeamento de decimais por token e chain ─────────────────────────────────
const TOKEN_DECIMALS: Record<string, number> = {
  // USDC em todas as chains principais = 6 decimais
  'USDC-8453': 6,    // Base
  'USDC-137': 6,     // Polygon
  'USDC-42161': 6,   // Arbitrum
  'USDC-10': 6,      // Optimism
  'USDC-1': 6,       // Ethereum
  'USDC-5042002': 6, // Arc (USDC tem 6 decimais)
  
  // EURC na Polygon tem 18 decimais! (é um token diferente)
  'EURC-137': 18,    // 🔥 Polygon EURC = 18 decimais
  'EURC-8453': 6,    // Base EURC = 6 decimais
  'EURC-1': 6,       // Ethereum EURC = 6 decimais
  
  // Tokens nativos (ETH, MATIC) = 18 decimais
  'ETH-1': 18,
  'ETH-8453': 18,
  'MATIC-137': 18,
};

function getTokenDecimals(tokenAddress: string, chainId: number, symbol?: string): number {
  // Primeiro tenta pelo símbolo + chain
  if (symbol) {
    const key = `${symbol}-${chainId}`;
    if (TOKEN_DECIMALS[key]) return TOKEN_DECIMALS[key];
  }
  
  // Tenta pelo address + chain (hash simples)
  const shortAddr = tokenAddress.slice(0, 8);
  const addrKey = `${shortAddr}-${chainId}`;
  if (TOKEN_DECIMALS[addrKey]) return TOKEN_DECIMALS[addrKey];
  
  // Fallback: USDC-like tokens geralmente 6, outros 18
  const isStableLike = tokenAddress.toLowerCase().includes('usdc') || 
                       tokenAddress.toLowerCase().includes('eurc') ||
                       symbol === 'USDC' || symbol === 'EURC';
  return isStableLike ? 6 : 18;
}

// ─── 1. Buscar cotação ─────────────────────────────────────────────────────────

export async function getQuote(params: SwapParams): Promise<QuoteResult | null> {
  try {
    const url = new URL(`${LI_FI_API}/quote`);
    url.searchParams.set('fromChain',   params.fromChain.toString());
    url.searchParams.set('toChain',     params.toChain.toString());
    url.searchParams.set('fromToken',   params.fromToken);
    url.searchParams.set('toToken',     params.toToken);
    url.searchParams.set('fromAmount',  params.fromAmount);
    url.searchParams.set('fromAddress', params.fromAddress);
    url.searchParams.set('slippage',    (params.slippage ?? 0.005).toString());
    url.searchParams.set('integrator',  INTEGRATOR_ID);
    if (params.toAddress) url.searchParams.set('toAddress', params.toAddress);

    console.log(`📊 LI.FI: Buscando cotação ${params.fromChain} → ${params.toChain} with amount ${params.fromAmount}`);

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (res.status === 429) {
      console.warn('⏳ Rate limit LI.FI — aguardando 2s...');
      await new Promise(r => setTimeout(r, 2000));
      return getQuote(params);
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`❌ LI.FI quote erro ${res.status}:`, err);
      return null;
    }

    const data = await res.json();

    if (!data.transactionRequest) {
      console.warn('⚠️ LI.FI: Sem transactionRequest na resposta');
      return null;
    }

    console.log(`✅ LI.FI cotação via ${data.tool} | saída: ${data.toAmount}`);

    return {
      fromAmount:          data.fromAmount,
      toAmount: data.estimate?.toAmount ?? data.toAmount ?? "0",
      tool:                data.tool ?? 'unknown',
      estimatedGas:        data.estimate?.gasCosts?.[0]?.amount ?? '0',
      expectedTime:        data.estimate?.executionDuration ?? 30,
      transactionRequest:  data.transactionRequest,
    };
  } catch (err) {
    console.error('❌ LI.FI getQuote erro:', err);
    return null;
  }
}

/** Tenta cotações com slippage crescente (útil quando price impact > 10% no LI.FI) */
export async function getQuoteWithRetry(
  params: SwapParams,
  slippageLevels: number[] = [0.005, 0.05, 0.12]
): Promise<QuoteResult | null> {
  for (const slippage of slippageLevels) {
    const quote = await getQuote({ ...params, slippage });
    if (quote) {
      if (slippage > (params.slippage ?? 0.005)) {
        console.log(`✅ LI.FI cotação obtida com slippage ${(slippage * 100).toFixed(1)}%`);
      }
      return quote;
    }
  }
  return null;
}

// ─── 2. Aprovar token ERC-20 se necessário ─────────────────────────────────────

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

async function ensureApproval(
  signer: ethers.Wallet,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const allowance: bigint = await token.allowance(signer.address, spender);

  if (allowance < amount) {
    console.log(`🔓 Aprovando ${amount} tokens para ${spender}...`);
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ Aprovação confirmada: ${tx.hash}`);
  } else {
    console.log(`✅ Allowance já suficiente (${allowance})`);
  }
}

// ─── 3. Executar swap REAL ─────────────────────────────────────────────────────

export async function executeSwap(
  params: SwapParams,
  signer: ethers.Wallet,
  onLog?: (msg: string) => void
): Promise<SwapResult> {
  const log = (msg: string) => { console.log(msg); onLog?.(msg); };

  try {
    // 3a. Buscar cotação
    log(`🔍 Obtendo cotação LI.FI...`);
    const quote = await getQuote(params);

    if (!quote) {
      return { success: false, error: 'Nenhuma rota LI.FI disponível' };
    }

    const { transactionRequest: tx, tool, toAmount } = quote;
    log(`🛣️ Rota via ${tool} | Estimativa saída: ${toAmount}`);

    // 3b. Aprovação ERC-20 (se não for token nativo)
    const isNative = params.fromToken.toLowerCase() === '0x0000000000000000000000000000000000000000'
                  || params.fromToken.toLowerCase() === ethers.ZeroAddress.toLowerCase();

    if (!isNative && tx.to) {
      log(`🔓 Verificando allowance...`);
      await ensureApproval(
        signer,
        params.fromToken,
        tx.to,
        BigInt(params.fromAmount)
      );
    }

    // 3c. Enviar transação
    log(`📝 Assinando e enviando transação...`);
    const txResponse = await signer.sendTransaction({
      to:       tx.to,
      data:     tx.data,
      value:    BigInt(tx.value ?? '0'),
      gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });

    log(`🔗 TX enviada: ${txResponse.hash}`);
    log(`⏳ Aguardando confirmação na blockchain...`);

    // 3d. Aguardar confirmação (1 bloco)
    const receipt = await txResponse.wait(1);

    if (!receipt || receipt.status === 0) {
      return {
        success:  false,
        txHash:   txResponse.hash,
        error:    'Transação falhou on-chain (status 0)',
      };
    }

    const explorerUrl = explorerTx(params.fromChain, txResponse.hash);
    log(`✅ CONFIRMADO no bloco ${receipt.blockNumber}!`);
    log(`🔗 Explorer: ${explorerUrl}`);

    return {
      success:        true,
      txHash:         txResponse.hash,
      explorerUrl,
      amountReceived: toAmount,
      tool,
    };

  } catch (err: any) {
    let msg = 'Erro desconhecido';
    if (err?.code === 'ACTION_REJECTED' || err?.message?.includes('user rejected')) {
      msg = 'Transação rejeitada pelo usuário';
    } else if (err?.message?.includes('insufficient')) {
      msg = 'Saldo insuficiente (inclua gas)';
    } else if (err?.message?.includes('nonce')) {
      msg = 'Erro de nonce — tente novamente';
    } else if (err?.message) {
      msg = err.message;
    }
    console.error('❌ executeSwap erro:', err);
    return { success: false, error: msg };
  }
}

// ─── 4. Helpers CORRIGIDOS (USANDO ethers.parseUnits) ─────────────────────────
// 🔥🔥🔥 CORREÇÃO PRINCIPAL - usando ethers.parseUnits que é 100% preciso 🔥🔥🔥

/** 
 * Converte valor humano para unidades do token usando ethers.parseUnits
 * @param amount - Valor legível (ex: 2.5)
 * @param decimals - Número de decimais do token (OBRIGATÓRIO)
 * @returns String com o valor em unidades base (ex: "2500000")
 * 
 * @example
 * toTokenUnits(1, 6)   // "1000000" (1 USDC)
 * toTokenUnits(1, 18)  // "1000000000000000000" (1 EURC na Polygon)
 */
export function toTokenUnits(amount: number, decimals: number): string {
  // Usando ethers.parseUnits que lida corretamente com BigInt e decimais
  return ethers.parseUnits(amount.toString(), decimals).toString();
}

/** 
 * Converte unidades do token para valor humano usando ethers.formatUnits
 * @param amount - Valor em unidades base (ex: "2500000")
 * @param decimals - Número de decimais do token
 * @returns Valor legível (ex: 2.5)
 */
export function fromTokenUnits(amount: string, decimals: number): number {
  return parseFloat(ethers.formatUnits(amount, decimals));
}

/**
 * Função auxiliar: Cria os parâmetros de swap com decimais automáticos
 * Use esta função para montar o SwapParams sem errar os decimais!
 * 
 * @example
 * const params = buildSwapParams({
 *   fromChain: 137,
 *   toChain: 8453,
 *   fromTokenAddress: '0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4', // EURC Polygon
 *   toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC Base
 *   amountHuman: 2,  // 2 EURC
 *   fromAddress: '0x...',
 *   fromTokenSymbol: 'EURC'
 * });
 */
export function buildSwapParams(params: {
  fromChain: number;
  toChain: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  amountHuman: number;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
  fromTokenDecimals?: number;
  fromTokenSymbol?: string;
}): SwapParams {
  const decimals = params.fromTokenDecimals ?? 
                   getTokenDecimals(params.fromTokenAddress, params.fromChain, params.fromTokenSymbol);
  
  const rawAmount = toTokenUnits(params.amountHuman, decimals);
  
  console.log(`🔧 buildSwapParams: ${params.amountHuman} ${params.fromTokenSymbol || 'token'} com ${decimals} decimais → raw: ${rawAmount}`);
  
  return {
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: params.fromTokenAddress,
    toToken: params.toTokenAddress,
    fromAmount: rawAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: params.slippage,
  };
}

/** Chains suportadas com endereços USDC */
export const SUPPORTED_CHAINS = {
  base:     { id: 8453,    name: 'Base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  polygon:  { id: 137,     name: 'Polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  arbitrum: { id: 42161,   name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  optimism: { id: 10,      name: 'Optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  arc:      { id: 5042002, name: 'Arc',      usdc: '0x3600000000000000000000000000000000000000' },
};