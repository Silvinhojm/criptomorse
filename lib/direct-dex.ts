// lib/direct-dex.ts
// DEX direto (Uniswap V2 + V3) para swaps mais rápidos e baratos que LI.FI
// Suporta QuickSwap V3 (Polygon), Uniswap V3 (Base/Ethereum) com fee tier 0.01%
// Fallback V2 para chains/par sem pool V3

import { ethers } from "ethers";
import { poolProfiler, FEE_TIERS } from "./pool-profiler";
import type { NetworkKey } from "./real-swap-executor";

// ─── DEX Router Addresses ────────────────────────────────────────────────────
const ROUTERS_V2: Record<string, string> = {
  polygon:  "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",   // QuickSwap V2
  base:     "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",   // Aerodrome
  arbitrum: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",   // SushiSwap
  ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",   // Uniswap V2
};

const ROUTERS_V3: Record<string, string> = {
  polygon:  "0xf5b509bB0909a69B1c207E495f687a596C168E12",   // QuickSwap V3
  base:     "0x2626664c2603336E57B271c5C0b26F421741e481",   // Uniswap V3
  ethereum: "0xE592427A0AEce92De3Edee1F18E0157C05861564",   // Uniswap V3
};

const ROUTER_V2_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
];

const ROUTER_V3_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

export type DexType = "v2" | "v3";

export interface DirectDexQuote {
  amountOut: bigint;
  amountOutUsd: number;
  path: string[];
  router: string;
  estimatedGas: number;
  dexType: DexType;
  fee?: number;
}

export interface DirectDexResult {
  success: boolean;
  txHash?: string;
  amountOut?: number;
  gasUsed?: number;
  error?: string;
}

// ─── Sanitiza quote contra anomalias ─────────────────────────────────────────
// Para pares estáveis, o output esperado deve estar dentro de 5% do input.
// Um quote que desvia >95% (como USDC→DAI retornando $0.50 para $12 input)
// indica pool morta ou bug de decimais — rejeita.
export interface QuoteSanitizeOptions {
  amountInUsd: number;
  isStablePair: boolean;
  maxDeviationPct?: number;
}

export function sanitizeQuote(
  quote: DirectDexQuote,
  fromDecimals: number,
  toDecimals: number,
  opts: QuoteSanitizeOptions,
): boolean {
  if (quote.amountOut <= 0n) return false;
  if (!opts.isStablePair) return true;

  const maxDev = opts.maxDeviationPct ?? 0.05
  const amountOutNum = Number(ethers.formatUnits(quote.amountOut, toDecimals))
  const amountInNum = opts.amountInUsd

  // Para stable pairs: output deve ser ≈ input (tolerância maxDev %)
  const ratio = amountOutNum / amountInNum
  if (ratio < 1 - maxDev || ratio > 1 + maxDev) return false

  return true
}

// ─── Utilitário: verifica se network tem V3 ──────────────────────────────────
export function hasV3Router(networkKey: string): boolean {
  return networkKey in ROUTERS_V3;
}

// ─── Utilitário: verifica se network tem DEX configurado ─────────────────────
export function hasDirectDex(networkKey: string): boolean {
  return networkKey in ROUTERS_V2;
}

// ─── AUTO-QUOTE: detecta V3 pool primeiro, fallback V2 ──────────────────────
export async function getDirectDexQuote(
  networkKey: string,
  provider: ethers.Provider,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  fromDecimals?: number,
  toDecimals?: number,
): Promise<DirectDexQuote | null> {
  // Tenta V3 com o menor fee tier disponível
  if (hasV3Router(networkKey) && poolProfiler.hasFactory(networkKey as NetworkKey)) {
    try {
      const bestFee = await poolProfiler.findBestFeeTier(
        networkKey as NetworkKey, fromTokenAddr, toTokenAddr
      );
      if (bestFee !== null) {
        const quote = await getDirectDexQuoteV3(
          networkKey, provider, fromTokenAddr, toTokenAddr, amountInRaw, bestFee
        );
        if (quote) return quote;
      }
    } catch {
      // fallback silencioso para V2
    }
  }

  // Fallback V2
  return getDirectDexQuoteV2(networkKey, provider, fromTokenAddr, toTokenAddr, amountInRaw);
}

// ─── V3 Quote via quoteExactInputSingle (staticCall simulado) ────────────────
export async function getDirectDexQuoteV3(
  networkKey: string,
  provider: ethers.Provider,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  fee: number,
): Promise<DirectDexQuote | null> {
  const router = ROUTERS_V3[networkKey];
  if (!router) return null;

  try {
    const dex = new ethers.Contract(router, ROUTER_V3_ABI, provider);

    const params = {
      tokenIn: fromTokenAddr,
      tokenOut: toTokenAddr,
      fee,
      recipient: ethers.ZeroAddress, // não importa em staticCall
      deadline: Math.floor(Date.now() / 1000) + 600,
      amountIn: amountInRaw,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    };

    const amountOut: bigint = await dex.exactInputSingle.staticCall(params);

    if (!amountOut || amountOut <= 0n) return null;

    return {
      amountOut,
      amountOutUsd: 0,
      path: [fromTokenAddr, toTokenAddr],
      router,
      estimatedGas: 200000,
      dexType: "v3",
      fee,
    };
  } catch {
    return null;
  }
}

// ─── V2 Quote via getAmountsOut ──────────────────────────────────────────────
export async function getDirectDexQuoteV2(
  networkKey: string,
  provider: ethers.Provider,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
): Promise<DirectDexQuote | null> {
  const router = ROUTERS_V2[networkKey];
  if (!router) return null;

  try {
    const dex = new ethers.Contract(router, ROUTER_V2_ABI, provider);
    const path = [fromTokenAddr, toTokenAddr];
    const amounts: bigint[] = await dex.getAmountsOut(amountInRaw, path);

    if (!amounts || amounts.length < 2 || amounts[1] <= 0n) return null;

    return {
      amountOut: amounts[1],
      amountOutUsd: 0,
      path,
      router,
      estimatedGas: 150000,
      dexType: "v2",
    };
  } catch {
    return null;
  }
}

// ─── Executa swap via DEX (auto-detecta V2 vs V3) ───────────────────────────
export async function executeDirectDexSwap(
  networkKey: string,
  signer: ethers.Signer,
  userAddress: string,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  amountOutMin: bigint,
  slippageBps: number = 50,
  onLog?: (msg: string) => void,
  fee?: number,
): Promise<DirectDexResult> {
  const log = onLog || ((m) => console.log(m));

  // Tenta V3 se fee foi especificado ou detectado
  if (fee !== undefined || hasV3Router(networkKey)) {
    const useFee = fee ?? (await findFeeForPair(networkKey, fromTokenAddr, toTokenAddr));
    if (useFee !== null) {
      const result = await executeDirectDexSwapV3(
        networkKey, signer, userAddress, fromTokenAddr, toTokenAddr,
        amountInRaw, amountOutMin, useFee, onLog
      );
      if (result.success) return result;
    }
  }

  // Fallback V2
  return executeDirectDexSwapV2(
    networkKey, signer, userAddress, fromTokenAddr, toTokenAddr,
    amountInRaw, amountOutMin, slippageBps, onLog
  );
}

async function findFeeForPair(
  networkKey: string,
  fromTokenAddr: string,
  toTokenAddr: string,
): Promise<number | null> {
  if (!poolProfiler.hasFactory(networkKey as NetworkKey)) return null;
  try {
    return await poolProfiler.findBestFeeTier(
      networkKey as NetworkKey, fromTokenAddr, toTokenAddr
    );
  } catch {
    return null;
  }
}

// ─── Executa swap V3 ─────────────────────────────────────────────────────────
export async function executeDirectDexSwapV3(
  networkKey: string,
  signer: ethers.Signer,
  userAddress: string,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  amountOutMin: bigint,
  fee: number,
  onLog?: (msg: string) => void,
): Promise<DirectDexResult> {
  const router = ROUTERS_V3[networkKey];
  if (!router) {
    return { success: false, error: `Nenhum router V3 configurado para ${networkKey}` };
  }

  const log = onLog || ((m) => console.log(m));

  try {
    const dex = new ethers.Contract(router, ROUTER_V3_ABI, signer);

    const params = {
      tokenIn: fromTokenAddr,
      tokenOut: toTokenAddr,
      fee,
      recipient: userAddress,
      deadline: Math.floor(Date.now() / 1000) + 600,
      amountIn: amountInRaw,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    log(`🔄 DEX V3: swap via ${networkKey} fee=${fee}bps router ${router.slice(0, 10)}...`);

    const tx = await dex.exactInputSingle(params, { gasLimit: 300000 });

    log(`🔗 TX DEX V3: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      return { success: false, error: "TX V3 falhou on-chain", txHash: tx.hash };
    }

    return {
      success: true,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : undefined,
    };
  } catch (err: any) {
    return { success: false, error: `DEX V3 swap falhou: ${err.message.slice(0, 200)}` };
  }
}

// ─── Executa swap V2 ─────────────────────────────────────────────────────────
async function executeDirectDexSwapV2(
  networkKey: string,
  signer: ethers.Signer,
  userAddress: string,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  amountOutMin: bigint,
  slippageBps: number = 50,
  onLog?: (msg: string) => void,
): Promise<DirectDexResult> {
  const router = ROUTERS_V2[networkKey];
  if (!router) {
    return { success: false, error: `Nenhum DEX V2 configurado para ${networkKey}` };
  }

  const log = onLog || ((m) => console.log(m));

  try {
    const dex = new ethers.Contract(router, ROUTER_V2_ABI, signer);
    const path = [fromTokenAddr, toTokenAddr];
    const deadline = Math.floor(Date.now() / 1000) + 600;

    log(`🔄 DEX V2: swap via ${networkKey} router ${router.slice(0, 10)}...`);

    const tx = await dex.swapExactTokensForTokens(
      amountInRaw,
      amountOutMin,
      path,
      userAddress,
      deadline,
      { gasLimit: 300000 },
    );

    log(`🔗 TX DEX V2: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      return { success: false, error: "TX DEX V2 falhou on-chain", txHash: tx.hash };
    }

    return {
      success: true,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : undefined,
    };
  } catch (err: any) {
    return { success: false, error: `DEX V2 swap falhou: ${err.message.slice(0, 200)}` };
  }
}

// Slippage: calcula amountOutMin a partir do quote
export function calculateAmountOutMin(
  amountOut: bigint,
  slippageBps: number = 50,
): bigint {
  if (slippageBps <= 0) return amountOut;
  return amountOut - (amountOut * BigInt(slippageBps)) / 10000n;
}
