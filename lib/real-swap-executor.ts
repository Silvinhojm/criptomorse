// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet
// Suporte a múltiplos pares e saldo real por rede

import { ethers } from "ethers";
import { getQuote, isLifiCooldown, toTokenUnits } from "./lifi-executor";
import type { QuoteResult } from "./lifi-executor";
import { getCircuitBreakerState, recordError, recordTradeResult, setTestnetMode } from "./circuit-breaker";
import { gasPriceOracle } from "./gas-price-oracle";
import { getArcFeeParams } from "./arc-gas";
import { generateSyntheticQuote, executeDirectSwap } from "./arc-direct-swap";
import { arcMemo } from "./arc-memo";
import { transactionMemos } from "./transaction-memos";

// ─── Redes suportadas ────────────────────────────────────────────────────────
// Custo estimado de gas em USD por rede (para deducao do lucro)
export const GAS_COST_ESTIMATE: Record<string, number> = {
  arc: 0.006,
  base: 0.05,
  polygon: 0.08,
  ethereum: 1.50,
  arbitrum: 0.03,
};

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
      cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
      mcirBTC: "0x8cad4951192853D14f8Cb813695146b5Ae00EA6d",
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
      WBTC: "0x0555E30dD009B6f21Bcb7A78FeE496525DbD919e",
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
      WBTC:  "0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6",
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
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
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
      WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    },
  },
};

export type NetworkKey = keyof typeof NETWORKS;
export type TokenSymbol = string;

// ─── Pares de trading disponíveis por rede ───────────────────────────────────
// CORREÇÃO: labels agora refletem o token real (WETH, WMATIC, WBTC)
// antes usavam nomes curtos (ETH, MATIC, BTC) que não batiam com fromToken/toToken
export const TRADING_PAIRS: Record<NetworkKey, Array<{ from: TokenSymbol; to: TokenSymbol; label: string }>> = {
  arc: [
    { from: "USDC",    to: "EURC",    label: "USDC→EURC" },
    { from: "EURC",    to: "USDC",    label: "EURC→USDC" },
    { from: "USDC",    to: "cirBTC",  label: "USDC→cirBTC" },
    { from: "cirBTC",  to: "USDC",    label: "cirBTC→USDC" },
    { from: "EURC",    to: "cirBTC",  label: "EURC→cirBTC" },
    { from: "cirBTC",  to: "EURC",    label: "cirBTC→EURC" },
    { from: "USDC",    to: "mcirBTC", label: "USDC→mcirBTC" },
    { from: "mcirBTC", to: "USDC",    label: "mcirBTC→USDC" },
    { from: "EURC",    to: "mcirBTC", label: "EURC→mcirBTC" },
    { from: "mcirBTC", to: "EURC",    label: "mcirBTC→EURC" },
  ],
  base: [
    { from: "USDC", to: "EURC", label: "USDC→EURC" },
    { from: "USDC", to: "WETH", label: "USDC→WETH" },  // era "USDC→ETH"
    { from: "WETH", to: "USDC", label: "WETH→USDC" },  // era "ETH→USDC"
    { from: "USDC", to: "WBTC", label: "USDC→WBTC" },  // era "USDC→BTC"
    { from: "WBTC", to: "USDC", label: "WBTC→USDC" },  // era "BTC→USDC"
    { from: "WETH", to: "WBTC", label: "WETH→WBTC" },  // era "ETH→BTC"
    { from: "WBTC", to: "WETH", label: "WBTC→WETH" },  // era "BTC→ETH"
    { from: "EURC", to: "USDC", label: "EURC→USDC" },
    { from: "DAI",  to: "USDC", label: "DAI→USDC" },
  ],
  polygon: [
    { from: "USDC",   to: "USDT",   label: "USDC→USDT" },
    { from: "USDT",   to: "USDC",   label: "USDT→USDC" },
    { from: "USDC",   to: "WMATIC", label: "USDC→WMATIC" },  // era "USDC→MATIC"
    { from: "WMATIC", to: "USDC",   label: "WMATIC→USDC" },  // era "MATIC→USDC"
    { from: "USDC",   to: "WETH",   label: "USDC→WETH" },    // era "USDC→ETH"
    { from: "WETH",   to: "USDC",   label: "WETH→USDC" },    // era "ETH→USDC"
    { from: "USDC",   to: "DAI",    label: "USDC→DAI" },
    { from: "DAI",    to: "USDC",   label: "DAI→USDC" },
  ],
  ethereum: [
    { from: "USDC", to: "WETH", label: "USDC→WETH" },  // era "USDC→ETH"
    { from: "WETH", to: "USDC", label: "WETH→USDC" },  // era "ETH→USDC"
    { from: "USDC", to: "WBTC", label: "USDC→WBTC" },  // era "USDC→BTC"
    { from: "WBTC", to: "USDC", label: "WBTC→USDC" },  // era "BTC→USDC"
    { from: "WETH", to: "WBTC", label: "WETH→WBTC" },  // era "ETH→BTC"
    { from: "WBTC", to: "WETH", label: "WBTC→WETH" },  // era "BTC→ETH"
    { from: "USDC", to: "DAI",  label: "USDC→DAI" },
    { from: "DAI",  to: "USDC", label: "DAI→USDC" },
    { from: "USDC", to: "EURC", label: "USDC→EURC" },
  ],
  arbitrum: [
    { from: "USDC", to: "WETH", label: "USDC→WETH" },  // era "USDC→ETH"
    { from: "WETH", to: "USDC", label: "WETH→USDC" },  // era "ETH→USDC"
    { from: "USDC", to: "WBTC", label: "USDC→WBTC" },  // era "USDC→BTC"
    { from: "WBTC", to: "USDC", label: "WBTC→USDC" },  // era "BTC→USDC"
    { from: "WETH", to: "WBTC", label: "WETH→WBTC" },  // era "ETH→BTC"
    { from: "WBTC", to: "WETH", label: "WBTC→WETH" },  // era "BTC→ETH"
    { from: "USDC", to: "ARB",  label: "USDC→ARB" },
    { from: "ARB",  to: "USDC", label: "ARB→USDC" },
    { from: "USDC", to: "USDT", label: "USDC→USDT" },
  ],
};

// Tokens atrelados a USD (stablecoins) — usados para cálculo de lucro
const STABLE_TOKENS: Set<TokenSymbol> = new Set(["USDC", "USDT", "DAI", "EURC"]);

export function isStable(token: TokenSymbol): boolean {
  return STABLE_TOKENS.has(token);
}

// Lucro mínimo dinâmico por rede (cobre gas real da RPC + margem)
async function getMinProfitThreshold(networkKey: NetworkKey): Promise<number> {
  const gasCost = await gasPriceOracle.getGasCost(networkKey);
  return Math.max(0.01, gasCost * 3);
}

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
  /** FUTURO: modo privado com selective disclosure (Arc roadmap) */
  private?: boolean;
  /** Hash da transacao do Memo contract (Arc), se aplicavel */
  memoTxHash?: string;
}

export interface BestPairResult {
  pair: { from: TokenSymbol; to: TokenSymbol; label: string };
  expectedProfit: number;
  toAmount: number;
  route: string;
}

// ─── Executor principal ───────────────────────────────────────────────────────
const COIN_IDS: Record<string, string> = {
  WETH: "ethereum", WMATIC: "matic-network", WBTC: "bitcoin",
  USDC: "usd-coin", USDT: "tether", DAI: "dai", EURC: "eurc",
  ARB: "arbitrum", SOL: "solana",
  cirBTC: "bitcoin", mcirBTC: "bitcoin",
  // Tokens nativos (usados por _fetchNativePrice)
  ETH: "ethereum", POL: "matic-network", ARC: "usd-coin",
};

class RealSwapExecutor {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Signer | null = null;
  private networkKey: NetworkKey = "arc";
  private userAddress: string = "";
  private tokenBalances: Map<TokenSymbol, TokenBalance> = new Map();
  private nativeBalanceWei: bigint = 0n;
  private nativeBalanceLastUpdated: number = 0;
  private priceCache: Map<TokenSymbol, { price: number; timestamp: number }> = new Map();
  private quoteCache: Map<string, { quote: QuoteResult | null; timestamp: number }> = new Map();

  private _getCachedQuote(key: string): QuoteResult | null | undefined {
    const cached = this.quoteCache.get(key);
    return (cached && Date.now() - cached.timestamp < 60000) ? cached.quote : undefined;
  }
  private _setCachedQuote(key: string, quote: QuoteResult | null): void {
    this.quoteCache.set(key, { quote, timestamp: Date.now() });
  }

  private async _getTokenPrice(token: TokenSymbol): Promise<number> {
    const cached = this.priceCache.get(token);
    if (cached && Date.now() - cached.timestamp < 15000) return cached.price;
    const coinId = COIN_IDS[token];
    if (!coinId) return 1.0;
    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return this.priceCache.get(token)?.price ?? 1.0;
      const body = await res.json();
      // FIX: /api/price retorna { prices: {...}, change24h: {...} }
      const data = body.prices ?? body;
      const price = data[coinId] || 1.0;
      if (price > 0) {
        this.priceCache.set(token, { price, timestamp: Date.now() });
      }
      return price;
    } catch {
      return this.priceCache.get(token)?.price ?? 1.0;
    }
  }

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

      if (readOnly) {
        this.userAddress = privateKeyOrAddress;
        console.log(`👁️ RealSwapExecutor (read-only): ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      } else if (privateKeyOrAddress.length === 66 && privateKeyOrAddress.startsWith("0x")) {
        this.signer = new ethers.Wallet(privateKeyOrAddress, this.provider);
        this.userAddress = await this.signer.getAddress();
        console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      } else if (privateKeyOrAddress.length === 64 && /^[0-9a-fA-F]+$/.test(privateKeyOrAddress)) {
        this.signer = new ethers.Wallet("0x" + privateKeyOrAddress, this.provider);
        this.userAddress = await this.signer.getAddress();
        console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      } else {
        this.userAddress = privateKeyOrAddress;
        console.log(`👁️ RealSwapExecutor (read-only): ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      }

      await this.refreshAllBalances();
      setTestnetMode(NETWORKS[networkKey].isTestnet);
      return true;
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  // Inicializar com um signer externo (ex: BrowserProvider do MetaMask)
  async initializeWithSigner(
    userAddress: string,
    networkKey: NetworkKey,
    externalSigner: ethers.Signer
  ): Promise<boolean> {
    try {
      this.networkKey = networkKey;
      const net = NETWORKS[networkKey];
      this.provider = new ethers.JsonRpcProvider(net.rpcUrl);
      this.signer = externalSigner;
      this.userAddress = userAddress;
      console.log(`✅ RealSwapExecutor (external signer): ${net.name} | ${this.userAddress}`);
      await this.refreshAllBalances();
      setTestnetMode(NETWORKS[networkKey].isTestnet);
      return true;
    } catch (err) {
      console.error("❌ Erro ao inicializar:", err);
      return false;
    }
  }

  // Trocar de rede sem perder o signer
  async switchNetwork(networkKey: NetworkKey): Promise<void> {
    this.networkKey = networkKey;
    const net = NETWORKS[networkKey];
    this.provider = new ethers.JsonRpcProvider(net.rpcUrl);
    if (this.signer && typeof (this.signer as any).connect === "function") {
      this.signer = (this.signer as ethers.Wallet).connect(this.provider);
    }
    this.priceCache.clear();
    await this.refreshAllBalances();
    setTestnetMode(net.isTestnet);
    console.log(`🔀 RealSwapExecutor switch: ${net.name}`);
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

  hasToken(token: TokenSymbol): boolean {
    const net = NETWORKS[this.networkKey];
    return token in net.tokens;
  }

  getAllBalances(): TokenBalance[] {
    return Array.from(this.tokenBalances.values());
  }

  async refreshNativeBalance(): Promise<number> {
    if (!this.provider || !this.userAddress) return 0;
    try {
      this.nativeBalanceWei = await this.provider.getBalance(this.userAddress);
      this.nativeBalanceLastUpdated = Date.now();
      const net = NETWORKS[this.networkKey];
      const formatted = parseFloat(ethers.formatEther(this.nativeBalanceWei));
      const nativePrice = await this._fetchNativePrice(net.nativeSymbol);
      return formatted * nativePrice;
    } catch {
      return 0;
    }
  }

  getNativeBalanceUSD(): number {
    return 0;
  }

  // FIX: unpack { prices: {...} } igual ao gas-price-oracle.ts
  // Antes: data[coinId] → undefined → fallback 1.0 → POL valia $1 → $83 USD
  // Agora: (data.prices ?? data)[coinId] → preço real → $0.078 → $6.47 USD
  private async _fetchNativePrice(nativeSymbol: string): Promise<number> {
    const coinId = COIN_IDS[nativeSymbol] || nativeSymbol.toLowerCase();
    if (!coinId) return 1.0;
    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return 1.0;
      const body = await res.json();
      // FIX: /api/price retorna { prices: {...}, change24h: {...} }
      const prices = body.prices ?? body;
      const price = prices[coinId] ?? 1.0;
      return price > 0 ? price : 1.0;
    } catch {
      return 1.0;
    }
  }

  // Encontrar o melhor par para trade (maior retorno esperado)
  async findBestPair(amountUsd: number): Promise<BestPairResult | null> {
    const pairs = TRADING_PAIRS[this.networkKey];
    const net = NETWORKS[this.networkKey];
    const results: BestPairResult[] = [];

    for (const pair of pairs) {
      try {
        const fromTokenAddr = (net.tokens as any)[pair.from];
        const toTokenAddr   = (net.tokens as any)[pair.to];
        if (!fromTokenAddr || !toTokenAddr) continue;

        const fromPrice = await this._getTokenPrice(pair.from);
        const toPrice   = await this._getTokenPrice(pair.to);

        const fromBalanceTokens = this.getBalance(pair.from);
        const fromBalanceUsd    = fromBalanceTokens * fromPrice;

        const actualAmount = Math.min(amountUsd, fromBalanceUsd * 0.95);
        if (actualAmount < 0.5) continue;

        const fromDecimals    = this.tokenBalances.get(pair.from)?.decimals ?? 6;
        const fromTokenAmount = actualAmount / fromPrice;
        const fromAmountRaw   = toTokenUnits(fromTokenAmount, fromDecimals);

        const quote = generateSyntheticQuote(fromTokenAddr, toTokenAddr, fromAmountRaw, this.userAddress, net.chainId);
        if (!quote) continue;

        let toAmount = 0;
        if (quote.toAmount && quote.toAmount !== "0") {
          const toDecimals = this.tokenBalances.get(pair.to)?.decimals ?? 6;
          toAmount = parseFloat(quote.toAmount) / Math.pow(10, toDecimals);
        }

        let expectedProfit = 0;
        if (isStable(pair.to)) {
          expectedProfit = toAmount - actualAmount;
        } else if (isStable(pair.from) && toAmount > 0) {
          expectedProfit = toAmount * toPrice - actualAmount;
        }

        results.push({ pair, expectedProfit, toAmount, route: "synthetic" });
      } catch {
        continue;
      }
    }

    if (results.length === 0) return null;

    const [minProfit, gasCost] = await Promise.all([
      getMinProfitThreshold(this.networkKey),
      gasPriceOracle.getGasCost(this.networkKey),
    ]);

    const isTestnet = NETWORKS[this.networkKey].isTestnet;
    const profitable = results.filter(r => {
      if (!isStable(r.pair.to)) return true;
      if (isTestnet) return true;
      return r.expectedProfit >= minProfit + gasCost;
    });

    if (profitable.length === 0) return null;

    profitable.sort((a, b) => b.expectedProfit - a.expectedProfit);
    return profitable[0];
  }

  // Executar swap no melhor par disponível
  async executeSwap(
    fromToken: TokenSymbol,
    toToken: TokenSymbol,
    amountUsd: number,
    onUpdate?: (msg: string) => void,
    memoRef?: string
  ): Promise<SwapResult> {
    const net = NETWORKS[this.networkKey];
    const timestamp = Date.now();
    const log = (msg: string) => { console.log(msg); onUpdate?.(msg); };

    if (!this.signer || !this.provider) {
      return this._fail(fromToken, toToken, amountUsd, "Signer não inicializado (necessário private key)", timestamp);
    }

    if (getCircuitBreakerState().isPanicActive) {
      return this._fail(fromToken, toToken, amountUsd, "Circuit breaker bloqueou trade (modo pânico ativo)", timestamp);
    }

    await this.refreshAllBalances();
    const fromBalance     = this.getBalance(fromToken);
    const fromPrice       = await this._getTokenPrice(fromToken);
    const fromBalanceUsd  = fromBalance * fromPrice;
    if (fromBalanceUsd < amountUsd * 0.95) {
      return this._fail(fromToken, toToken, amountUsd, `Saldo insuficiente de ${fromToken}: $${fromBalanceUsd.toFixed(4)} (${fromBalance.toFixed(6)} ${fromToken})`, timestamp);
    }

    const nativeBalanceUsd = await this.refreshNativeBalance();
    const gasCost = await gasPriceOracle.getGasCost(this.networkKey);
    const isTestnet = NETWORKS[this.networkKey].isTestnet;
    const gasReserve = gasCost * 5;
    if (!isTestnet && nativeBalanceUsd < gasReserve) {
      return this._fail(fromToken, toToken, amountUsd,
        `Sem ${net.nativeSymbol} para gas: tem $${nativeBalanceUsd.toFixed(4)} (precisa ~$${gasReserve.toFixed(4)})`,
        timestamp);
    }

    try {
      const fromTokenAddr = (net.tokens as any)[fromToken];
      const toTokenAddr   = (net.tokens as any)[toToken];

      if (!fromTokenAddr) {
        return this._fail(fromToken, toToken, amountUsd, `Token ${fromToken} não configurado na rede ${this.networkKey}`, timestamp);
      }
      if (!toTokenAddr) {
        return this._fail(fromToken, toToken, amountUsd, `Token ${toToken} não configurado na rede ${this.networkKey}`, timestamp);
      }

      const fromDecimals    = this.tokenBalances.get(fromToken)?.decimals ?? 6;
      const fromTokenAmount = amountUsd / fromPrice;
      const fromAmountRaw   = toTokenUnits(fromTokenAmount, fromDecimals);

      let quote: QuoteResult | null = null;
      if (net.isTestnet) {
        quote = generateSyntheticQuote(fromTokenAddr, toTokenAddr, fromAmountRaw, this.userAddress, net.chainId);
      } else {
        log(`🔍 Buscando rota LI.FI: ${fromToken}→${toToken} ($${amountUsd} ≈ ${fromTokenAmount.toFixed(6)} ${fromToken})...`);
        try {
          quote = await getQuote({
            fromChain:   net.chainId,
            toChain:     net.chainId,
            fromToken:   fromTokenAddr,
            toToken:     toTokenAddr,
            fromAmount:  fromAmountRaw,
            fromAddress: this.userAddress,
            toAddress:   this.userAddress,
            slippage:    0.005,
          });
        } catch {
          quote = null;
        }
      }

      if (!quote) {
        const motivo = isLifiCooldown() ? "LI.FI em cooldown (rate limit)" : "Nenhuma rota disponível";
        return this._fail(fromToken, toToken, amountUsd, motivo, timestamp);
      }

      if (quote.tool === 'synthetic-direct') {
        if (!net.isTestnet) {
          return this._fail(fromToken, toToken, amountUsd, "LI.FI indisponível — trade adiado", timestamp);
        }
        log(`🧪 Modo testnet: swap direto (approve + simulação)`);
        const result = await executeDirectSwap(
          this.signer!,
          fromTokenAddr,
          toTokenAddr,
          fromAmountRaw,
          this.userAddress,
          net.chainId,
          (m) => log(m),
        );
        if (!result.success) {
          return this._fail(fromToken, toToken, amountUsd, result.error || "Direct swap falhou", timestamp);
        }
        const synthToPrice = await this._getTokenPrice(toToken);
        const syntheticToAmount = synthToPrice > 0 ? amountUsd / synthToPrice : amountUsd;
        log(`✅ Swap simulado: ${fromToken}→${toToken} | approve OK ($${amountUsd} → ${syntheticToAmount.toFixed(8)} ${toToken} @ $${synthToPrice})`);
        return {
          success: true,
          txHash: '',
          explorerUrl: '',
          fromToken,
          toToken,
          fromAmount: amountUsd,
          toAmount: syntheticToAmount,
          action: "BUY",
          message: `✅ ${fromToken}→${toToken} (simulado testnet) | approve OK`,
          timestamp,
          confirmed: false,
          profit: 0,
        };
      }

      if (!quote.transactionRequest || !quote.transactionRequest.data) {
        return this._fail(fromToken, toToken, amountUsd, "Rota LI.FI sem dados de transação", timestamp);
      }

      const toDecimals = this.tokenBalances.get(toToken)?.decimals ?? 6;
      const toEstimate = parseFloat(quote.toAmount ?? "0") / Math.pow(10, toDecimals);
      log(`✅ Rota via ${quote.tool} | Estimativa: ${toEstimate.toFixed(6)} ${toToken}`);
      if (toEstimate <= 0) {
        if (net.isTestnet) {
          log(`⚠️ Estimativa zero — testnet: enviando mesmo assim (rota ${quote.tool} pode omitir toAmount)`);
        } else {
          return this._fail(fromToken, toToken, amountUsd, `Rota ${quote.tool} retornou estimativa 0 — ${toToken} não disponível`, timestamp);
        }
      }

      const preSwapBalance = this.getBalance(toToken);

      let estimatedProfit = 0;
      const gasCostEstimated = await gasPriceOracle.getGasCost(this.networkKey);
      if (isStable(toToken)) {
        estimatedProfit = toEstimate - amountUsd;
      }
      const netProfit = estimatedProfit - gasCostEstimated;
      const minProfit = await getMinProfitThreshold(this.networkKey);
      if (!isTestnet && isStable(toToken) && estimatedProfit < minProfit) {
        log(`⏸️ Lucro estimado $${estimatedProfit.toFixed(4)} - gas $${gasCostEstimated.toFixed(3)} = $${netProfit.toFixed(4)} (min: $${minProfit})`);
        return this._fail(fromToken, toToken, amountUsd, `Lucro líquido não atinge mínimo: $${netProfit.toFixed(4)}`, timestamp);
      }
      if (!isTestnet && !isStable(toToken) && amountUsd < 5) {
        log(`⏸️ Trade volátil $${amountUsd.toFixed(2)} abaixo do mínimo $5.00`);
        return this._fail(fromToken, toToken, amountUsd, `Trade mínimo para voláteis é $5.00 (tentativa: $${amountUsd.toFixed(2)})`, timestamp);
      }

      const isBuyingVolatile  = !isStable(toToken) && isStable(fromToken);
      const isSellingForStable = isStable(toToken) && !isStable(fromToken);
      const action: "BUY" | "SELL" | "HOLD" = isBuyingVolatile ? "BUY" : isSellingForStable ? "SELL" : "BUY";

      const tx = quote.transactionRequest;
      const tokenContract = new ethers.Contract(fromTokenAddr, ERC20_ABI, this.signer);
      const allowance: bigint = await tokenContract.allowance(this.userAddress, tx.to);

      if (allowance < BigInt(fromAmountRaw)) {
        log(`🔓 Aprovando ${fromToken}...`);
        const approveTx = await tokenContract.approve(tx.to, ethers.MaxUint256);
        await approveTx.wait();
        log(`✅ Aprovação confirmada!`);
      }

      log(`📝 Enviando transação na ${net.name}...`);
      const arcFeeParams = net.chainId === 5042002 ? getArcFeeParams() : {};
      const txResponse = await this.signer.sendTransaction({
        to:       tx.to,
        data:     tx.data,
        value:    BigInt(tx.value ?? "0"),
        gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        ...arcFeeParams,
      });

      log(`🔗 TX: ${txResponse.hash}`);
      log(`⏳ Aguardando confirmação...`);

      const receipt = await txResponse.wait(1);
      if (!receipt || receipt.status === 0) {
        recordError("executeSwap", "TX falhou on-chain (status 0)");
        return this._fail(fromToken, toToken, amountUsd, "TX falhou on-chain (status 0)", timestamp);
      }

      const explorerUrl = `${net.explorer}/tx/${txResponse.hash}`;
      log(`✅ Confirmado no bloco ${receipt.blockNumber}!`);
      log(`🔗 ${explorerUrl}`);

      await this.refreshAllBalances();
      const postSwapBalance = this.getBalance(toToken);
      const actualToAmount  = Math.max(0, postSwapBalance - preSwapBalance);
      const toPrice         = await this._getTokenPrice(toToken);
      const toAmountUsd     = actualToAmount * toPrice;

      log(`📊 On-chain: ${actualToAmount.toFixed(6)} ${toToken} ($${toAmountUsd.toFixed(4)}) — saldo anterior: ${preSwapBalance.toFixed(6)} → atual: ${postSwapBalance.toFixed(6)}`);

      let profit = 0;
      const postGas = await gasPriceOracle.getGasCost(this.networkKey);
      if (isStable(toToken)) {
        profit = actualToAmount - amountUsd - postGas;
      }

      log(`💵 Lucro líquido real (pós-gas): $${profit.toFixed(4)}`);

      const { isPanicActive } = recordTradeResult(profit);
      if (isPanicActive) {
        log(`🚨 Circuit breaker ativado!`);
      }

      let memoTxHash: string | undefined;
      if (memoRef && this.networkKey === "arc" && this.signer) {
        try {
          const tradeMemoId   = transactionMemos.generateMemoId(`swap:${memoRef}`);
          const tradeMemoData = transactionMemos.encodeMemoData({
            ref: memoRef,
            pair: `${fromToken}/${toToken}`,
            amount: String(amountUsd),
            profit: String(profit),
            txHash: txResponse.hash,
          });
          memoTxHash = await arcMemo.sendUSDCWithMemo(
            this.signer,
            this.userAddress,
            0,
            tradeMemoId,
            tradeMemoData
          );
          log(`📝 Memo on-chain: ${memoTxHash.slice(0, 10)}...`);
        } catch {
          // memo falhou — não interrompe o trade
        }
      }

      return {
        success: true,
        txHash: txResponse.hash,
        explorerUrl,
        fromToken,
        toToken,
        fromAmount: amountUsd,
        toAmount: actualToAmount,
        action,
        message: `✅ ${fromToken}→${toToken} $${amountUsd} → ${actualToAmount.toFixed(6)} ${toToken} | ${txResponse.hash.slice(0, 10)}...`,
        timestamp,
        confirmed: true,
        profit,
        memoTxHash,
      };
    } catch (err: any) {
      const msg =
        err?.code === "ACTION_REJECTED" ? "Rejeitado pelo usuário"
        : err?.message?.includes("insufficient") ? "Saldo insuficiente para gas"
        : err?.message || "Erro desconhecido";
      log(`❌ ${msg}`);
      recordError("executeSwap", msg);
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