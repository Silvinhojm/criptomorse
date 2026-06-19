import { ethers } from 'ethers';
import { feeMonetization } from './fee-monetization';
import { transactionMemos } from './transaction-memos';
import { arcMemo } from './arc-memo';
import { confidenceStaking } from './confidence-staking';
import { arcAppKit, ArcChain } from './arc-app-kit-native';
import type { CCTPTransfer, CCTPStep } from './cctp';

// ─── Constantes de rede ────────────────────────────────────────────────────────

const ARC_RPC  = 'https://rpc.testnet.arc.network';
const EXPLORER = 'https://testnet.arcscan.app';

// ─── Endereços de tokens ───────────────────────────────────────────────────────

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const WETH = '0x4200000000000000000000000000000000000006';

/** Mapeia símbolo → endereço on-chain na rede ARC */
const TOKEN_ADDRESSES: Record<string, string> = { USDC, EURC, WETH };

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface MicroTradeConfig {
  minProfitBps:          number;
  maxSlippageBps:        number;
  gasBuffer:             number;
  batchEnabled:          boolean;
  memoEnabled:           boolean;
  unifiedBalanceEnabled: boolean;
  autoStake:             boolean;
}

export interface MicroTradeResult {
  success:     boolean;
  profit:      number;
  txHash:      string;
  explorerUrl: string;
  fee:         number;
  gasUsed:     number;
  memoHex:     string;
  message:     string;
  confirmed:   boolean;
  fromToken:   string;
  toToken:     string;
  fromAmount:  number;
  toAmount:    number;
}

export interface PendingBatch {
  calls:       Array<{ to: string; data: string; value?: bigint; desc: string }>;
  totalAmount: number;
  tradeCount:  number;
}

// Re-exports de tipos do CCTP para que consumidores não precisem importar cctp.ts diretamente
export type { CCTPTransfer, CCTPStep };

// ─── Classe principal ──────────────────────────────────────────────────────────

class ArcMicroTrader {
  private config: MicroTradeConfig = {
    minProfitBps:          5,
    maxSlippageBps:        100,
    gasBuffer:             0.006,
    batchEnabled:          true,
    memoEnabled:           true,
    unifiedBalanceEnabled: true,
    autoStake:             true,
  };

  // ── Configuração ──────────────────────────────────────────────────────────────

  setConfig(partial: Partial<MicroTradeConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): MicroTradeConfig {
    return { ...this.config };
  }

  // ── Provider / Signer ─────────────────────────────────────────────────────────

  private getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(ARC_RPC);
  }

  async getSigner(): Promise<{ signer: ethers.Signer; address: string }> {
    if (!window.ethereum) throw new Error('MetaMask not available');
    const bp      = new ethers.BrowserProvider(window.ethereum);
    const signer  = await bp.getSigner();
    const address = await signer.getAddress();
    return { signer, address };
  }

  // ── Saldos ────────────────────────────────────────────────────────────────────

  /**
   * Saldo USDC na chain ARC via arcAppKit.getUSDCBalance().
   * Para outros tokens (EURC, WETH) faz leitura direta no contrato ERC-20.
   */
  async getBalance(token: string = USDC): Promise<number> {
    try {
      if (token === USDC) {
        const { address } = await this.getSigner();
        return await arcAppKit.getUSDCBalance('arc', address);
      }

      const { address } = await this.getSigner();
      const provider    = this.getProvider();
      const contract    = new ethers.Contract(token, ERC20_ABI, provider);
      const [bal, dec]  = await Promise.all([
        contract.balanceOf(address) as Promise<bigint>,
        contract.decimals()         as Promise<number>,
      ]);
      return parseFloat(ethers.formatUnits(bal, dec));
    } catch {
      return 0;
    }
  }

  /**
   * Saldo USDC unificado cross-chain via arcAppKit.getUnifiedBalance().
   * Retorna a soma de todas as chains suportadas.
   */
  async getUnifiedBalance(): Promise<number> {
    const { address } = await this.getSigner();
    const balances    = await arcAppKit.getUnifiedBalance(address);
    return Object.values(balances).reduce((sum, v) => sum + v, 0);
  }

  // ── Gas ───────────────────────────────────────────────────────────────────────

  async estimateGas(): Promise<number> {
    try {
      const provider = this.getProvider();
      const feeData  = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');
      return parseFloat(ethers.formatUnits(gasPrice * BigInt(280_000), 18));
    } catch {
      return this.config.gasBuffer;
    }
  }

  // ── Rentabilidade ─────────────────────────────────────────────────────────────

  isMicroTradeProfitable(
    amount:            number,
    expectedProfitBps: number,
  ): { profitable: boolean; netProfit: number; reason: string } {
    const gas         = this.config.gasBuffer;
    const feeCalc     = feeMonetization.calculateFee('USDC_EURC', amount);
    const totalCost   = gas + feeCalc.fee;
    const grossProfit = amount * expectedProfitBps / 10_000;
    const netProfit   = grossProfit - totalCost;
    const minProfit   = amount * this.config.minProfitBps / 10_000;

    if (netProfit < minProfit) {
      return {
        profitable: false,
        netProfit:  0,
        reason: `Net $${netProfit.toFixed(6)} < min $${minProfit.toFixed(6)} (gas: $${gas.toFixed(4)}, fee: $${feeCalc.fee.toFixed(4)})`,
      };
    }

    return { profitable: true, netProfit, reason: `Net profit: $${netProfit.toFixed(6)}` };
  }

  // ── Swap (trade na mesma chain) ───────────────────────────────────────────────

  async executeMicroTrade(
    fromToken: string,
    toToken:   string,
    amount:    number,
    memo?:     string,
  ): Promise<MicroTradeResult> {
    const startTime = Date.now();
    const tradeId   = `micro_${startTime}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      const { address } = await this.getSigner();
      const provider    = this.getProvider();

      const feeCalc   = feeMonetization.calculateFee(`${fromToken}_${toToken}`, amount);
      const netAmount = feeCalc.netAmount;

      const fromAddr = TOKEN_ADDRESSES[fromToken];
      const toAddr   = TOKEN_ADDRESSES[toToken];
      if (!fromAddr || !toAddr) {
        throw new Error(`Token não suportado: ${fromToken}->${toToken}`);
      }

      // Swap via arcAppKit – usa SwapParams da v2 (chain: ArcChain, não chainId)
      const swapResult = await arcAppKit.swap({
        chain:       'arc',
        fromToken:   fromAddr,
        toToken:     toAddr,
        amount:      netAmount,
        fromAddress: address,
        slippage:    this.config.maxSlippageBps / 100, // arcAppKit espera % (0-100), não BPS
      });

      if (!swapResult.success || !swapResult.txHash) {
        throw new Error(`Swap falhou: ${swapResult.message}`);
      }

      const receipt = await provider.waitForTransaction(swapResult.txHash, 1, 100);

      const toAmountNum = swapResult.toAmount;
      const profit      = toAmountNum - netAmount;
      const gasUsed     = receipt
        ? parseFloat(ethers.formatUnits(receipt.gasUsed * (receipt.gasPrice ?? BigInt(20e9)), 18))
        : this.config.gasBuffer;

      if (this.config.autoStake && profit > 0) {
        confidenceStaking.placeStake(
          'ArcTrader',
          profit > 0.001 ? 'buy' : 'sell',
          Math.min(90, 50 + profit * 100),
        );
      }

      const memoHex = memo
        ? transactionMemos
            .createTradeMemo(tradeId, 'ArcMicroTrader', {
              pair:   `${fromToken}/${toToken}`,
              amount: String(amount),
              net:    String(netAmount),
            })
            .hex
        : '';

      // Post-trade memo on-chain (apenas Arc, se habilitado)
      let memoTxHash: string | undefined
      if (this.config.memoEnabled && swapResult.txHash) {
        try {
          const { signer } = await this.getSigner()
          const memoId = transactionMemos.generateMemoId(`trade:${tradeId}`)
          const memoData = transactionMemos.encodeMemoData({
            tradeId,
            pair: `${fromToken}/${toToken}`,
            profit: String(profit),
            txHash: swapResult.txHash,
          })
          memoTxHash = await arcMemo.sendUSDCWithMemo(
            signer, address, 0, memoId, memoData
          )
          console.log(`[MICRO_TRADER] 📝 Memo on-chain: ${memoTxHash.slice(0, 10)}...`)
        } catch {
          // memo falhou — não interrompe o trade
        }
      }

      const elapsed = Date.now() - startTime;

      return {
        success:     true,
        profit,
        txHash:      swapResult.txHash,
        explorerUrl: `${EXPLORER}/tx/${swapResult.txHash}`,
        fee:         feeCalc.fee,
        gasUsed,
        memoHex,
        message:     `Trade ${tradeId}: ${fromToken}→${toToken} $${netAmount.toFixed(6)} | profit $${profit.toFixed(6)} | gas $${gasUsed.toFixed(4)} | ${elapsed}ms`,
        confirmed:   true,
        fromToken,
        toToken,
        fromAmount:  netAmount,
        toAmount:    toAmountNum,
      };
    } catch (err: any) {
      return {
        success:     false,
        profit:      0,
        txHash:      '',
        explorerUrl: '',
        fee:         0,
        gasUsed:     0,
        memoHex:     '',
        message:     `Trade ${tradeId} failed: ${err.message?.slice(0, 100) ?? 'Unknown error'}`,
        confirmed:   false,
        fromToken,
        toToken,
        fromAmount:  amount,
        toAmount:    0,
      };
    }
  }

  // ── Bridge via CCTP (arcAppKit.bridge) ───────────────────────────────────────

  /**
   * Bridge cross-chain via Circle CCTP, exposto pelo arcAppKit.
   * @param onStep callback opcional para acompanhar cada etapa do CCTP
   */
  async bridge(
    fromChain: ArcChain,
    toChain:   ArcChain,
    token:     string,
    amount:    number,
    recipient: string,
    onStep?:   (step: CCTPStep) => void,
  ): Promise<CCTPTransfer> {
    const { address } = await this.getSigner();
    const tokenAddr   = TOKEN_ADDRESSES[token];
    if (!tokenAddr) throw new Error(`Token não suportado: ${token}`);

    return arcAppKit.bridge({
      fromChain,
      toChain,
      amount,
      token:       tokenAddr,
      fromAddress: address,
      recipient,
      onStep,
    });
  }

  /**
   * Estima o custo de um bridge antes de executá-lo.
   */
  async estimateBridgeFee(
    fromChain: ArcChain,
    toChain:   ArcChain,
    amount:    number,
  ): Promise<number> {
    return arcAppKit.estimateBridgeFee(fromChain, toChain, amount);
  }

  // ── Send via arcAppKit ────────────────────────────────────────────────────────

  /**
   * Envia tokens para um endereço via arcAppKit.sendToken().
   * Mapeia o símbolo (USDC, EURC…) para o endereço on-chain antes de chamar o kit.
   */
  async send(
    token:   string,
    to:      string,
    amount:  number,
    chain:   ArcChain = 'arc',
    memoRef?: string,
  ): Promise<{ txHash: string; explorerUrl: string; memoTxHash?: string }> {
    const { signer, address } = await this.getSigner();
    const tokenAddr   = TOKEN_ADDRESSES[token];
    if (!tokenAddr) throw new Error(`Token não suportado: ${token}`);

    // Se memoRef foi informado e a chain é Arc, usa Memo contract on-chain
    if (memoRef && chain === 'arc') {
      const memoId = transactionMemos.generateMemoId(memoRef)
      const memoData = transactionMemos.encodeMemoData({
        token,
        amount: String(amount),
        ref: memoRef,
      })
      const memoTxHash = await arcMemo.sendUSDCWithMemo(signer, to, amount, memoId, memoData)
      const explorerUrl = `https://testnet.arcscan.app/tx/${memoTxHash}`
      return { txHash: memoTxHash, explorerUrl, memoTxHash }
    }

    const result = await arcAppKit.sendToken({
      chain,
      to,
      amount,
      from:  address,
      token: tokenAddr,
    });

    if (!result.success) throw new Error(`Send falhou: ${result.message}`);

    return {
      txHash:      result.txHash,
      explorerUrl: result.explorerUrl,
    };
  }

  // ── Batch ─────────────────────────────────────────────────────────────────────

  async executeBatchMicroTrade(
    trades: Array<{ fromToken: string; toToken: string; amount: number; memo?: string }>,
  ): Promise<MicroTradeResult[]> {
    return Promise.all(
      trades.map(t => this.executeMicroTrade(t.fromToken, t.toToken, t.amount, t.memo)),
    );
  }

  /** Alias mantido para compatibilidade com chamadas existentes. */
  batchMicroTrade(
    fromToken: string,
    toToken:   string,
    amount:    number,
    memo?:     string,
  ): Promise<MicroTradeResult> {
    return this.executeMicroTrade(fromToken, toToken, amount, memo);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    usdcBalance:    number;
    eurcBalance:    number;
    unifiedBalance: number;
    gasEstimate:    number;
    config:         MicroTradeConfig;
  }> {
    const [usdcBalance, eurcBalance, unifiedBalance, gasEstimate] = await Promise.all([
      this.getBalance(USDC),
      this.getBalance(EURC),
      this.getUnifiedBalance(),
      this.estimateGas(),
    ]);

    return { usdcBalance, eurcBalance, unifiedBalance, gasEstimate, config: this.config };
  }
}

// ─── Singleton exportado ───────────────────────────────────────────────────────

export const arcMicroTrader = new ArcMicroTrader();