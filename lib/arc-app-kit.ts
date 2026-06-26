import { createClient } from '@lifi/sdk';
import { ethers } from 'ethers';

type ArcChain = 'arc' | 'base' | 'polygon' | 'ethereum';

interface BridgeParams {
  fromChain: ArcChain;
  toChain: ArcChain;
  amount: number;
  token: string;
  fromAddress: string;
  memo?: string;
}

interface SwapParams {
  chain: ArcChain;
  fromToken: string;
  toToken: string;
  amount: number;
  fromAddress: string;
  slippage?: number;
}

interface BridgeResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  message: string;
}

interface SwapResult {
  success: boolean;
  txHash: string;
  toAmount: number;
  explorerUrl: string;
  message: string;
}

const CHAIN_MAP: Record<ArcChain, { chainId: number; name: string; explorer: string }> = {
  arc: { chainId: 5042002, name: 'Arc Testnet', explorer: 'https://testnet.arcscan.app/tx' },
  base: { chainId: 8453, name: 'Base', explorer: 'https://basescan.org/tx' },
  polygon: { chainId: 137, name: 'Polygon', explorer: 'https://polygonscan.com/tx' },
  ethereum: { chainId: 1, name: 'Ethereum', explorer: 'https://etherscan.io/tx' },
};

const lifiClient = createClient({ integrator: 'CriptoMorseARC' });

class ArcAppKit {
  private readonly PLATFORM_FEE_BPS = 30;

  async bridge(params: BridgeParams): Promise<BridgeResult> {
    const from = CHAIN_MAP[params.fromChain];
    const to = CHAIN_MAP[params.toChain];
    const amount = ethers.parseUnits(params.amount.toFixed(6), 6).toString();

    try {
      const req = await fetch('https://li.quest/v1/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain: from.chainId,
          toChain: to.chainId,
          fromToken: params.token,
          toToken: params.token,
          fromAmount: amount,
          fromAddress: params.fromAddress,
          integrator: 'CriptoMorseARC',
          order: 'RECOMMENDED',
          slippage: 0.005,
        }),
      });

      const data = await req.json();
      if (!data.routes?.length) {
        return { success: false, txHash: '', explorerUrl: '', message: 'No routes available' };
      }

      return {
        success: true,
        txHash: data.routes[0].transactionHash || '',
        explorerUrl: `${from.explorer}/${data.routes[0].transactionHash || ''}`,
        message: `Bridge ${params.amount} ${params.token} ${params.fromChain}->${params.toChain}`,
      };
    } catch (err: any) {
      return { success: false, txHash: '', explorerUrl: '', message: err.message };
    }
  }

  async swap(params: SwapParams): Promise<SwapResult> {
    const chain = CHAIN_MAP[params.chain];
    const amount = ethers.parseUnits(params.amount.toFixed(6), 6).toString();

    try {
      const req = await fetch('https://li.quest/v1/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain: chain.chainId,
          toChain: chain.chainId,
          fromToken: params.fromToken,
          toToken: params.toToken,
          fromAmount: amount,
          fromAddress: params.fromAddress,
          integrator: 'CriptoMorseARC',
          slippage: (params.slippage ?? 0.5) / 100,
        }),
      });

      const data = await req.json();
      if (!data.routes?.length) {
        return { success: false, txHash: '', toAmount: 0, explorerUrl: '', message: 'No routes' };
      }

      const toAmount = parseFloat(data.routes[0].toAmount) / 1e6;
      return {
        success: true,
        txHash: data.routes[0].transactionHash || '',
        toAmount,
        explorerUrl: `${chain.explorer}/${data.routes[0].transactionHash || ''}`,
        message: `Swap ${params.amount} ${params.fromToken}->${params.toToken}`,
      };
    } catch (err: any) {
      return { success: false, txHash: '', toAmount: 0, explorerUrl: '', message: err.message };
    }
  }

  calculateFee(amount: number): number {
    return amount * this.PLATFORM_FEE_BPS / 10000;
  }

  withFee(amount: number): { net: number; fee: number; total: number } {
    const fee = this.calculateFee(amount);
    return { net: amount, fee, total: amount + fee };
  }
}

export const arcAppKit = new ArcAppKit();
export type { ArcChain, BridgeParams, SwapParams, BridgeResult, SwapResult };
