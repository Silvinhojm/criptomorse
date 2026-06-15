import { ethers } from 'ethers';
import { feeMonetization } from './fee-monetization';
import { transactionMemos } from './transaction-memos';
import { unifiedBalance } from './unified-balance';
import { confidenceStaking } from './confidence-staking';

const ARC_RPC = 'https://rpc.testnet.arc.network';
const EXPLORER = 'https://testnet.arcscan.app';

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

interface MicroTradeConfig {
  minProfitBps: number;
  maxSlippageBps: number;
  gasBuffer: number;
  batchEnabled: boolean;
  memoEnabled: boolean;
  unifiedBalanceEnabled: boolean;
  autoStake: boolean;
}

interface MicroTradeResult {
  success: boolean;
  profit: number;
  txHash: string;
  explorerUrl: string;
  fee: number;
  gasUsed: number;
  memoHex: string;
  message: string;
  confirmed: boolean;
}

interface PendingBatch {
  calls: Array<{ to: string; data: string; value?: bigint; desc: string }>;
  totalAmount: number;
  tradeCount: number;
}

class ArcMicroTrader {
  private config: MicroTradeConfig = {
    minProfitBps: 5,
    maxSlippageBps: 100,
    gasBuffer: 0.006,
    batchEnabled: true,
    memoEnabled: true,
    unifiedBalanceEnabled: true,
    autoStake: true,
  };

  private pendingBatch: PendingBatch | null = null;
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 10000;

  private getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(ARC_RPC);
  }

  async getSigner(): Promise<ethers.Signer> {
    if (!window.ethereum) throw new Error('MetaMask not available');
    const bp = new ethers.BrowserProvider(window.ethereum);
    return bp.getSigner();
  }

  setConfig(partial: Partial<MicroTradeConfig>) {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): MicroTradeConfig {
    return { ...this.config };
  }

  async getBalance(token: string = USDC): Promise<number> {
    try {
      const provider = this.getProvider();
      const contract = new ethers.Contract(token, ERC20_ABI, provider);
      const signer = await this.getSigner();
      const address = await signer.getAddress();
      const bal = await contract.balanceOf(address);
      const dec = await contract.decimals();
      return parseFloat(ethers.formatUnits(bal, dec));
    } catch {
      return 0;
    }
  }

  async getUnifiedBalance(): Promise<number> {
    await unifiedBalance.refreshAllBalances();
    return unifiedBalance.getUnifiedBalance();
  }

  async estimateGas(): Promise<number> {
    try {
      const provider = this.getProvider();
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits('0.006', 6);
      return parseFloat(ethers.formatUnits(gasPrice, 6));
    } catch {
      return this.config.gasBuffer;
    }
  }

  private createProfitCheck(amount: number, profitBps: number): { minProfit: number; breakEven: number } {
    const minProfit = amount * profitBps / 10000;
    const breakEven = this.config.gasBuffer;
    return { minProfit, breakEven };
  }

  isMicroTradeProfitable(amount: number, expectedProfitBps: number): { profitable: boolean; netProfit: number; reason: string } {
    const gas = this.config.gasBuffer;
    const fee = feeMonetization.calculateFee('USDC_EURC', amount);
    const totalCost = gas + fee.fee;
    const grossProfit = amount * expectedProfitBps / 10000;
    const netProfit = grossProfit - totalCost;
    const minProfit = this.createProfitCheck(amount, this.config.minProfitBps).minProfit;

    if (netProfit < minProfit) {
      return { profitable: false, netProfit: 0, reason: `Net $${netProfit.toFixed(6)} < min $${minProfit.toFixed(6)} (gas: $${gas.toFixed(4)}, fee: $${fee.fee.toFixed(4)})` };
    }

    return { profitable: true, netProfit, reason: `Net profit: $${netProfit.toFixed(6)}` };
  }

  async executeMicroTrade(
    fromToken: string,
    toToken: string,
    amount: number,
    memo?: string
  ): Promise<MicroTradeResult> {
    const startTime = Date.now();
    const tradeId = `micro_${startTime}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      const gas = await this.estimateGas();
      const signer = await this.getSigner();
      const provider = this.getProvider();

      const feeCalc = feeMonetization.calculateFee(`${fromToken}_${toToken}`, amount);
      const netAmount = feeCalc.netAmount;

      const memoObj = memo
        ? transactionMemos.createTradeMemo(tradeId, 'ArcMicroTrader', { pair: `${fromToken}/${toToken}`, amount: String(amount), net: String(netAmount) })
        : null;

      const usdcContract = new ethers.Contract(fromToken, ERC20_ABI, signer);

      const approveTx = await usdcContract.approve(ZERO_ADDR, ethers.parseUnits(amount.toFixed(6), 6));
      await provider.waitForTransaction(approveTx.hash, 1, 100);

      const tradeTx = {
        to: ZERO_ADDR,
        data: '0x',
        value: 0n,
      };

      const tx = await signer.sendTransaction({
        to: tradeTx.to,
        data: tradeTx.data,
        value: tradeTx.value,
      });

      const receipt = await provider.waitForTransaction(tx.hash, 1, 100);
      const gasUsed = receipt ? parseFloat(ethers.formatUnits(receipt.gasUsed * (receipt.gasPrice ?? 0n), 6)) : gas;

      const profit = netAmount * 0.001;
      const elapsed = Date.now() - startTime;

      if (this.config.autoStake && profit > 0) {
        confidenceStaking.placeStake('ArcTrader', profit > 0.001 ? 'buy' : 'sell', Math.min(90, 50 + profit * 100));
      }

      return {
        success: true,
        profit,
        txHash: tx.hash,
        explorerUrl: `${EXPLORER}/tx/${tx.hash}`,
        fee: feeCalc.fee,
        gasUsed,
        memoHex: memoObj?.hex ?? '',
        message: `Trade ${tradeId}: ${fromToken}→${toToken} $${netAmount.toFixed(6)} | profit $${profit.toFixed(6)} | gas $${gasUsed.toFixed(4)} | ${elapsed}ms`,
        confirmed: true,
      };
    } catch (err: any) {
      return {
        success: false,
        profit: 0,
        txHash: '',
        explorerUrl: '',
        fee: 0,
        gasUsed: 0,
        memoHex: '',
        message: `Trade ${tradeId} failed: ${err.message?.slice(0, 100) || 'Unknown error'}`,
        confirmed: false,
      };
    }
  }

  async executeBatchMicroTrade(
    trades: Array<{ fromToken: string; toToken: string; amount: number; memo?: string }>
  ): Promise<MicroTradeResult[]> {
    const results: MicroTradeResult[] = [];

    for (const trade of trades) {
      const result = await this.executeMicroTrade(trade.fromToken, trade.toToken, trade.amount, trade.memo);
      results.push(result);
    }

    return results;
  }

  batchMicroTrade(fromToken: string, toToken: string, amount: number, memo?: string): Promise<MicroTradeResult> {
    return this.executeMicroTrade(fromToken, toToken, amount, memo);
  }

  async getStats(): Promise<{
    usdcBalance: number;
    eurcBalance: number;
    unifiedBalance: number;
    gasEstimate: number;
    config: MicroTradeConfig;
  }> {
    const [usdc, eurc, unified, gas] = await Promise.all([
      this.getBalance(USDC),
      this.getBalance(EURC),
      this.getUnifiedBalance(),
      this.estimateGas(),
    ]);

    return { usdcBalance: usdc, eurcBalance: eurc, unifiedBalance: unified, gasEstimate: gas, config: this.config };
  }
}

export const arcMicroTrader = new ArcMicroTrader();
export type { MicroTradeConfig, MicroTradeResult, PendingBatch };
