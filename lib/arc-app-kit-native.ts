import { ethers } from 'ethers';
import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { cctpService, CCTPTransfer, CCTPStep } from './cctp';

export type ArcChain = 'arc' | 'base' | 'polygon' | 'ethereum';

interface BridgeParams {
  fromChain: ArcChain;
  toChain: ArcChain;
  amount: number;
  token: string;
  fromAddress: string;
  recipient: string;
  memo?: string;
  onStep?: (step: CCTPStep) => void;
  customFee?: { value: string; recipientAddress: string };
}

interface SwapParams {
  chain: ArcChain;
  fromToken: string;
  toToken: string;
  amount: number;
  fromAddress: string;
  slippage?: number;
}

interface SendParams {
  chain: ArcChain;
  to: string;
  amount: number;
  from: string;
  token: string;
}

interface SwapResult {
  success: boolean;
  txHash: string;
  toAmount: number;
  explorerUrl: string;
  message: string;
}

interface SendResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  message: string;
}

const CHAIN_MAP: Record<ArcChain, { chainId: number; name: string; explorer: string; appKitChain: string }> = {
  arc: { chainId: 5042002, name: 'Arc Testnet', explorer: 'https://testnet.arcscan.app/tx', appKitChain: 'Arc_Testnet' },
  base: { chainId: 8453, name: 'Base', explorer: 'https://basescan.org/tx', appKitChain: 'Base' },
  polygon: { chainId: 137, name: 'Polygon', explorer: 'https://polygonscan.com/tx', appKitChain: 'Polygon' },
  ethereum: { chainId: 1, name: 'Ethereum', explorer: 'https://etherscan.io/tx', appKitChain: 'Ethereum' },
};

class ArcAppKit {
  private readonly PLATFORM_FEE_BPS = 30;
  private circleClient: any;
  private kit: any;
  private adapter: any;

  constructor() {
    this.kit = new AppKit();
  }

  private async getCircleClient(): Promise<any> {
    if (this.circleClient) return this.circleClient;
    if (typeof window === 'undefined') {
      try {
        const { initiateUserControlledWalletsClient } = await import('@circle-fin/user-controlled-wallets');
        this.circleClient = initiateUserControlledWalletsClient({
          apiKey: process.env.CIRCLE_API_KEY || '',
        });
        return this.circleClient;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async getAdapter() {
    if (this.adapter) return this.adapter;
    if (!window.ethereum) throw new Error('MetaMask not available');
    this.adapter = await createViemAdapterFromProvider({ provider: window.ethereum });
    return this.adapter;
  }

  async bridge(params: BridgeParams): Promise<CCTPTransfer> {
    const { cctpService } = await import('./cctp');
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    return cctpService.initiateTransfer({
      fromChain: params.fromChain,
      toChain: params.toChain,
      amount: params.amount,
      recipient: params.recipient,
      signer,
      onStep: params.onStep,
    });
  }

  async swap(params: SwapParams): Promise<SwapResult> {
    const chain = CHAIN_MAP[params.chain];
    const adapter = await this.getAdapter();
    const kitKey = process.env.KIT_KEY || '';

    try {
      const result = await this.kit.swap({
        from: { adapter, chain: chain.appKitChain },
        tokenIn: params.fromToken,
        tokenOut: params.toToken,
        amountIn: params.amount.toString(),
        config: {
          kitKey,
          slippage: params.slippage ?? 0.5,
        },
      });

      if (result.state === 'error') {
        throw new Error(result.error?.message || 'Swap failed');
      }

      const txHash = result.steps?.[0]?.values?.txHash || '';
      const toAmount = result.steps?.[0]?.values?.data?.outputAmount
        ? parseFloat(result.steps[0].values.data.outputAmount) / 1e6
        : 0;

      return {
        success: true,
        txHash,
        toAmount,
        explorerUrl: `${chain.explorer}/${txHash}`,
        message: `Swap ${params.amount} ${params.fromToken}->${params.toToken}`,
      };
    } catch (err: any) {
      return { success: false, txHash: '', toAmount: 0, explorerUrl: '', message: err.message };
    }
  }

  async sendToken(params: SendParams): Promise<SendResult> {
    const chain = CHAIN_MAP[params.chain];
    const adapter = await this.getAdapter();

    try {
      const result = await this.kit.send({
        from: { adapter, chain: chain.appKitChain },
        to: params.to,
        amount: params.amount.toString(),
        token: params.token,
      });

      if (result.state === 'error') {
        throw new Error(result.error?.message || 'Send failed');
      }

      const txHash = result.steps?.[0]?.values?.txHash || '';
      return {
        success: true,
        txHash,
        explorerUrl: `${chain.explorer}/${txHash}`,
        message: `Send ${params.amount} ${params.token} to ${params.to}`,
      };
    } catch (err: any) {
      return { success: false, txHash: '', explorerUrl: '', message: err.message };
    }
  }

  calculateFee(amount: number): number {
    return amount * this.PLATFORM_FEE_BPS / 10000;
  }

  withFee(amount: number): { net: number; fee: number; total: number } {
    const fee = this.calculateFee(amount);
    return { net: amount, fee, total: amount + fee };
  }

  async getUnifiedBalance(address: string, chains?: ArcChain[]): Promise<Record<ArcChain, number>> {
    const targetChains = chains || ['arc', 'base', 'polygon', 'ethereum'];
    const balances: Record<ArcChain, number> = {} as Record<ArcChain, number>;
    const client = await this.getCircleClient();

    for (const chain of targetChains) {
      try {
        if (client) {
          const balance = await client.balances.getBalance({
            chain: chain,
            address: address,
            token: 'USDC',
          });
          balances[chain] = parseFloat(balance.balance) / 1e6;
        } else {
          throw new Error('No client');
        }
      } catch {
        try {
          const cctpBalance = await cctpService.getUSDCBalance(chain, address);
          balances[chain] = cctpBalance;
        } catch {
          balances[chain] = 0;
        }
      }
    }

    return balances;
  }

  async estimateBridgeFee(fromChain: ArcChain, toChain: ArcChain, amount: number): Promise<number> {
    return cctpService.estimateFee(fromChain, toChain, amount);
  }

  async estimateBridge(params: BridgeParams): Promise<{ fees: Array<{ type: string; amount: string }> }> {
    const fromConfig = CHAIN_MAP[params.fromChain];
    const toConfig = CHAIN_MAP[params.toChain];
    const adapter = await this.getAdapter();

    const result = await this.kit.estimateBridge({
      from: { adapter, chain: fromConfig.appKitChain },
      to: { adapter, chain: toConfig.appKitChain },
      amount: params.amount.toString(),
    });

    return result;
  }

  async getUSDCBalance(chain: ArcChain, address: string): Promise<number> {
    return cctpService.getUSDCBalance(chain, address);
  }

  async getSupportedChains(): Promise<string[]> {
    return cctpService.getSupportedChains();
  }
}

export const arcAppKit = new ArcAppKit();
export type { BridgeParams, SwapParams, SendParams, SwapResult, SendResult };
export type { CCTPTransfer, CCTPStep };