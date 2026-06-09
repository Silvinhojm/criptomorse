// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet

import { ethers } from "ethers";
import { getQuote, toTokenUnits } from "./lifi-executor";

export const NETWORKS = {
  arc: {
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
  base: {
    chainId: 8453,
    name: "Base Mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export interface SwapResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  fromAmount: number;
  toAmount: number;
  action: "BUY" | "SELL" | "HOLD";
  message: string;
  timestamp: number;
  confirmed: boolean;
}

class RealSwapExecutor {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private networkKey: keyof typeof NETWORKS = "arc";
  private userAddress: string = "";

  async initialize(privateKey: string, networkKey: keyof typeof NETWORKS = "arc"): Promise<boolean> {
    try {
      this.networkKey = networkKey;
      const net = NETWORKS[networkKey];
      this.provider = new ethers.JsonRpcProvider(net.rpcUrl);
      this.signer = new ethers.Wallet(privateKey, this.provider);
      this.userAddress = await this.signer.getAddress();
      console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress}`);
      return true;
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  async getBalance(token: "USDC" | "EURC"): Promise<number> {
    if (!this.provider || !this.userAddress) return 0;
    try {
      const net = NETWORKS[this.networkKey];
      const addr = token === "USDC" ? net.usdc : net.eurc;
      const contract = new ethers.Contract(addr, ERC20_ABI, this.provider);
      const [raw, decimals] = await Promise.all([
        contract.balanceOf(this.userAddress),
        contract.decimals(),
      ]);
      return parseFloat(ethers.formatUnits(raw, decimals));
    } catch {
      return 0;
    }
  }

  async executeSwap(
    action: "BUY" | "SELL",
    amountUsd: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    const net = NETWORKS[this.networkKey];
    const timestamp = Date.now();
    const log = (msg: string) => { console.log(msg); onUpdate?.(msg); };

    if (!this.signer || !this.provider) {
      return this._fail(action, amountUsd, "Executor não inicializado", timestamp);
    }

    try {
      const fromToken = action === "BUY" ? net.usdc : net.eurc;
      const toToken   = action === "BUY" ? net.eurc : net.usdc;
      const fromAmount = toTokenUnits(amountUsd, 6);

      log(`🔍 Buscando cotação LI.FI para ${action} $${amountUsd}...`);

      const quote = await getQuote({
        fromChain:   net.chainId,
        toChain:     net.chainId,
        fromToken,
        toToken,
        fromAmount,
        fromAddress: this.userAddress,
        toAddress:   this.userAddress,
        slippage:    0.005,
      });

      if (!quote || !quote.transactionRequest) {
        return this._fail(action, amountUsd, "Nenhuma rota LI.FI disponível", timestamp);
      }

      const toAmount = parseFloat(quote.toAmount) / 1e6;
      log(`✅ Rota via ${quote.tool} | Estimativa: ${toAmount.toFixed(4)} ${action === "BUY" ? "EURC" : "USDC"}`);

      // Aprovar token
      const tx = quote.transactionRequest;
      log(`🔓 Verificando allowance...`);
      const token = new ethers.Contract(fromToken, ERC20_ABI, this.signer);
      const allowance: bigint = await token.allowance(this.userAddress, tx.to);
      if (allowance < BigInt(fromAmount)) {
        log(`🔓 Aprovando token para o contrato LI.FI...`);
        const approveTx = await token.approve(tx.to, ethers.MaxUint256);
        await approveTx.wait();
        log(`✅ Aprovação confirmada!`);
      }

      // Enviar transação
      log(`📝 Assinando e enviando transação...`);
      const txResponse = await this.signer.sendTransaction({
        to:       tx.to,
        data:     tx.data,
        value:    BigInt(tx.value ?? "0"),
        gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      });

      log(`🔗 TX enviada: ${txResponse.hash}`);
      log(`⏳ Aguardando confirmação no bloco...`);

      const receipt = await txResponse.wait(1);

      if (!receipt || receipt.status === 0) {
        return this._fail(action, amountUsd, "TX falhou on-chain (status 0)", timestamp);
      }

      const explorerUrl = `${net.explorer}/tx/${txResponse.hash}`;
      log(`✅ CONFIRMADO no bloco ${receipt.blockNumber}!`);
      log(`🔗 ${explorerUrl}`);

      return {
        success: true,
        txHash: txResponse.hash,
        explorerUrl,
        fromAmount: amountUsd,
        toAmount,
        action,
        message: `✅ ${action} $${amountUsd} → ${toAmount.toFixed(4)} | TX: ${txResponse.hash.slice(0, 10)}...`,
        timestamp,
        confirmed: true,
      };

    } catch (err: any) {
      const msg = err?.code === "ACTION_REJECTED" ? "Transação rejeitada pelo usuário"
        : err?.message?.includes("insufficient") ? "Saldo insuficiente"
        : err?.message || "Erro desconhecido";
      log(`❌ Erro: ${msg}`);
      return this._fail(action, amountUsd, msg, timestamp);
    }
  }

  getAddress(): string { return this.userAddress; }
  getExplorerUrl(txHash: string): string {
    return `${NETWORKS[this.networkKey].explorer}/tx/${txHash}`;
  }

  private _fail(action: "BUY" | "SELL", amount: number, reason: string, timestamp: number): SwapResult {
    return {
      success: false, txHash: "", explorerUrl: "",
      fromAmount: amount, toAmount: 0, action,
      message: `❌ ${action} falhou: ${reason}`,
      timestamp, confirmed: false,
    };
  }
}

export const realSwap = new RealSwapExecutor();
