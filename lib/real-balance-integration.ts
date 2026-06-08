// lib/real-balance-integration.ts
// Integração com saldo REAL da MetaMask

import { ethers } from "ethers";

// Configuração da Arc Testnet
const ARC_TESTNET = {
  usdc: "0x3600000000000000000000000000000000000000",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 5042002
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

export interface RealBalance {
  address: string;
  usdcBalance: number;
  isLoading: boolean;
  error: string | null;
}

class RealBalanceIntegration {
  private provider: ethers.BrowserProvider | null = null;
  private usdcContract: ethers.Contract | null = null;
  private userAddress: string | null = null;

  // Inicializar com a carteira conectada
  async initialize(address: string): Promise<boolean> {
    if (!window.ethereum) {
      console.error("MetaMask não encontrado");
      return false;
    }
    
    try {
      this.userAddress = address;
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.usdcContract = new ethers.Contract(
        ARC_TESTNET.usdc,
        ERC20_ABI,
        await this.provider.getSigner()
      );
      return true;
    } catch (error) {
      console.error("Erro ao inicializar integração real:", error);
      return false;
    }
  }

  // Obter saldo REAL de USDC da carteira
  async getRealUSDCBalance(address: string): Promise<number> {
    if (!this.provider) {
      await this.initialize(address);
    }
    
    try {
      const contract = new ethers.Contract(
        ARC_TESTNET.usdc,
        ERC20_ABI,
        this.provider || new ethers.BrowserProvider(window.ethereum)
      );
      const balance = await contract.balanceOf(address);
      const decimals = await contract.decimals();
      return parseFloat(ethers.formatUnits(balance, decimals));
    } catch (error) {
      console.error("Erro ao buscar saldo real:", error);
      return 0;
    }
  }

  // Transferir USDC real
  async transferUSDC(to: string, amount: number): Promise<boolean> {
    if (!this.usdcContract || !this.userAddress) {
      console.error("Sistema não inicializado");
      return false;
    }
    
    try {
      const decimals = await this.usdcContract.decimals();
      const amountInWei = ethers.parseUnits(amount.toString(), decimals);
      const tx = await this.usdcContract.transfer(to, amountInWei);
      await tx.wait();
      console.log(`✅ Transferência real: ${amount} USDC para ${to}`);
      return true;
    } catch (error) {
      console.error("Erro na transferência real:", error);
      return false;
    }
  }

  // Verificar se tem saldo suficiente
  async hasEnoughBalance(address: string, requiredAmount: number): Promise<boolean> {
    const balance = await this.getRealUSDCBalance(address);
    return balance >= requiredAmount;
  }
}

export const realBalance = new RealBalanceIntegration();