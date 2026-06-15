// lib/batch-transactions.ts
// Suporte a Batch Transactions - v0.7.2 hardfork (18 Jun 2026)
// Multiplas chamadas em uma unica transacao na blockchain

import { ethers } from 'ethers';

interface BatchCall {
  to: string;
  data: string;
  value?: bigint;
  description?: string;
}

interface BatchTransaction {
  id: string;
  calls: BatchCall[];
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  timestamp: number;
  gasUsed?: bigint;
}

interface BatchResult {
  success: boolean;
  txHash?: string;
  results?: string[];
  error?: string;
}

interface BatchTemplate {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildCalls: (params: any) => BatchCall[];
}

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

class BatchTransactionManager {
  private history: BatchTransaction[] = [];
  private batchId = 0;

  createBatch(calls: BatchCall[]): BatchTransaction {
    const tx: BatchTransaction = {
      id: `batch_${++this.batchId}`,
      calls,
      status: 'pending',
      timestamp: Date.now(),
    };
    this.history.push(tx);
    return tx;
  }

  async execute(provider: ethers.JsonRpcProvider, signer: ethers.Signer, batch: BatchTransaction): Promise<BatchResult> {
    try {
      const nonce = await provider.getTransactionCount(await signer.getAddress());

      for (let i = 0; i < batch.calls.length; i++) {
        const call = batch.calls[i];
        const tx = await signer.sendTransaction({
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
          nonce: nonce + i,
        });
        await tx.wait();
        batch.status = 'submitted';
        batch.txHash = tx.hash;
      }

      batch.status = 'confirmed';
      return { success: true, txHash: batch.txHash };
    } catch (err: any) {
      batch.status = 'failed';
      return { success: false, error: err.message };
    }
  }

  buildTransferBatch(
    tokenAddress: string,
    transfers: { to: string; amount: number; decimals?: number }[]
  ): BatchCall[] {
    const iface = new ethers.Interface(ERC20_ABI);
    return transfers.map(t => ({
      to: tokenAddress,
      data: iface.encodeFunctionData('transfer', [
        t.to,
        ethers.parseUnits(t.amount.toFixed(t.decimals ?? 6), t.decimals ?? 6),
      ]),
      description: `Transfer ${t.amount} to ${t.to.slice(0, 6)}...`,
    }));
  }

  buildTradeBatch(
    routerAddress: string,
    trades: { to: string; data: string }[]
  ): BatchCall[] {
    return trades.map(t => ({
      to: t.to,
      data: t.data,
      description: 'Trade execution',
    }));
  }

  getHistory(): BatchTransaction[] {
    return [...this.history].reverse();
  }

  getPending(): BatchTransaction[] {
    return this.history.filter(t => t.status === 'pending' || t.status === 'submitted');
  }

  getStats() {
    const total = this.history.length;
    const confirmed = this.history.filter(t => t.status === 'confirmed').length;
    return { total, confirmed, failed: total - confirmed };
  }
}

// Templates predefinidos para uso no robo
const TRADE_BATCH: BatchTemplate = {
  name: 'Trade + Approve',
  description: 'Approve + Swap em batch',
  buildCalls: (params: { token: string; spender: string; amount: bigint; swapData: string; swapTarget: string }) => {
    const iface = new ethers.Interface(ERC20_ABI);
    return [
      {
        to: params.token,
        data: iface.encodeFunctionData('approve', [params.spender, params.amount]),
        description: 'Approve USDC spend',
      },
      {
        to: params.swapTarget,
        data: params.swapData,
        description: 'Execute swap',
      },
    ];
  },
};

const SETTLE_BATCH: BatchTemplate = {
  name: 'Settle Trade',
  description: 'Job payout + agent fee em batch',
  buildCalls: (params: { usdcAddress: string; payments: { to: string; amount: bigint }[] }) => {
    const iface = new ethers.Interface(ERC20_ABI);
    return params.payments.map(p => ({
      to: params.usdcAddress,
      data: iface.encodeFunctionData('transfer', [p.to, p.amount]),
      description: `Pay ${p.to.slice(0, 6)}...`,
    }));
  },
};

export const batchManager = new BatchTransactionManager();
export { TRADE_BATCH, SETTLE_BATCH };
export type { BatchCall, BatchTransaction, BatchResult, BatchTemplate };
