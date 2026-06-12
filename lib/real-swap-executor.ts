// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet

import { ethers, type JsonRpcSigner } from "ethers";

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
    rpcUrl: "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    eurc: "0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4",
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

function toTokenUnits(amount: number, decimals: number): string {
  return ethers.parseUnits(amount.toString(), decimals).toString();
}

function getTokenDecimals(tokenSymbol: "USDC" | "EURC", networkKey: keyof typeof NETWORKS): number {
  if (tokenSymbol === "USDC") return 6;
  if (tokenSymbol === "EURC") {
    const net = NETWORKS[networkKey];
    if (net.chainId === 137) return 18;
    return 6;
  }
  return 6;
}

class RealSwapExecutor {
  private signer: ethers.Wallet | JsonRpcSigner | null = null;
  private networkKey: keyof typeof NETWORKS = "arc";
  private userAddress: string = "";
  private swapQueue: Promise<unknown> = Promise.resolve();

  private withSwapLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.swapQueue.then(fn, fn);
    this.swapQueue = run.catch(() => undefined);
    return run;
  }

  async initialize(walletOrPrivateKey: string, networkKey: keyof typeof NETWORKS = "arc"): Promise<boolean> {
    try {
      this.networkKey = networkKey;
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

      // 🔥 Se for private key, cria wallet
      if (isPrivateKey(resolvedValue)) {
        const provider = new ethers.JsonRpcProvider(NETWORKS[networkKey].rpcUrl);
        this.signer = new ethers.Wallet(resolvedValue, provider);
        this.userAddress = await this.signer.getAddress();
      } 
      // 🔥 Se for endereço, usa MetaMask
      else if (ethers.isAddress(resolvedValue)) {
        this.userAddress = ethers.getAddress(resolvedValue);
        if (typeof window !== "undefined" && window.ethereum) {
          try {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await browserProvider.getSigner();
            const signerAddress = await this.signer.getAddress();
            if (signerAddress) this.userAddress = signerAddress;
          } catch (signerErr) {
            console.warn("⚠️ Não foi possível criar signer via MetaMask:", signerErr);
          }
        }
      }

      console.log(`✅ RealSwapExecutor: ${NETWORKS[networkKey].name} | ${this.userAddress || "sem conta"}`);
      return Boolean(this.userAddress);
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  switchNetwork(networkKey: keyof typeof NETWORKS): void {
    this.networkKey = networkKey;
    console.log(`🔄 RealSwapExecutor mudou para: ${NETWORKS[networkKey].name}`);
  }

  // 🔥 FUNÇÃO CORRIGIDA - usa apenas MetaMask para ler saldos
  async getBalance(token: "USDC" | "EURC", networkKey?: keyof typeof NETWORKS): Promise<number> {
    if (!this.userAddress) return 0;
    
    try {
      const key = networkKey || this.networkKey;
      const net = NETWORKS[key];
      const addr = token === "USDC" ? net.usdc : net.eurc;
      
      // 🔥 Usa o provider do MetaMask (browser)
      if (typeof window !== "undefined" && window.ethereum) {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const contract = new ethers.Contract(addr, ERC20_ABI, browserProvider);
        
        const raw = await contract.balanceOf(this.userAddress).catch(() => 0n);
        let decimals = 6;
        try {
          decimals = await contract.decimals();
        } catch {
          decimals = token === "USDC" ? 6 : 18;
        }
        
        const balance = parseFloat(ethers.formatUnits(raw, decimals));
        console.log(`✅ Saldo ${token}: ${balance}`);
        return balance;
      }
      
      return 0;
    } catch (err) {
      console.error(`❌ Erro ao buscar saldo ${token}:`, err);
      return 0;
    }
  }

  async executeSwap(
    action: "BUY" | "SELL",
    amount: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    return this.withSwapLock(() => this._executeSwap(action, amount, onUpdate));
  }

  private async _executeSwap(
    action: "BUY" | "SELL",
    amountUsd: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    const net = NETWORKS[this.networkKey];
    const timestamp = Date.now();
    const log = (msg: string) => { console.log(msg); onUpdate?.(msg); };

    if (!this.signer) {
      return this._fail(action, amountUsd, "Executor não inicializado", timestamp);
    }

    try {
      const fromTokenSymbol = action === "BUY" ? "USDC" : "EURC";
      const toTokenSymbol = action === "BUY" ? "EURC" : "USDC";
      const fromTokenAddress = action === "BUY" ? net.usdc : net.eurc;
      const toTokenAddress = action === "BUY" ? net.eurc : net.usdc;
      
      const decimals = getTokenDecimals(fromTokenSymbol, this.networkKey);
      const fromAmount = toTokenUnits(amountUsd, decimals);
      
      log(`🔧 Swap: ${action} ${amountUsd} ${fromTokenSymbol} → raw: ${fromAmount}`);

      log(`🔍 Buscando cotação LI.FI...`);
      
      const quoteUrl = `https://li.quest/v1/quote?fromChain=${net.chainId}&toChain=${net.chainId}&fromToken=${fromTokenAddress}&toToken=${toTokenAddress}&fromAmount=${fromAmount}&fromAddress=${this.userAddress}&slippage=0.005&integrator=arcflow`;
      
      const quoteResponse = await fetch(quoteUrl);
      const quote = await quoteResponse.json();
      
      if (!quote.transactionRequest) {
        log(`❌ Sem rota disponível`);
        return this._fail(action, amountUsd, "Nenhuma rota LI.FI disponível", timestamp);
      }
      
      const toDecimals = getTokenDecimals(toTokenSymbol, this.networkKey);
      const toAmountValue = parseFloat(ethers.formatUnits(quote.toAmount || "0", toDecimals));
      
      log(`✅ Via ${quote.tool} | Saída: ${toAmountValue.toFixed(6)} ${toTokenSymbol}`);

      // 🔥 Verifica allowance
      const token = new ethers.Contract(fromTokenAddress, ERC20_ABI, this.signer);
      const spender = quote.transactionRequest.to;
      const allowance = await token.allowance(this.userAddress, spender);
      
      if (allowance < BigInt(fromAmount)) {
        log(`🔓 Aprovando token para o contrato LI.FI...`);
        const approveTx = await token.approve(spender, ethers.MaxUint256);
        await approveTx.wait();
        log(`✅ Aprovação confirmada!`);
      }

      log(`📝 Enviando transação para a blockchain...`);
      const tx = await this.signer.sendTransaction({
        to: quote.transactionRequest.to,
        data: quote.transactionRequest.data,
        value: BigInt(quote.transactionRequest.value || "0"),
        gasLimit: quote.transactionRequest.gasLimit ? BigInt(quote.transactionRequest.gasLimit) : undefined,
      });

      log(`🔗 TX enviada: ${tx.hash}`);
      log(`⏳ Aguardando confirmação...`);

      const receipt = await tx.wait(1);

      if (!receipt || receipt.status === 0) {
        return this._fail(action, amountUsd, "Transação falhou on-chain", timestamp);
      }

      const explorerUrl = `${net.explorer}/tx/${tx.hash}`;
      log(`✅ CONFIRMADO! ${explorerUrl}`);

      return {
        success: true,
        txHash: tx.hash,
        explorerUrl,
        fromAmount: amountUsd,
        toAmount: toAmountValue,
        action,
        message: `✅ ${action} $${amountUsd} ${fromTokenSymbol} → ${toAmountValue.toFixed(6)} ${toTokenSymbol}`,
        timestamp,
        confirmed: true,
      };

    } catch (err: any) {
      const msg = err?.code === "ACTION_REJECTED"
        ? "Transação rejeitada"
        : err?.message?.includes("insufficient") ? "Saldo insuficiente" : err?.message || "Erro desconhecido";
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