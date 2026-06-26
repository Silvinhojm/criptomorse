// lib/unified-balance.ts
// Unified Balance - combina USDC de multiplas chains em um saldo unico
// Conforme documentacao ARC: https://docs.arc.io/app-kit/unified-balance

import { ethers } from 'ethers';

interface UnifiedBalanceAccount {
  address: string;
  balances: Record<string, number>;
  lastUpdated: number;
}

interface DepositParams {
  fromChain: string;
  amount: number;
  token: string;
}

interface SpendParams {
  toChain: string;
  amount: number;
  token: string;
  recipient: string;
  memo?: string;
}

interface UnifiedBalanceInfo {
  totalUsdc: number;
  perChain: Record<string, number>;
  depositHistory: DepositRecord[];
  spendHistory: SpendRecord[];
}

interface DepositRecord {
  chain: string;
  amount: number;
  txHash: string;
  timestamp: number;
}

interface SpendRecord {
  chain: string;
  amount: number;
  recipient: string;
  txHash: string;
  timestamp: number;
  memo?: string;
}

class UnifiedBalanceManager {
  private account: UnifiedBalanceAccount | null = null;
  private depositHistory: DepositRecord[] = [];
  private spendHistory: SpendRecord[] = [];
  private provider: ethers.JsonRpcProvider | null = null;

  private readonly ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)',
  ];

  private readonly RPC_MAP: Record<string, string> = {
    'Arc Testnet': 'https://rpc.testnet.arc.network',
    'Base': 'https://mainnet.base.org',
    'Polygon': 'https://polygon.publicnode.com',
    'Ethereum': 'https://eth.llamarpc.com',
  };

  private readonly CHAIN_USDC: Record<string, string> = {
    'Arc Testnet': '0x3600000000000000000000000000000000000000',
    'Base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'Polygon': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    'Ethereum': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  };

  async initialize(address: string) {
    this.account = {
      address,
      balances: {},
      lastUpdated: 0,
    };
  }

  async fetchBalance(chainName: string): Promise<number> {
    const rpc = this.RPC_MAP[chainName];
    const usdcAddress = this.CHAIN_USDC[chainName];
    if (!rpc || !usdcAddress || !this.account) return 0;

    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const contract = new ethers.Contract(usdcAddress, this.ERC20_ABI, provider);
      const [bal, dec] = await Promise.all([
        contract.balanceOf(this.account.address),
        contract.decimals().catch(() => 6),
      ]);
      const balance = parseFloat(ethers.formatUnits(bal, Number(dec)));
      this.account.balances[chainName] = balance;
      return balance;
    } catch {
      return 0;
    }
  }

  async refreshAllBalances(): Promise<Record<string, number>> {
    if (!this.account) return {};
    const chains = Object.keys(this.RPC_MAP);
    const results = await Promise.all(
      chains.map(chain => this.fetchBalance(chain))
    );
    const balances: Record<string, number> = {};
    chains.forEach((chain, i) => { balances[chain] = results[i]; });
    this.account.balances = balances;
    this.account.lastUpdated = Date.now();
    return balances;
  }

  getUnifiedBalance(): number {
    if (!this.account) return 0;
    return Object.values(this.account.balances).reduce((sum, b) => sum + b, 0);
  }

  getPerChainBalances(): Record<string, number> {
    return this.account?.balances ?? {};
  }

  async deposit(params: DepositParams): Promise<boolean> {
    if (!this.account) return false;
    this.depositHistory.push({
      chain: params.fromChain,
      amount: params.amount,
      txHash: `pending_${Date.now()}`,
      timestamp: Date.now(),
    });
    return true;
  }

  async spend(params: SpendParams): Promise<string | null> {
    if (!this.account) return null;
    const txHash = `ub_spend_${Date.now()}`;
    this.spendHistory.push({
      chain: params.toChain,
      amount: params.amount,
      recipient: params.recipient,
      txHash,
      timestamp: Date.now(),
      memo: params.memo,
    });
    return txHash;
  }

  getInfo(): UnifiedBalanceInfo {
    return {
      totalUsdc: this.getUnifiedBalance(),
      perChain: this.getPerChainBalances(),
      depositHistory: [...this.depositHistory],
      spendHistory: [...this.spendHistory],
    };
  }

  getHistory() {
    return {
      deposits: [...this.depositHistory].reverse(),
      spends: [...this.spendHistory].reverse(),
    };
  }
}

export const unifiedBalance = new UnifiedBalanceManager();
export type { UnifiedBalanceInfo, DepositParams, SpendParams };
