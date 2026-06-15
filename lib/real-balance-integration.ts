// lib/real-balance-integration.ts
// Integração com saldo REAL — busca saldo da rede selecionada via JsonRpcProvider

import { ethers } from "ethers";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export interface NetworkConfig {
  rpc: string;
  usdc: string;
  name: string;
  chainId: number;
}

export interface RealBalance {
  address: string;
  usdcBalance: number;
  isLoading: boolean;
  error: string | null;
}

class RealBalanceIntegration {
  private networkConfig: NetworkConfig = {
    rpc: "https://rpc.testnet.arc.network",
    usdc: "0x3600000000000000000000000000000000000000",
    name: "Arc Testnet",
    chainId: 5042002,
  };
  private decimals: number = 6;

  setNetwork(network: NetworkConfig) {
    this.networkConfig = network;
  }

  // Obter saldo REAL de USDC da carteira na rede configurada
  async getRealUSDCBalance(address: string): Promise<number> {
    try {
      const provider = new ethers.JsonRpcProvider(this.networkConfig.rpc);
      const contract = new ethers.Contract(this.networkConfig.usdc, ERC20_ABI, provider);
      const [bal, dec] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals().catch(() => 6),
      ]);
      this.decimals = Number(dec);
      const balanceNumber = parseFloat(ethers.formatUnits(bal, this.decimals));
      console.log(`💰 Saldo REAL na ${this.networkConfig.name}: $${balanceNumber.toFixed(4)} USDC`);
      return balanceNumber;
    } catch (error) {
      console.error("Erro ao buscar saldo real:", error);
      return 0;
    }
  }

  // Verificar se tem saldo suficiente
  async hasEnoughBalance(address: string, requiredAmount: number): Promise<boolean> {
    const balance = await this.getRealUSDCBalance(address);
    return balance >= requiredAmount;
  }
}

export const realBalance = new RealBalanceIntegration();