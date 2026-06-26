// lib/direct-dex.ts
// DEX direto (Uniswap V2-style) para swaps mais rápidos e baratos que LI.FI
// Usa QuickSwap (Polygon), Aerodrome (Base), SushiSwap (Arbitrum), Uniswap V2 (Ethereum)
// LI.FI fica como fallback para rotas complexas ou cross-chain

import { ethers } from "ethers";

// ─── DEX Router Addresses ────────────────────────────────────────────────────
// Uniswap V2-style routers com interface compatível:
//   getAmountsOut(uint,address[]) → uint[]
//   swapExactTokensForTokens(uint,uint,address[],address,uint) → uint[]
const DEX_ROUTERS: Record<string, string> = {
  polygon:  "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",   // QuickSwap V2
  base:     "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",   // Aerodrome
  arbitrum: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",   // SushiSwap
  ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",   // Uniswap V2
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
];

export interface DirectDexQuote {
  amountOut: bigint;
  amountOutUsd: number;
  path: string[];
  router: string;
  estimatedGas: number;
}

export interface DirectDexResult {
  success: boolean;
  txHash?: string;
  amountOut?: number;
  gasUsed?: number;
  error?: string;
}

// Verifica se a chain tem DEX direto configurado
export function hasDirectDex(networkKey: string): boolean {
  return networkKey in DEX_ROUTERS;
}

// Busca quote on-chain via getAmountsOut
export async function getDirectDexQuote(
  networkKey: string,
  provider: ethers.Provider,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
): Promise<DirectDexQuote | null> {
  const router = DEX_ROUTERS[networkKey];
  if (!router) return null;

  try {
    const dex = new ethers.Contract(router, ROUTER_ABI, provider);
    const path = [fromTokenAddr, toTokenAddr];
    const amounts: bigint[] = await dex.getAmountsOut(amountInRaw, path);

    if (!amounts || amounts.length < 2 || amounts[1] <= 0n) return null;

    return {
      amountOut: amounts[1],
      amountOutUsd: 0,
      path,
      router,
      estimatedGas: 150000,
    };
  } catch {
    return null;
  }
}

// Executa swap via DEX direto
export async function executeDirectDexSwap(
  networkKey: string,
  signer: ethers.Signer,
  userAddress: string,
  fromTokenAddr: string,
  toTokenAddr: string,
  amountInRaw: bigint,
  amountOutMin: bigint,
  slippageBps: number = 50, // 0.5% default
  onLog?: (msg: string) => void,
): Promise<DirectDexResult> {
  const router = DEX_ROUTERS[networkKey];
  if (!router) {
    return { success: false, error: `Nenhum DEX configurado para ${networkKey}` };
  }

  const log = onLog || ((m) => console.log(m));

  try {
    const dex = new ethers.Contract(router, ROUTER_ABI, signer);
    const path = [fromTokenAddr, toTokenAddr];
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min

    log(`🔄 DEX direto: swap via ${networkKey} router ${router.slice(0, 10)}...`);

    const tx = await dex.swapExactTokensForTokens(
      amountInRaw,
      amountOutMin,
      path,
      userAddress,
      deadline,
      { gasLimit: 300000 },
    );

    log(`🔗 TX DEX direto: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      return { success: false, error: "TX DEX falhou on-chain", txHash: tx.hash };
    }

    return {
      success: true,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : undefined,
    };
  } catch (err: any) {
    return { success: false, error: `DEX swap falhou: ${err.message.slice(0, 200)}` };
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
