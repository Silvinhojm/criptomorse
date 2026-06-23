// lib/lifi-executor.ts
// Executor REAL de swaps via LI.FI API REST + assinatura ethers
// Retorna txHash confirmado na blockchain

import { ethers } from 'ethers';
import { enforceArcFee } from './arc-gas';

const LI_FI_API = 'https://li.quest/v1';
const INTEGRATOR_ID = 'CriptoMorse-ARC---Main';
const REQUEST_TIMEOUT = 15000; // 15s timeout para requests LI.FI

// Rate limiter global com cooldown inteligente
let lastRequestTime = 0;
let cooldownUntil = 0;
const MIN_INTERVAL_MS = 2000;
const COOLDOWN_MS = 60000; // 60s sem chamadas após um 429

export function isLifiCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function resetCooldown(): void {
  cooldownUntil = 0;
}

async function rateLimit(): Promise<boolean> {
  const now = Date.now();
  if (now < cooldownUntil) return false;
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    const wait = MIN_INTERVAL_MS - elapsed + Math.random() * 300;
    await new Promise(r => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();
  return true;
}

// --- Tipos ---

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

// Gerenciamento de nonce por chainId (evita nonce mismatch em envios concorrentes)
const nonceTracker: Map<number, { nextNonce: number; timestamp: number }> = new Map();
const NONCE_EXPIRY = 120000; // 2 minutos

async function getNextNonce(provider: ethers.Provider, chainId: number, address: string): Promise<number> {
  const chainNonce = nonceTracker.get(chainId);
  const onChainNonce = await provider.getTransactionCount(address);

  if (!chainNonce || Date.now() - chainNonce.timestamp > NONCE_EXPIRY) {
    nonceTracker.set(chainId, { nextNonce: onChainNonce, timestamp: Date.now() });
    return onChainNonce;
  }

  const nextNonce = Math.max(chainNonce.nextNonce, onChainNonce);
  nonceTracker.set(chainId, { nextNonce: nextNonce + 1, timestamp: Date.now() });
  return nextNonce;
}

// --- Explorer por chainId ---

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

// --- 1. Buscar cotacao ---

export async function getQuote(params: SwapParams, retryCount = 0): Promise<QuoteResult | null> {
  // Se está em cooldown global (429 recente), retorna null imediatamente
  if (Date.now() < cooldownUntil) {
    console.warn(`LI.FI em cooldown (mais ${Math.round((cooldownUntil - Date.now())/1000)}s) — pulando`);
    return null;
  }

  try {
    // Backoff progressivo: 2s, 4s, 8s, 12s, 16s (max 5 retentativas)
    if (retryCount > 0) {
      const delay = Math.min(2000 * Math.pow(1.8, retryCount - 1), 16000);
      console.warn(`LI.FI rate limit - aguardando ${delay}ms (tentativa ${retryCount}/5)...`);
      await new Promise(r => setTimeout(r, delay));
    }

    const searchParams = new URLSearchParams({
      fromChain:   params.fromChain.toString(),
      toChain:     params.toChain.toString(),
      fromToken:   params.fromToken,
      toToken:     params.toToken,
      fromAmount:  params.fromAmount,
      fromAddress: params.fromAddress,
      slippage:    (params.slippage ?? 0.005).toString(),
      integrator:  INTEGRATOR_ID,
    });
    if (params.toAddress) searchParams.set('toAddress', params.toAddress);

    if (!(await rateLimit())) return null;
    console.log(`LI.FI: Buscando cotacao ${params.fromChain} -> ${params.toChain}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const res = await fetch(`/api/lifi/quote?${searchParams.toString()}`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 429) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      console.warn(`LI.FI 429 — cooldown global de ${COOLDOWN_MS/1000}s ativado`);
      return null; // não retry, só volta depois do cooldown
    }

    if (!res.ok) {
      const err = await res.text();
      console.warn(`LI.FI quote erro ${res.status}: amount too small or no route`, err.slice(0, 200));
      return null;
    }

    const data = await res.json();

    if (!data.transactionRequest) {
      console.warn('LI.FI: Sem transactionRequest na resposta');
      return null;
    }

    // LI.FI v1 coloca toAmount em estimate.toAmount (não no top-level).
    // Algumas rotas "fly" retornam "0" ou undefined.
    const rawToAmount = data.estimate?.toAmount ?? data.toAmount ?? params.fromAmount;

    if (data.tool === 'fly' && (!rawToAmount || rawToAmount === '0')) {
      console.warn(`LI.FI: "fly" sem toAmount — usando fromAmount como estimativa`);
    }

    const toAmount = rawToAmount === '0' ? params.fromAmount : rawToAmount;

    console.log(`LI.FI cotacao via ${data.tool} | saida: ${toAmount}`);

    return {
      fromAmount:          data.fromAmount,
      toAmount,
      tool:                data.tool ?? 'unknown',
      estimatedGas:        data.estimate?.gasCosts?.[0]?.amount ?? '0',
      expectedTime:        data.estimate?.executionDuration ?? 30,
      transactionRequest:  data.transactionRequest,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('LI.FI getQuote timeout');
    } else {
      console.error('LI.FI getQuote erro:', err);
    }
    return null;
  }
}

// --- 2. Aprovar token ERC-20 se necessario ---

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
    console.log(`Aprovando ${amount} tokens para ${spender}...`);
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
    console.log(`Aprovacao confirmada: ${tx.hash}`);
  } else {
    console.log(`Allowance ja suficiente (${allowance})`);
  }
}

// --- 3. Executar swap REAL ---

export async function executeSwap(
  params: SwapParams,
  signer: ethers.Wallet,
  onLog?: (msg: string) => void
): Promise<SwapResult> {
  const log = (msg: string) => { console.log(msg); onLog?.(msg); };

  try {
    log(`Obtendo cotacao LI.FI...`);
    const quote = await getQuote(params);

    if (!quote) {
      return { success: false, error: 'Nenhuma rota LI.FI disponivel' };
    }

    const { transactionRequest: tx, tool, toAmount } = quote;
    log(`Rota via ${tool} | Estimativa saida: ${toAmount}`);

    // Aprovacao ERC-20 (se nao for token nativo)
    const isNative = params.fromToken.toLowerCase() === '0x0000000000000000000000000000000000000000'
                  || params.fromToken.toLowerCase() === ethers.ZeroAddress.toLowerCase();

    if (!isNative && tx.to) {
      log(`Verificando allowance...`);
      await ensureApproval(
        signer,
        params.fromToken,
        tx.to,
        BigInt(params.fromAmount)
      );
    }

    // Nonce management
    let nonce: number | undefined;
    try {
      nonce = await getNextNonce(signer.provider!, params.fromChain, signer.address);
      log(`Nonce: ${nonce}`);
    } catch {
      log(`Nonce padrao (sem gerenciamento)`);
    }

    const arcFeeParams = await enforceArcFee(signer.provider!);

    log(`Assinando e enviando transacao...`);
    const txResponse = await signer.sendTransaction({
      to:       tx.to,
      data:     tx.data,
      value:    BigInt(tx.value ?? '0'),
      gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      nonce,
      ...arcFeeParams,
    });

    log(`TX enviada: ${txResponse.hash}`);
    log(`Aguardando confirmacao na blockchain...`);

    const receipt = await txResponse.wait(1);

    if (!receipt || receipt.status === 0) {
      return {
        success:  false,
        txHash:   txResponse.hash,
        error:    'Transacao falhou on-chain (status 0)',
      };
    }

    const explorerUrl = explorerTx(params.fromChain, txResponse.hash);
    log(`CONFIRMADO no bloco ${receipt.blockNumber}!`);
    log(`Explorer: ${explorerUrl}`);

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
      msg = 'Transacao rejeitada pelo usuario';
    } else if (err?.message?.includes('insufficient')) {
      msg = 'Saldo insuficiente (inclua gas)';
    } else if (err?.message?.includes('nonce')) {
      nonceTracker.delete(params.fromChain);
      msg = 'Erro de nonce - nonce resetado, tente novamente';
    } else if (err?.message) {
      msg = err.message;
    }
    console.error('executeSwap erro:', err);
    return { success: false, error: msg };
  }
}

// --- 4. Helpers ---

export function toTokenUnits(amount: number, decimals = 6): string {
  return Math.floor(amount * Math.pow(10, decimals)).toString();
}

export function fromTokenUnits(amount: string, decimals = 6): number {
  try {
    return Number(BigInt(amount)) / Math.pow(10, decimals);
  } catch {
    return parseInt(amount) / Math.pow(10, decimals);
  }
}

export const SUPPORTED_CHAINS = {
  base:     { id: 8453,    name: 'Base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  polygon:  { id: 137,     name: 'Polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  arbitrum: { id: 42161,   name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  optimism: { id: 10,      name: 'Optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  arc:      { id: 5042002, name: 'Arc',      usdc: '0x3600000000000000000000000000000000000000' },
};
