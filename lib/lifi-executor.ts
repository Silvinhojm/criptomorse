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

    console.log(`📊 LI.FI: Buscando cotação ${params.fromChain} → ${params.toChain}`);

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
      toAmount:            data.toAmount,
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
      // gasPrice omitido: ethers usará EIP-1559 automaticamente
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

// ─── 4. Helpers ────────────────────────────────────────────────────────────────

/** Converte valor humano para unidades do token */
export function toTokenUnits(amount: number, decimals = 6): string {
  return Math.floor(amount * Math.pow(10, decimals)).toString();
}

/** Converte unidades do token para valor humano */
export function fromTokenUnits(amount: string, decimals = 6): number {
  return parseInt(amount) / Math.pow(10, decimals);
}

/** Chains suportadas com endereços USDC */
export const SUPPORTED_CHAINS = {
  base:     { id: 8453,    name: 'Base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  polygon:  { id: 137,     name: 'Polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  arbitrum: { id: 42161,   name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  optimism: { id: 10,      name: 'Optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  arc:      { id: 5042002, name: 'Arc',      usdc: '0x3600000000000000000000000000000000000000' },
};
