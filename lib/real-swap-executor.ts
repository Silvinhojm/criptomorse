// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet
// Suporte a múltiplos pares e saldo real por rede

import { ethers } from "ethers";
import { getQuote, toTokenUnits } from "./lifi-executor";

// ─── Redes suportadas ────────────────────────────────────────────────────────
export const NETWORKS = {
  arc: {
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    isTestnet: true,
    nativeSymbol: "ARC",
    tokens: {
      USDC: "0x3600000000000000000000000000000000000000",
      EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    },
  },
  base: {
    chainId: 8453,
    name: "Base Mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    isTestnet: false,
    nativeSymbol: "ETH",
    tokens: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
      DAI:  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      WETH: "0x4200000000000000000000000000000000000006",
    },
  },
  polygon: {
    chainId: 137,
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon.publicnode.com",
    explorer: "https://polygonscan.com",
    isTestnet: false,
    nativeSymbol: "POL",
    tokens: {
      USDC:  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      USDT:  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      DAI:   "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      WMATIC:"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      WETH:  "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      EURC:  "0xc52d20D70d2B1E27C2cb85AA0E3a9F5b4AEBf7e7",
    },
  },
  ethereum: {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    isTestnet: false,
    nativeSymbol: "ETH",
    tokens: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    },
  },
  arbitrum: {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    isTestnet: false,
    nativeSymbol: "ETH",
    tokens: {
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      ARB:  "0x912CE59144191C1204E64559FE8253a0e49E6548",
    },
  },
};

export type NetworkKey = keyof typeof NETWORKS;
export type TokenSymbol = string;

// ─── Pares de trading disponíveis por rede ───────────────────────────────────
export const TRADING_PAIRS: Record<NetworkKey, Array<{ from: TokenSymbol; to: TokenSymbol; label: string }>> = {
  arc: [
    { from: "USDC", to: "EURC", label: "USDC→EURC" },
    { from: "EURC", to: "USDC", label: "EURC→USDC" },
  ],
  base: [
    { from: "USDC", to: "EURC",  label: "USDC→EURC" },
    { from: "USDC", to: "WETH",  label: "USDC→ETH" },
    { from: "WETH", to: "USDC",  label: "ETH→USDC" },
    { from: "EURC", to: "USDC",  label: "EURC→USDC" },
    { from: "DAI",  to: "USDC",  label: "DAI→USDC" },
  ],
  polygon: [
    { from: "USDC",   to: "USDT",   label: "USDC→USDT" },
    { from: "USDT",   to: "USDC",   label: "USDT→USDC" },
    { from: "USDC",   to: "WMATIC", label: "USDC→MATIC" },
    { from: "WMATIC", to: "USDC",   label: "MATIC→USDC" },
    { from: "USDC",   to: "WETH",   label: "USDC→ETH" },
    { from: "WETH",   to: "USDC",   label: "ETH→USDC" },
    { from: "USDC",   to: "DAI",    label: "USDC→DAI" },
    { from: "DAI",    to: "USDC",   label: "DAI→USDC" },
  ],
  ethereum: [
    { from: "USDC", to: "WETH",  label: "USDC→ETH" },
    { from: "WETH", to: "USDC",  label: "ETH→USDC" },
    { from: "USDC", to: "DAI",   label: "USDC→DAI" },
    { from: "DAI",  to: "USDC",  label: "DAI→USDC" },
    { from: "USDC", to: "EURC",  label: "USDC→EURC" },
  ],
  arbitrum: [
    { from: "USDC", to: "WETH",  label: "USDC→ETH" },
    { from: "WETH", to: "USDC",  label: "ETH→USDC" },
    { from: "USDC", to: "ARB",   label: "USDC→ARB" },
    { from: "ARB",  to: "USDC",  label: "ARB→USDC" },
    { from: "USDC", to: "USDT",  label: "USDC→USDT" },
  ],
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export interface TokenBalance {
  symbol: TokenSymbol;
  balance: number;
  address: string;
  decimals: number;
}

export interface SwapResult {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  fromAmount: number;
  toAmount: number;
  action: "BUY" | "SELL" | "HOLD";
  message: string;
  timestamp: number;
  confirmed: boolean;
  profit?: number;
}

export interface BestPairResult {
  pair: { from: TokenSymbol; to: TokenSymbol; label: string };
  expectedProfit: number;
  toAmount: number;
  route: string;
}

// ─── Executor principal ───────────────────────────────────────────────────────
class RealSwapExecutor {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private networkKey: NetworkKey = "arc";
  private userAddress: string = "";
  private tokenBalances: Map<TokenSymbol, TokenBalance> = new Map();

  // Inicializar com chave privada OU somente endereço (read-only)
  async initialize(
    privateKeyOrAddress: string,
    networkKey: NetworkKey = "arc",
    readOnly = false
  ): Promise<boolean> {
    try {
      this.networkKey = networkKey;
      const net = NETWORKS[networkKey];
      this.provider = new ethers.JsonRpcProvider(net.rpcUrl);

      if (readOnly || !privateKeyOrAddress.startsWith("0x") || privateKeyOrAddress.length === 42) {
        // Modo somente leitura — usa endereço da carteira conectada
        this.userAddress = privateKeyOrAddress;
        console.log(`👁️ RealSwapExecutor (read-only): ${net.name} | ${this.userAddress}`);
      } else {
        this.signer = new ethers.Wallet(privateKeyOrAddress, this.provider);
        this.userAddress = await this.signer.getAddress();
        console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress}`);
      }

      await this.refreshAllBalances();
      return true;
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  // Atualizar todos os saldos de tokens da rede atual
  async refreshAllBalances(): Promise<Map<TokenSymbol, TokenBalance>> {
    if (!this.provider || !this.userAddress) return this.tokenBalances;

    const net = NETWORKS[this.networkKey];
    this.tokenBalances.clear();

    await Promise.all(
      Object.entries(net.tokens).map(async ([symbol, address]) => {
        try {
          const contract = new ethers.Contract(address, ERC20_ABI, this.provider!);
          const [raw, decimals] = await Promise.all([
            contract.balanceOf(this.userAddress),
            contract.decimals(),
          ]);
          const balance = parseFloat(ethers.formatUnits(raw, decimals));
          this.tokenBalances.set(symbol, { symbol, balance, address, decimals: Number(decimals) });
        } catch {
          this.tokenBalances.set(symbol, { symbol, balance: 0, address, decimals: 6 });
        }
      })
    );

    return this.tokenBalances;
  }

  getBalance(token: TokenSymbol): number {
    return this.tokenBalances.get(token)?.balance ?? 0;
  }

  getAllBalances(): TokenBalance[] {
    return Array.from(this.tokenBalances.values());
  }

  // Encontrar o melhor par para trade (maior retorno esperado)
  async findBestPair(amountUsd: number): Promise<BestPairResult | null> {
    const pairs = TRADING_PAIRS[this.networkKey];
    const net = NETWORKS[this.networkKey];
    const results: BestPairResult[] = [];

    await Promise.all(
      pairs.map(async (pair) => {
        try {
          const fromBalance = this.getBalance(pair.from);
          if (fromBalance < amountUsd * 0.9) return; // sem saldo suficiente

          const fromTokenAddr = (net.tokens as any)[pair.from];
          const toTokenAddr   = (net.tokens as any)[pair.to];
          if (!fromTokenAddr || !toTokenAddr) return;

          const fromDecimals = this.tokenBalances.get(pair.from)?.decimals ?? 6;
          const fromAmount   = toTokenUnits(amountUsd, fromDecimals);

          const quote = await getQuote({
            fromChain:   net.chainId,
            toChain:     net.chainId,
            fromToken:   fromTokenAddr,
            toToken:     toTokenAddr,
            fromAmount,
            fromAddress: this.userAddress,
            toAddress:   this.userAddress,
            slippage:    0.005,
          });

          if (!quote || !quote.toAmount) return;

          const toDecimals   = this.tokenBalances.get(pair.to)?.decimals ?? 6;
          const toAmount     = parseFloat(quote.toAmount) / Math.pow(10, toDecimals);
          // Estimar lucro em USD (simplificado: comparar valores)
          const expectedProfit = toAmount - amountUsd;

          results.push({ pair, expectedProfit, toAmount, route: quote.tool ?? "lifi" });
        } catch {
          // par sem rota disponível, ignorar
        }
      })
    );

    if (results.length === 0) return null;

    // Retorna o par com maior lucro esperado
    results.sort((a, b) => b.expectedProfit - a.expectedProfit);
    return results[0];
  }

  // Executar swap no melhor par disponível
  async executeSwap(
    fromToken: TokenSymbol,
    toToken: TokenSymbol,
    amountUsd: number,
    onUpdate?: (msg: string) => void
  ): Promise<SwapResult> {
    const net = NETWORKS[this.networkKey];
    const timestamp = Date.now();
    const log = (msg: string) => { console.log(msg); onUpdate?.(msg); };

    if (!this.signer || !this.provider) {
      return this._fail(fromToken, toToken, amountUsd, "Signer não inicializado (necessário private key)", timestamp);
    }

    const fromBalance = this.getBalance(fromToken);
    if (fromBalance < amountUsd * 0.95) {
      return this._fail(fromToken, toToken, amountUsd, `Saldo insuficiente de ${fromToken}: $${fromBalance.toFixed(4)}`, timestamp);
    }

    try {
      const fromTokenAddr = (net.tokens as any)[fromToken];
      const toTokenAddr   = (net.tokens as any)[toToken];
      const fromDecimals  = this.tokenBalances.get(fromToken)?.decimals ?? 6;
      const fromAmountRaw = toTokenUnits(amountUsd, fromDecimals);

      log(`🔍 Buscando rota LI.FI: ${fromToken}→${toToken} ($${amountUsd})...`);

      const quote = await getQuote({
        fromChain:   net.chainId,
        toChain:     net.chainId,
        fromToken:   fromTokenAddr,
        toToken:     toTokenAddr,
        fromAmount:  fromAmountRaw,
        fromAddress: this.userAddress,
        toAddress:   this.userAddress,
        slippage:    0.005,
      });

      if (!quote || !quote.transactionRequest) {
        return this._fail(fromToken, toToken, amountUsd, "Nenhuma rota LI.FI disponível", timestamp);
      }

      const toDecimals = this.tokenBalances.get(toToken)?.decimals ?? 6;
      const toAmount   = parseFloat(quote.toAmount) / Math.pow(10, toDecimals);
      log(`✅ Rota via ${quote.tool} | Estimativa: ${toAmount.toFixed(6)} ${toToken}`);

      // Aprovar token se necessário
      const tx = quote.transactionRequest;
      const tokenContract = new ethers.Contract(fromTokenAddr, ERC20_ABI, this.signer);
      const allowance: bigint = await tokenContract.allowance(this.userAddress, tx.to);

      if (allowance < BigInt(fromAmountRaw)) {
        log(`🔓 Aprovando ${fromToken}...`);
        const approveTx = await tokenContract.approve(tx.to, ethers.MaxUint256);
        await approveTx.wait();
        log(`✅ Aprovação confirmada!`);
      }

      // Enviar transação
      log(`📝 Enviando transação na ${net.name}...`);
      const txResponse = await this.signer.sendTransaction({
        to:       tx.to,
        data:     tx.data,
        value:    BigInt(tx.value ?? "0"),
        gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      });

      log(`🔗 TX: ${txResponse.hash}`);
      log(`⏳ Aguardando confirmação...`);

      const receipt = await txResponse.wait(1);
      if (!receipt || receipt.status === 0) {
        return this._fail(fromToken, toToken, amountUsd, "TX falhou on-chain (status 0)", timestamp);
      }

      const explorerUrl = `${net.explorer}/tx/${txResponse.hash}`;
      log(`✅ Confirmado no bloco ${receipt.blockNumber}!`);
      log(`🔗 ${explorerUrl}`);

      // Atualizar saldos após trade
      await this.refreshAllBalances();

      const profit = toAmount - amountUsd;

      return {
        success: true,
        txHash: txResponse.hash,
        explorerUrl,
        fromToken,
        toToken,
        fromAmount: amountUsd,
        toAmount,
        action: "BUY",
        message: `✅ ${fromToken}→${toToken} $${amountUsd} → ${toAmount.toFixed(6)} | ${txResponse.hash.slice(0, 10)}...`,
        timestamp,
        confirmed: true,
        profit,
      };
    } catch (err: any) {
      const msg =
        err?.code === "ACTION_REJECTED" ? "Rejeitado pelo usuário"
        : err?.message?.includes("insufficient") ? "Saldo insuficiente para gas"
        : err?.message || "Erro desconhecido";
      log(`❌ ${msg}`);
      return this._fail(fromToken, toToken, amountUsd, msg, timestamp);
    }
  }

  // Executar swap no melhor par automaticamente
  async executeSmartSwap(amountUsd: number, onUpdate?: (msg: string) => void): Promise<SwapResult> {
    const log = (msg: string) => { console.log(msg); onUpdate?.(msg); };
    log(`🧠 Analisando melhores pares na ${NETWORKS[this.networkKey].name}...`);

    const best = await this.findBestPair(amountUsd);
    if (!best) {
      return this._fail("?", "?", amountUsd, "Nenhum par com saldo suficiente encontrado", Date.now());
    }

    log(`🎯 Melhor par: ${best.pair.label} | Lucro esperado: $${best.expectedProfit.toFixed(6)} via ${best.route}`);
    return this.executeSwap(best.pair.from, best.pair.to, amountUsd, onUpdate);
  }

  getAddress(): string { return this.userAddress; }
  getNetworkKey(): NetworkKey { return this.networkKey; }
  isTestnet(): boolean { return NETWORKS[this.networkKey].isTestnet; }

  private _fail(
    fromToken: TokenSymbol,
    toToken: TokenSymbol,
    amount: number,
    reason: string,
    timestamp: number
  ): SwapResult {
    return {
      success: false, txHash: "", explorerUrl: "",
      fromToken, toToken,
      fromAmount: amount, toAmount: 0,
      action: "HOLD",
      message: `❌ ${fromToken}→${toToken} falhou: ${reason}`,
      timestamp, confirmed: false, profit: 0,
    };
  }
}

export const realSwap = new RealSwapExecutor();