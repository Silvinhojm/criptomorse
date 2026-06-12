// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet

import { ethers, type JsonRpcSigner } from "ethers";
import { getQuoteWithRetry, toTokenUnits } from "./lifi-executor";

export const NETWORKS = {
  arc: {
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
  polygon: {
    chainId: 137,
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon.drpc.org",
    explorer: "https://polygonscan.com",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    eurc: "0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4", // EURC correto na Polygon
  },
  base: {
    chainId: 8453,
    name: "Base Mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  },
  ethereum: {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const isPrivateKey = (value: string) => /^0x?[a-fA-F0-9]{64}$/.test(value.trim());

async function resolveWalletFromBrowser(): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) return "";

  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] || "";
  } catch {
    return "";
  }
}

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

const SLIPPAGE_LEVELS = {
  BUY: [0.005, 0.01, 0.03],
  SELL: [0.05, 0.1, 0.15],
} as const;

class RealSwapExecutor {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | JsonRpcSigner | null = null;
  private networkKey: keyof typeof NETWORKS = "arc";
  private userAddress: string = "";
  private swapQueue: Promise<unknown> = Promise.resolve();

  /** Garante uma transação por vez — evita erro de nonce duplicado */
  private withSwapLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.swapQueue.then(fn, fn);
    this.swapQueue = run.catch(() => undefined);
    return run;
  }

  async initialize(walletOrPrivateKey: string, networkKey: keyof typeof NETWORKS = "arc"): Promise<boolean> {
    try {
      this.networkKey = networkKey;
      const net = NETWORKS[networkKey];
      this.provider = new ethers.JsonRpcProvider(net.rpcUrl);
      this.signer = null;
      this.userAddress = "";

      const rawValue = (walletOrPrivateKey || "").trim();
      let resolvedValue = rawValue;

      if (!resolvedValue || isPrivateKey(resolvedValue)) {
        const browserAccount = await resolveWalletFromBrowser();
        if (browserAccount) {
          resolvedValue = browserAccount;
        } else if (isPrivateKey(rawValue)) {
          resolvedValue = rawValue;
        }
      }

      if (isPrivateKey(resolvedValue)) {
        this.signer = new ethers.Wallet(resolvedValue, this.provider);
        this.userAddress = await this.signer.getAddress();
      } else if (ethers.isAddress(resolvedValue)) {
        this.userAddress = ethers.getAddress(resolvedValue);

        if (typeof window !== "undefined" && window.ethereum) {
          try {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await browserProvider.getSigner();
            const signerAddress = await this.signer.getAddress();
            if (signerAddress) {
              this.userAddress = signerAddress;
            }
          } catch (signerErr) {
            console.warn("⚠️ Não foi possível criar signer via MetaMask:", signerErr);
          }
        }
      }

      console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress || "sem conta"} | source=${resolvedValue ? "wallet" : "empty"}`);
      return Boolean(this.userAddress);
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  /** Mudar de rede sem reinicializar o signer */
  switchNetwork(networkKey: keyof typeof NETWORKS): void {
    this.networkKey = networkKey;
    const net = NETWORKS[networkKey];
    this.provider = new ethers.JsonRpcProvider(net.rpcUrl);
    console.log(`🔄 RealSwapExecutor mudou para: ${net.name}`);
  }

  async getBalance(token: "USDC" | "EURC", networkKey?: keyof typeof NETWORKS): Promise<number> {
    if (!this.provider || !this.userAddress) {
      console.warn(`⚠️ getBalance: provider=${!!this.provider}, userAddress=${!!this.userAddress}`);
      return 0;
    }
    try {
      // Usa rede passada ou a rede atual
      const key = networkKey || this.networkKey;
      const net = NETWORKS[key];
      const addr = token === "USDC" ? net.usdc : net.eurc;
      console.log(`🔍 getBalance(${token}) - Rede: ${key}, Endereço Token: ${addr}, Minha Conta: ${this.userAddress}`);
      const contract = new ethers.Contract(addr, ERC20_ABI, this.provider);
      const [raw, decimals] = await Promise.all([
        contract.balanceOf(this.userAddress),
        contract.decimals(),
      ]);
      const balance = parseFloat(ethers.formatUnits(raw, decimals));
      console.log(`✅ Saldo ${token}: ${balance} (raw: ${raw.toString()}, decimals: ${decimals})`);
      return balance;
    } catch (err) {
      console.error(`❌ Erro ao buscar saldo ${token}:`, err);
      return 0;
    }
  }

  async executeSwap(
    action: "BUY" | "SELL",
    amountUsd: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    return this.withSwapLock(() => this._executeSwap(action, amountUsd, onUpdate));
  }

  private async _executeSwap(
    action: "BUY" | "SELL",
    amountUsd: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    const net = NETWORKS[this.networkKey];
    const timestamp = Date.now();
    const log = (msg: string) => {
      console.log(msg);
      onUpdate?.(msg);
    };

    if (!this.signer || !this.provider) {
      return this._fail(action, amountUsd, "Executor não inicializado", timestamp);
    }

    try {
      const fromToken = action === "BUY" ? net.usdc : net.eurc;
      const toToken = action === "BUY" ? net.eurc : net.usdc;
      const fromAmount = toTokenUnits(amountUsd, 6);
      const slippageLevels = [...SLIPPAGE_LEVELS[action]];

      log(`🔍 Buscando cotação LI.FI para ${action} $${amountUsd}...`);

      const quote = await getQuoteWithRetry(
        {
          fromChain: net.chainId,
          toChain: net.chainId,
          fromToken,
          toToken,
          fromAmount,
          fromAddress: this.userAddress,
          toAddress: this.userAddress,
        },
        slippageLevels
      );

      if (!quote?.transactionRequest) {
        const hint =
          action === "SELL"
            ? "Price impact alto — tente Jumper manual ou aguarde liquidez"
            : "Nenhuma rota LI.FI disponível";
        return this._fail(action, amountUsd, hint, timestamp);
      }

      const toAmount = parseInt(quote.toAmount ?? "0") / Math.pow(10, 6);
      log(
        `✅ Rota via ${quote.tool} | Estimativa: ${toAmount.toFixed(4)} ${action === "BUY" ? "EURC" : "USDC"}`
      );

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

      log(`📝 Assinando e enviando transação...`);
      const txResponse = await this.signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value ?? "0"),
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
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const msg =
        error?.code === "ACTION_REJECTED"
          ? "Transação rejeitada pelo usuário"
          : error?.message?.includes("insufficient")
            ? "Saldo insuficiente"
            : error?.message?.includes("nonce")
              ? "Erro de nonce — aguarde confirmação da TX anterior"
              : error?.message || "Erro desconhecido";
      log(`❌ Erro: ${msg}`);
      return this._fail(action, amountUsd, msg, timestamp);
    }
  }

  getAddress(): string { return this.userAddress; }
  getNetwork(): keyof typeof NETWORKS { return this.networkKey; }
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
