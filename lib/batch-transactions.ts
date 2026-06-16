import { ethers } from "ethers";
import { getArcFeeParams, isArcChain } from "./arc-gas";

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calldata calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)",
  "function aggregate(tuple(address target, bytes callData)[] calldata calls) external payable returns (uint256 blockNumber, bytes[] returnData)",
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calldata calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) external view returns (uint256 balance)",
  "function getBlockHash(uint256 blockNumber) external view returns (bytes32 blockHash)",
  "function getLastBlockHash() external view returns (bytes32 blockHash)",
  "function getCurrentBlockTimestamp() external view returns (uint256 timestamp)",
  "function getCurrentBlockDifficulty() external view returns (uint256 difficulty)",
  "function getCurrentBlockGasLimit() external view returns (uint256 gaslimit)",
  "function getBasefee() external view returns (uint256 basefee)",
  "function getChainId() external view returns (uint256 chainid)",
];

interface BatchCall {
  to: string;
  data: string;
  value?: bigint;
  description?: string;
  allowFailure?: boolean;
}

interface BatchTransaction {
  id: string;
  calls: BatchCall[];
  status: "pending" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  timestamp: number;
  gasUsed?: bigint;
}

interface BatchResult {
  success: boolean;
  txHash?: string;
  results?: { success: boolean; returnData: string }[];
  error?: string;
}

interface BatchTemplate {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildCalls: (params: any) => BatchCall[];
}

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

class BatchTransactionManager {
  private history: BatchTransaction[] = [];
  private batchId = 0;

  createBatch(calls: BatchCall[]): BatchTransaction {
    const tx: BatchTransaction = {
      id: `batch_${++this.batchId}`,
      calls,
      status: "pending",
      timestamp: Date.now(),
    };
    this.history.push(tx);
    return tx;
  }

  async execute(provider: ethers.JsonRpcProvider, signer: ethers.Signer, batch: BatchTransaction): Promise<BatchResult> {
    if (batch.calls.length === 0) {
      return { success: false, error: "Empty batch" };
    }

    try {
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      if (isArcChain(chainId) && batch.calls.length > 1) {
        return this._executeViaMulticall3(provider, signer, batch, chainId);
      }

      return this._executeSequential(signer, batch, chainId);
    } catch (err: any) {
      batch.status = "failed";
      return { success: false, error: err.message };
    }
  }

  private async _executeViaMulticall3(
    provider: ethers.JsonRpcProvider,
    signer: ethers.Signer,
    batch: BatchTransaction,
    chainId: number
  ): Promise<BatchResult> {
    try {
      const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, signer);

      const calls3 = batch.calls.map((c) => ({
        target: c.to,
        allowFailure: c.allowFailure ?? true,
        callData: c.data,
      }));

      const gasParams = isArcChain(chainId) ? getArcFeeParams() : {};

      const tx = await multicall.aggregate3(calls3, {
        ...gasParams,
      });

      batch.status = "submitted";
      batch.txHash = tx.hash;

      const receipt = await tx.wait();
      batch.status = "confirmed";

      const logs = await provider.getLogs({
        address: MULTICALL3_ADDRESS,
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

      return {
        success: true,
        txHash: tx.hash,
        results: batch.calls.map(() => ({ success: true, returnData: "0x" })),
      };
    } catch (err: any) {
      batch.status = "failed";
      if (err.message?.includes("gas") || err.message?.includes("underpriced")) {
        return this._executeSequential(signer, batch, chainId);
      }
      return { success: false, error: err.message };
    }
  }

  private async _executeSequential(
    signer: ethers.Signer,
    batch: BatchTransaction,
    chainId: number
  ): Promise<BatchResult> {
    try {
      const gasParams = isArcChain(chainId) ? getArcFeeParams() : {};

      for (let i = 0; i < batch.calls.length; i++) {
        const call = batch.calls[i];
        const tx = await signer.sendTransaction({
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
          ...gasParams,
        });
        await tx.wait();
        batch.status = "submitted";
        batch.txHash = tx.hash;
      }

      batch.status = "confirmed";
      return { success: true, txHash: batch.txHash };
    } catch (err: any) {
      batch.status = "failed";
      return { success: false, error: err.message };
    }
  }

  buildTransferBatch(
    tokenAddress: string,
    transfers: { to: string; amount: number; decimals?: number }[]
  ): BatchCall[] {
    const iface = new ethers.Interface(ERC20_ABI);
    return transfers.map((t) => ({
      to: tokenAddress,
      data: iface.encodeFunctionData("transfer", [
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
    return trades.map((t) => ({
      to: t.to,
      data: t.data,
      description: "Trade execution",
    }));
  }

  getHistory(): BatchTransaction[] {
    return [...this.history].reverse();
  }

  getPending(): BatchTransaction[] {
    return this.history.filter((t) => t.status === "pending" || t.status === "submitted");
  }

  getStats() {
    const total = this.history.length;
    const confirmed = this.history.filter((t) => t.status === "confirmed").length;
    return { total, confirmed, failed: total - confirmed };
  }
}

const TRADE_BATCH: BatchTemplate = {
  name: "Trade + Approve",
  description: "Approve + Swap em batch",
  buildCalls: (params: { token: string; spender: string; amount: bigint; swapData: string; swapTarget: string }) => {
    const iface = new ethers.Interface(ERC20_ABI);
    return [
      {
        to: params.token,
        data: iface.encodeFunctionData("approve", [params.spender, params.amount]),
        description: "Approve USDC spend",
      },
      {
        to: params.swapTarget,
        data: params.swapData,
        description: "Execute swap",
      },
    ];
  },
};

const SETTLE_BATCH: BatchTemplate = {
  name: "Settle Trade",
  description: "Job payout + agent fee em batch",
  buildCalls: (params: { usdcAddress: string; payments: { to: string; amount: bigint }[] }) => {
    const iface = new ethers.Interface(ERC20_ABI);
    return params.payments.map((p) => ({
      to: params.usdcAddress,
      data: iface.encodeFunctionData("transfer", [p.to, p.amount]),
      description: `Pay ${p.to.slice(0, 6)}...`,
    }));
  },
};

export const batchManager = new BatchTransactionManager();
export { TRADE_BATCH, SETTLE_BATCH };
export type { BatchCall, BatchTransaction, BatchResult, BatchTemplate };
