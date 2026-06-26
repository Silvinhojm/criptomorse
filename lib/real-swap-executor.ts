// lib/real-swap-executor.ts
// Executa SWAPS REAIS via LI.FI API REST + assinatura ethers.Wallet
// Suporte a múltiplos pares e saldo real por rede

import { ethers } from "ethers";
import { NonceManager } from "./nonce-manager";
import { getQuote, isLifiCooldown, toTokenUnits } from "./lifi-executor";
import type { QuoteResult } from "./lifi-executor";
import { getCircuitBreakerState, recordError, setTestnetMode } from "./circuit-breaker";
import { gasPriceOracle } from "./gas-price-oracle";
import { getArcFeeParams } from "./arc-gas";
import { generateSyntheticQuote, executeDirectSwap } from "./arc-direct-swap";
import { arcMemo } from "./arc-memo";
import { transactionMemos } from "./transaction-memos";
import { CCTP_CONFIG, cctpService } from "./cctp";
import { unifiedBalance } from "./unified-balance";
import { caixa } from "./caixa";
import { hasDirectDex, getDirectDexQuote, executeDirectDexSwap, calculateAmountOutMin } from "./direct-dex";

// Decimais conhecidos por token (fallback quando tokenBalances não carregou)
export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6, EURC: 6, DAI: 18,
  WETH: 18, WMATIC: 18, WBTC: 8, ARB: 18,
  cirBTC: 8, mcirBTC: 8, SOL: 9,
}

// ─── Redes suportadas ────────────────────────────────────────────────────────
// Custo estimado de gas em USD por rede (para deducao do lucro)
// Valores realistas para micro-trades (Base ~$0.003, Polygon ~$0.005, Arb ~$0.02)
export const GAS_COST_ESTIMATE: Record<string, number> = {
  arc: 0.006,
  base: 0.003,
  polygon: 0.005,
  ethereum: 1.50,
  arbitrum: 0.02,
  sepolia: 0.006,
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
      NATIVE:"0x0000000000000000000000000000000000000000",
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
      NATIVE:"0x0000000000000000000000000000000000000000",
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
      cirBTC: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E",
      NATIVE:"0x0000000000000000000000000000000000000000",
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
      NATIVE:"0x0000000000000000000000000000000000000000",
    },
  },
  sepolia: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    rpcUrl: "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    isTestnet: true,
    nativeSymbol: "ETH",
    tokens: {
      USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      NATIVE:"0x0000000000000000000000000000000000000000",
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
    { from: "USDC", to: "WETH", label: "USDC→WETH" },
    { from: "WETH", to: "USDC", label: "WETH→USDC" },
    { from: "USDC", to: "WBTC", label: "USDC→WBTC" },
    { from: "WBTC", to: "USDC", label: "WBTC→USDC" },
    { from: "WETH", to: "WBTC", label: "WETH→WBTC" },
    { from: "WBTC", to: "WETH", label: "WBTC→WETH" },
    { from: "USDC", to: "DAI",  label: "USDC→DAI" },
    { from: "DAI",  to: "USDC", label: "DAI→USDC" },
    { from: "USDC", to: "EURC", label: "USDC→EURC" },
    { from: "USDC", to: "cirBTC", label: "USDC→cirBTC" },
    { from: "cirBTC", to: "USDC", label: "cirBTC→USDC" },
    { from: "EURC", to: "cirBTC", label: "EURC→cirBTC" },
    { from: "cirBTC", to: "EURC", label: "cirBTC→EURC" },
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
  sepolia: [
    { from: "USDC", to: "WETH", label: "USDC→WETH" },
    { from: "WETH", to: "USDC", label: "WETH→USDC" },
  ],
};

// Tokens atrelados a USD (stablecoins) — usados para cálculo de lucro
const STABLE_TOKENS: Set<TokenSymbol> = new Set(["USDC", "USDT", "DAI", "EURC"]);

export function isStable(token: TokenSymbol): boolean {
  return STABLE_TOKENS.has(token);
}

function getDynamicSlippageBps(token: TokenSymbol): number {
  if (isStable(token)) return 30
  return 100
}

function getDynamicSlippage(token: TokenSymbol): number {
  if (isStable(token)) return 0.003
  return 0.005
}

// Lucro mínimo dinâmico por rede (cobre gas real da RPC + margem)
// ETH: margem 3x (conservador) | Demais redes: margem 1.5x (micro-trades)
async function getMinProfitThreshold(networkKey: NetworkKey): Promise<number> {
  const gasCost = await gasPriceOracle.getGasCost(networkKey);
  if (networkKey === "ethereum") return Math.max(0.01, gasCost * 3);
  return Math.max(0.001, gasCost * 1.2);
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
import { COIN_IDS } from "./coin-ids";

const UB_CHAIN: Record<string, string> = {
  arc: "Arc_Testnet",
  base: "Base",
  polygon: "Polygon",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  sepolia: "Ethereum_Sepolia",
};

class RealSwapExecutor {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Signer | null = null;
  private networkKey: NetworkKey = "arc";
  private BACKUP_RPCS: Record<string, string[]> = {
    polygon: [
      "https://polygon.llamarpc.com",
      "https://polygon-rpc.com",
      "https://rpc-mainnet.maticvigil.com",
    ],
    base: [],
    ethereum: [],
    arbitrum: [],
    sepolia: [
      "https://sepolia.gateway.tenderly.co",
      "https://ethereum-sepolia.publicnode.com",
    ],
  }
  private userAddress: string = "";
  private privateKey: string = "";
  private tokenBalances: Map<TokenSymbol, TokenBalance> = new Map();
  private nativeBalanceWei: bigint = 0n;
  private nativeBalanceUSD: number = 0;
  private nativeBalanceLastUpdated: number = 0;
  private priceCache: Map<TokenSymbol, { price: number; timestamp: number }> = new Map();
  private quoteCache: Map<string, { quote: QuoteResult | null; timestamp: number }> = new Map();
  private _refuelingGas = false;

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
    if (!coinId) {
      if (isStable(token)) return cached?.price ?? 1.0
      return cached?.price ?? 1.0
    }
    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return cached?.price ?? (isStable(token) ? 1.0 : 0)
      const body = await res.json();
      const prices = body?.prices;
      const price = (prices && prices[coinId]) ?? 0;
      if (price > 0) {
        this.priceCache.set(token, { price, timestamp: Date.now() });
        return price;
      }
      return cached?.price ?? 0;
    } catch {
      return cached?.price ?? 0;
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
      this.provider = this._createProxyProvider(net.rpcUrl);

      if (readOnly) {
        this.userAddress = privateKeyOrAddress;
        console.log(`👁️ RealSwapExecutor (read-only): ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      } else if (privateKeyOrAddress.length === 66 && privateKeyOrAddress.startsWith("0x")) {
        this.signer = new ethers.Wallet(privateKeyOrAddress, this.provider);
        this.userAddress = await this.signer.getAddress();
        this.privateKey = privateKeyOrAddress;
        console.log(`✅ RealSwapExecutor: ${net.name} | ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`);
      } else if (privateKeyOrAddress.length === 64 && /^[0-9a-fA-F]+$/.test(privateKeyOrAddress)) {
        this.signer = new ethers.Wallet("0x" + privateKeyOrAddress, this.provider);
        this.userAddress = await this.signer.getAddress();
        this.privateKey = "0x" + privateKeyOrAddress;
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
      this.provider = this._createProxyProvider(net.rpcUrl);
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
    this.provider = this._createProxyProvider(net.rpcUrl);
    if (this.signer && typeof (this.signer as any).connect === "function") {
      this.signer = (this.signer as ethers.Wallet).connect(this.provider);
    }
    this.priceCache.clear();
    await this.refreshAllBalances();
    setTestnetMode(net.isTestnet);
    console.log(`🔀 RealSwapExecutor switch: ${net.name}`);
  }

  private _createProxyProvider(targetRpcUrl: string): ethers.JsonRpcProvider {
    const provider = new ethers.JsonRpcProvider();
    // Redireciona todas as chamadas RPC pelo backend para evitar CORS
    (provider as any)._send = async function(payload: any) {
      const res = await fetch('/api/rpc-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpcUrl: targetRpcUrl, body: payload }),
      });
      if (!res.ok) {
        throw new Error(`RPC proxy HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      // ethers espera array de respostas mesmo para chamada única
      return Array.isArray(data) ? data : [data];
    };
    return provider;
  }

  // Atualizar todos os saldos de tokens da rede atual
  async refreshAllBalances(): Promise<Map<TokenSymbol, TokenBalance>> {
    if (!this.userAddress) return this.tokenBalances;

    const net = NETWORKS[this.networkKey];
    const previousBalances = new Map(this.tokenBalances)
    this.tokenBalances.clear()

    const rpcsParaTentar: string[] = ['__PROVIDER__']
    rpcsParaTentar.push(net.rpcUrl, ...(this.BACKUP_RPCS[this.networkKey] ?? []))
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      rpcsParaTentar.push('metamask')
    }

    type ResolvedBalance = { raw: bigint; decimals: bigint }
    const rpcCall = async (rpcUrl: string, method: string, params: unknown[]): Promise<any> => {
      const res = await fetch('/api/rpc-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpcUrl, body: { jsonrpc: '2.0', id: 1, method, params } }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return data.result
    }
    const erc20BalanceOf = (address: string, userAddress: string, rpcUrl: string): Promise<ResolvedBalance> =>
      Promise.all([
        rpcCall(rpcUrl, 'eth_call', [{ to: address, data: `0x70a08231000000000000000000000000${userAddress.slice(2)}` }, 'latest']),
        rpcCall(rpcUrl, 'eth_call', [{ to: address, data: '0x313ce567' }, 'latest']),
      ]).then(([raw, decimals]) => ({ raw: BigInt(raw), decimals: BigInt(decimals) }))

    let anyProviderSucceeded = false
    const fetchFrom = async (prov: ethers.Provider, label: string): Promise<number> => {
      let nonZero = 0
      let tokenCount = 0
      await Promise.all(
        (Object.entries(net.tokens) as [string, string][]).map(async ([symbol, address]) => {
          try {
            const contract = new ethers.Contract(address, ERC20_ABI, prov);
            const [raw, decimals] = await Promise.all([
              contract.balanceOf(this.userAddress),
              contract.decimals(),
            ]);
            const balance = parseFloat(ethers.formatUnits(raw, decimals));
            this.tokenBalances.set(symbol, { symbol, balance, address, decimals: Number(decimals) });
            if (balance > 0.0001) nonZero++
            tokenCount++
          } catch (e) {
            if (!this.tokenBalances.has(symbol)) {
              this.tokenBalances.set(symbol, { symbol, balance: 0, address, decimals: 6 });
            }
          }
        })
      );
      if (tokenCount > 0) {
        anyProviderSucceeded = true
        console.debug(`🔁 Balance via ${label}: ${nonZero} non-zero of ${Object.keys(net.tokens).length}`)
      }
      return nonZero
    }
    const fetchFromProxyRpc = async (rpcUrl: string, label: string): Promise<boolean> => {
      let ok = 0
      await Promise.all(
        (Object.entries(net.tokens) as [string, string][]).map(async ([symbol, address]) => {
          try {
            const { raw, decimals } = await erc20BalanceOf(address, this.userAddress!, rpcUrl)
            const balance = parseFloat(ethers.formatUnits(raw, Number(decimals)))
            this.tokenBalances.set(symbol, { symbol, balance, address, decimals: Number(decimals) })
            if (balance > 0.0001) ok++
          } catch {
            if (!this.tokenBalances.has(symbol)) {
              this.tokenBalances.set(symbol, { symbol, balance: 0, address, decimals: 6 })
            }
          }
        })
      )
      if (ok > 0) {
        anyProviderSucceeded = true
        console.log(`🔁 Balance via ${label}: ${ok} non-zero`)
      }
      return this.tokenBalances.size > 0
    }

    for (const rpc of rpcsParaTentar) {
      try {
        if (rpc === 'metamask') {
          const mmProvider = new ethers.BrowserProvider((window as any).ethereum)
          await fetchFrom(mmProvider, 'MetaMask')
          if (this.tokenBalances.size > 0) break
        } else if (rpc === '__PROVIDER__') {
          if (!this.provider) throw new Error('no provider')
          await fetchFrom(this.provider, 'signer provider')
          if (this.tokenBalances.size > 0) break
        } else {
          const ok = await fetchFromProxyRpc(rpc, rpc.replace(/https?:\/\//, ''))
          if (ok) break
        }
      } catch (e) {
        console.warn(`⚠️ RPC ${rpc} failed:`, (e as Error)?.message ?? e)
        continue
      }
    }

    if (!anyProviderSucceeded && previousBalances.size > 0) {
      console.log('↩️ All RPCs failed, restoring previous balances')
      this.tokenBalances.clear()
      previousBalances.forEach((v, k) => this.tokenBalances.set(k, v))
    }

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
      this.nativeBalanceUSD = formatted * nativePrice;
      return this.nativeBalanceUSD;
    } catch {
      return 0;
    }
  }

  getNativeBalanceUSD(): number {
    return this.nativeBalanceUSD;
  }

  // FIX: unpack { prices: {...} } igual ao gas-price-oracle.ts
  // Antes: data[coinId] → undefined → fallback 1.0 → POL valia $1 → $83 USD
  // Agora: (data.prices ?? data)[coinId] → preço real → $0.078 → $6.47 USD
  private async _fetchNativePrice(nativeSymbol: string): Promise<number> {
    const coinId = COIN_IDS[nativeSymbol] || nativeSymbol.toLowerCase();
    if (!coinId) return 0;
    try {
      const res = await fetch(`/api/price?ids=${coinId}`);
      if (!res.ok) return 0;
      const body = await res.json();
      const prices = body?.prices;
      const price = (prices && prices[coinId]) ?? 0;
      return price > 0 ? price : 0;
    } catch {
      return 0;
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

        const fromDecimals    = this.tokenBalances.get(pair.from)?.decimals ?? TOKEN_DECIMALS[pair.from] ?? 6;
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

  // Gateway via CCTP: se falta USDC na rede alvo, busca de outra chain
  private async ensureStableViaCCTP(
    fromToken: TokenSymbol,
    amountUsd: number,
    log: (msg: string) => void
  ): Promise<boolean> {
    if (!isStable(fromToken) || fromToken !== "USDC") return false;
    if (!this.privateKey) return false;

    const targetChain = this.networkKey;
    const targetChainName = UB_CHAIN[targetChain];
    if (!targetChainName) return false;

    let balances: Record<string, number> = {};
    try {
      const s = await caixa.getSaldo("mainnet");
      balances = s.porRede;
    } catch {
      balances = {};
    }

    const sourceChains = Object.keys(UB_CHAIN).filter(k => k !== targetChain);
    for (const srcChain of sourceChains) {
      const srcChainName = UB_CHAIN[srcChain];
      let srcBalance = balances[srcChainName] ?? 0;

      if (srcBalance === 0) {
        try {
          const srcConfig = CCTP_CONFIG[srcChain as keyof typeof CCTP_CONFIG];
          if (srcConfig && srcConfig.rpcUrl) {
            const prov = this._createProxyProvider(srcConfig.rpcUrl);
            const contract = new ethers.Contract(srcConfig.usdc, ERC20_ABI, prov);
            const [raw, decimals] = await Promise.all([
              contract.balanceOf(this.userAddress),
              contract.decimals(),
            ]);
            srcBalance = parseFloat(ethers.formatUnits(raw, decimals));
            log(`🔍 On-chain USDC em ${srcChainName}: $${srcBalance.toFixed(2)}`);
          }
        } catch (err: any) {
          log(`⚠️ Fallback balance ${srcChainName}: ${err.message}`);
        }
      }

      if (srcBalance < amountUsd * 1.05) continue;

      log(`🌉 Bridge via CCTP: ${srcChain}→${targetChain} $${amountUsd.toFixed(2)} USDC`);
      try {
        const srcConfig = CCTP_CONFIG[srcChain as keyof typeof CCTP_CONFIG];
        if (!srcConfig) continue;
        const srcProvider = this._createProxyProvider(srcConfig.rpcUrl);
        const srcSigner = new ethers.Wallet(this.privateKey, srcProvider);

        const result = await cctpService.initiateTransfer({
          fromChain: srcChain,
          toChain: targetChain,
          amount: amountUsd,
          recipient: this.userAddress,
          signer: srcSigner,
          onStep: (step) => log(`  CCTP ${step.name}: ${step.state}${step.txHash ? ' ' + step.txHash.slice(0, 10) + '...' : ''}`),
        });

        if (result.status === "completed") {
          log(`✅ Bridge CCTP concluído: ${srcChain}→${targetChain} | TX: ${result.txHash.slice(0, 10)}...`);
          return true;
        }
      } catch (err: any) {
        log(`⚠️ Bridge CCTP falhou de ${srcChain}: ${err.message}`);
        continue;
      }
    }

    log(`⚠️ Nenhuma source chain com USDC suficiente para bridge`);
    return false;
  }

  // Auto-gas: se native token está baixo, compra com USDC
  private async ensureGasBalance(
    amountUsd: number,
    log: (msg: string) => void
  ): Promise<void> {
    if (this._refuelingGas) return;
    if (NETWORKS[this.networkKey].isTestnet) return;
    if (!this.signer) return;
    if (!(NETWORKS[this.networkKey].tokens as any)["NATIVE"]) return;

    const nativeBal = await this.refreshNativeBalance();
    if (nativeBal >= 0.50) return;

    const usdcBal = this.getBalance("USDC");
    const swapAmount = Math.min(usdcBal * 0.1, amountUsd * 2, 5);
    if (swapAmount < 0.50) return;

    const nativeSym = NETWORKS[this.networkKey].nativeSymbol;
    log(`⛽ ${nativeSym} ${nativeBal < 0.01 ? "zerado" : "baixo"} ($${nativeBal.toFixed(4)}), comprando $${swapAmount.toFixed(2)} com USDC`);
    this._refuelingGas = true;
    const result = await this.executeSwap("USDC", "NATIVE", swapAmount, log, "gas");
    this._refuelingGas = false;
    if (result.success) {
      log(`✅ Gas recarregado: $${swapAmount.toFixed(2)} USDC → ${nativeSym}`);
      await this.refreshNativeBalance();
    } else {
      log(`⚠️ Falha ao recarregar gas: ${result.message}`);
    }
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
    let fromBalance     = this.getBalance(fromToken);
    const fromPrice       = await this._getTokenPrice(fromToken);
    let fromBalanceUsd  = fromBalance * fromPrice;
    if (fromBalanceUsd < amountUsd * 0.95) {
      const bridged = await this.ensureStableViaCCTP(fromToken, amountUsd, log);
      if (bridged) {
        await this.refreshAllBalances();
        fromBalance = this.getBalance(fromToken);
        fromBalanceUsd = fromBalance * fromPrice;
      }
    }
    if (fromBalanceUsd < amountUsd * 0.95) {
      return this._fail(fromToken, toToken, amountUsd, `Saldo insuficiente de ${fromToken}: $${fromBalanceUsd.toFixed(4)} (${fromBalance.toFixed(6)} ${fromToken})`, timestamp);
    }

    let nativeBalanceUsd = await this.refreshNativeBalance();
    const gasCost = await gasPriceOracle.getGasCost(this.networkKey);
    const isTestnet = NETWORKS[this.networkKey].isTestnet;
    const gasReserve = gasCost * 5;
    if (!isTestnet && nativeBalanceUsd < gasReserve) {
      await this.ensureGasBalance(amountUsd, log);
      nativeBalanceUsd = await this.refreshNativeBalance();
    }
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

      const fromDecimals    = this.tokenBalances.get(fromToken)?.decimals ?? TOKEN_DECIMALS[fromToken] ?? 6;
      const fromTokenAmount = amountUsd / fromPrice;
      const fromAmountRaw   = toTokenUnits(fromTokenAmount, fromDecimals);

      // ─── Busca rotas: DEX direto + LI.FI em paralelo, escolhe a melhor ──
      interface RouteOption {
        label: string;
        spender: string;
        toAmountRaw: bigint;
        gasEstimate: number;
        execute: () => Promise<{ success: boolean; txHash?: string; error?: string }>;
      }

      const toDecimals = this.tokenBalances.get(toToken)?.decimals ?? TOKEN_DECIMALS[toToken] ?? 6;
      const toPrice = await this._getTokenPrice(toToken);
      const routes: RouteOption[] = [];

      // DEX direto
      if (!net.isTestnet && hasDirectDex(this.networkKey)) {
        const dexQuote = await getDirectDexQuote(this.networkKey, this.provider, fromTokenAddr, toTokenAddr, BigInt(fromAmountRaw));
        if (dexQuote && dexQuote.amountOut > 0n) {
          const amountOutMin = calculateAmountOutMin(dexQuote.amountOut, getDynamicSlippageBps(toToken));
          routes.push({
            label: `DEX ${this.networkKey}`,
            spender: dexQuote.router,
            toAmountRaw: dexQuote.amountOut,
            gasEstimate: dexQuote.estimatedGas,
            execute: async () => {
              const tc = new ethers.Contract(fromTokenAddr, ERC20_ABI, this.signer);
              const al = await tc.allowance(this.userAddress, dexQuote.router);
              if (al < BigInt(fromAmountRaw)) {
                log(`🔓 Aprovando ${fromToken} para DEX ${dexQuote.router.slice(0, 10)}...`);
                const atx = await tc.approve(dexQuote.router, ethers.MaxUint256);
                await atx.wait();
              }
              return executeDirectDexSwap(this.networkKey, this.signer!, this.userAddress,
                fromTokenAddr, toTokenAddr, BigInt(fromAmountRaw), amountOutMin, 100, (m) => log(m));
            },
          });
        }
      }

      // LI.FI
      let lifiQuote: QuoteResult | null = null;
      try {
        lifiQuote = await getQuote({
          fromChain: net.chainId, toChain: net.chainId,
          fromToken: fromTokenAddr, toToken: toTokenAddr,
          fromAmount: fromAmountRaw, fromAddress: this.userAddress,
          toAddress: this.userAddress, slippage: getDynamicSlippage(toToken),
        });
      } catch { /* LI.FI falhou */ }
      if (lifiQuote && lifiQuote.transactionRequest?.data && lifiQuote.transactionRequest?.to) {
        const lifiToEstimate = parseFloat(lifiQuote.toAmount ?? "0") / Math.pow(10, toDecimals);
        if (lifiToEstimate > 0) {
          routes.push({
            label: `LI.FI ${lifiQuote.tool || 'aggregator'}`,
            spender: lifiQuote.transactionRequest.to,
            toAmountRaw: ethers.parseUnits(lifiToEstimate.toFixed(toDecimals), toDecimals),
            gasEstimate: Number(lifiQuote.estimatedGas ?? 300000),
            execute: async () => {
              const tc = new ethers.Contract(fromTokenAddr, ERC20_ABI, this.signer);
              const al = await tc.allowance(this.userAddress, lifiQuote.transactionRequest!.to);
              if (al < BigInt(fromAmountRaw)) {
                log(`🔓 Aprovando ${fromToken} para LI.FI...`);
                const atx = await tc.approve(lifiQuote.transactionRequest!.to, ethers.MaxUint256);
                await atx.wait();
              }
              const arcFeeParams = net.chainId === 5042002 ? getArcFeeParams() : {};
              // Fix Arc gasLimit: estima gas com fallback de 500k se undefined
              let arcGasLimit: bigint | undefined = lifiQuote.transactionRequest!.gasLimit
                ? BigInt(lifiQuote.transactionRequest!.gasLimit)
                : undefined;
              if (net.chainId === 5042002) {
                if (!arcGasLimit) {
                  try {
                    const est = await this.signer!.provider!.estimateGas({
                      to: lifiQuote.transactionRequest!.to,
                      data: lifiQuote.transactionRequest!.data,
                      value: BigInt(lifiQuote.transactionRequest!.value ?? "0"),
                    });
                    arcGasLimit = (est * 130n) / 100n;
                    log(`⛽ Arc gasLimit estimado: ${arcGasLimit}`);
                  } catch {
                    arcGasLimit = 500_000n;
                    log(`⛽ Arc gasLimit fallback: 500000`);
                  }
                }
              }
              const nonce = await NonceManager.getInstance().getNonce(this.signer!.provider!, net.chainId, this.userAddress).catch(() => undefined);
              try {
                const txResp = await this.signer!.sendTransaction({
                  to: lifiQuote.transactionRequest!.to,
                  data: lifiQuote.transactionRequest!.data,
                  value: BigInt(lifiQuote.transactionRequest!.value ?? "0"),
                  gasLimit: arcGasLimit,
                  nonce,
                  ...arcFeeParams,
                });
                log(`🔗 LI.FI TX: ${txResp.hash}`);
                const receipt = await txResp.wait(1);
                if (!receipt || receipt.status === 0) return { success: false, error: "LI.FI TX falhou" };
                return { success: true, txHash: txResp.hash };
              } catch (e: any) {
                return { success: false, error: `LI.FI TX: ${e.message.slice(0, 150)}` };
              }
            },
          });
        }
      }

      // Escolhe a melhor rota (maior output estimado)
      if (routes.length === 0) {
        if (net.isTestnet && this.signer) {
          log(`🧪 Nenhuma rota LI.FI/DEX — executando transação direta na testnet (stress)`);
          const directResult = await executeDirectSwap(this.signer, fromTokenAddr, toTokenAddr, fromAmountRaw, this.userAddress, net.chainId, (m) => log(m));
          if (directResult.success) {
            const amountReceived = parseFloat(directResult.amountReceived ?? "0") / Math.pow(10, toDecimals);
            const toAmountUsd = amountReceived * toPrice;
            const preSwapBalance = this.getBalance(toToken);
            const action: "BUY" | "SELL" | "HOLD" = !isStable(toToken) && isStable(fromToken) ? "BUY" : "SELL";
            log(`💵 Transação direta: ${amountReceived.toFixed(6)} ${toToken} ($${toAmountUsd.toFixed(2)}) | tx: ${directResult.txHash?.slice(0, 10)}`);
            return {
              success: true,
              txHash: directResult.txHash ?? `direct_${Date.now()}`,
              explorerUrl: directResult.explorerUrl,
              fromToken, toToken,
              fromAmount: amountUsd,
              toAmount: amountReceived,
              fromAmountUsd: amountUsd,
              toAmountUsd,
              feeUsd: 0,
              action,
              preSwapBalance,
            } as any;
          }
        }
        const motivo = !lifiQuote ? (isLifiCooldown() ? "LI.FI em cooldown" : "Nenhuma rota disponível") : "Rota inválida";
        return this._fail(fromToken, toToken, amountUsd, motivo, timestamp);
      }

      const bestRoute = routes.reduce((a, b) => a.toAmountRaw >= b.toAmountRaw ? a : b);
      log(`🏆 Rota escolhida: ${bestRoute.label} (output: ${ethers.formatUnits(bestRoute.toAmountRaw, toDecimals).slice(0, 10)} ${toToken})`);

      const bestToEstimate = Number(ethers.formatUnits(bestRoute.toAmountRaw, toDecimals));
      const bestToEstimateUsd = bestToEstimate * toPrice;

      // Profit check
      const gasCostEstimated = await gasPriceOracle.getGasCost(this.networkKey);
      const estimatedProfit = isStable(toToken) ? bestToEstimateUsd - amountUsd : 0;
      const minProfit = await getMinProfitThreshold(this.networkKey);
      if (isStable(toToken) && estimatedProfit < minProfit) {
        return this._fail(fromToken, toToken, amountUsd,
          `Lucro $${estimatedProfit.toFixed(4)} < min $${minProfit} (rota ${bestRoute.label})`, timestamp);
      }
      const minVolatileTrade = this.networkKey === "ethereum" ? 50 : net.isTestnet ? 1 :
        (this.networkKey === "polygon" || this.networkKey === "base" || this.networkKey === "arbitrum" ? 0.1 : 20);
      if (!net.isTestnet && !isStable(toToken) && amountUsd < minVolatileTrade) {
        return this._fail(fromToken, toToken, amountUsd,
          `Trade volátil $${amountUsd} < mínimo $${minVolatileTrade}`, timestamp);
      }

      const isBuyingVolatile = !isStable(toToken) && isStable(fromToken);
      const isSellingForStable = isStable(toToken) && !isStable(fromToken);
      const action: "BUY" | "SELL" | "HOLD" = isBuyingVolatile ? "BUY" : isSellingForStable ? "SELL" : "BUY";
      const preSwapBalance = this.getBalance(toToken);

      // Executa a melhor rota
      log(`🚀 Executando rota ${bestRoute.label}...`);
      const result = await bestRoute.execute();

      if (!result.success) {
        // Se a melhor rota falhou, tenta a outra se existir
        const fallbackRoute = routes.find(r => r.label !== bestRoute.label);
        if (fallbackRoute) {
          log(`⚠️ ${bestRoute.label} falhou, tentando ${fallbackRoute.label}...`);
          const fallbackResult = await fallbackRoute.execute();
          if (!fallbackResult.success) {
            return this._fail(fromToken, toToken, amountUsd,
              `Ambas rotas falharam: ${bestRoute.label} + ${fallbackRoute.label}`, timestamp);
          }
          // Fallback sucedeu — continua abaixo
          await this.refreshAllBalances();
          const postSwapBalance = this.getBalance(toToken);
          const actualToAmount = Math.max(0, postSwapBalance - preSwapBalance);
          const toAmountUsd = actualToAmount * toPrice;
          const profit = isStable(toToken) ? toAmountUsd - amountUsd : 0;
          const explorerUrl = `${net.explorer}/tx/${fallbackResult.txHash}`;

          log(`✅ ${fallbackRoute.label} concluído: ${actualToAmount.toFixed(6)} ${toToken} ($${toAmountUsd.toFixed(4)})`);
          return {
            success: true, txHash: fallbackResult.txHash || '', explorerUrl,
            fromToken, toToken, fromAmount: amountUsd, toAmount: actualToAmount,
            action, message: `✅ ${fromToken}→${toToken} via ${fallbackRoute.label}`,
            timestamp, confirmed: true, profit,
          };
        }
        return this._fail(fromToken, toToken, amountUsd,
          `${bestRoute.label} falhou: ${result.error || "erro desconhecido"}`, timestamp);
      }

      // Sucesso na melhor rota
      await this.refreshAllBalances();
      const postSwapBalance = this.getBalance(toToken);
      const actualToAmount = Math.max(0, postSwapBalance - preSwapBalance);
      const toAmountUsd = actualToAmount * toPrice;
      const profit = isStable(toToken) ? toAmountUsd - amountUsd : 0;
      const explorerUrl = `${net.explorer}/tx/${result.txHash}`;

      log(`✅ ${bestRoute.label} concluído: ${actualToAmount.toFixed(6)} ${toToken} ($${toAmountUsd.toFixed(4)})`);
      log(`💵 Lucro líquido real: $${profit.toFixed(4)}`);

      return {
        success: true, txHash: result.txHash || '', explorerUrl,
        fromToken, toToken, fromAmount: amountUsd, toAmount: actualToAmount,
        action, message: `✅ ${fromToken}→${toToken} via ${bestRoute.label}`,
        timestamp, confirmed: true, profit,
      };
    } catch (err: any) {
      const msg =
        err?.code === "ACTION_REJECTED" ? "Rejeitado pelo usuário"
        : err?.message?.includes("insufficient") ? "Saldo insuficiente para gas"
        : err?.message?.slice(0, 200) || "Erro desconhecido";
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
  getProvider(): ethers.Provider | null { return this.provider; }
  getSigner(): ethers.Signer | null { return this.signer; }
  async fetchTokenPrice(token: TokenSymbol): Promise<number> { return this._getTokenPrice(token); }
  async bridgeIfNeeded(fromToken: TokenSymbol, amountUsd: number, log: (msg: string) => void): Promise<boolean> {
    return this.ensureStableViaCCTP(fromToken, amountUsd, log)
  }

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

export function isArcStressMode(): boolean {
  return realSwap.getNetworkKey() === "arc";
}
