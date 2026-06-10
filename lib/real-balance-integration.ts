// lib/real-balance-integration.ts
// Integração com saldo REAL da MetaMask - CORRIGIDO

import { ethers } from "ethers";
import { realSwap } from "./real-swap-executor";

// Configuração da Arc Testnet
const ARC_TESTNET = {
  usdc: "0x3600000000000000000000000000000000000000",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 5042002
};

// ABI simplificada (sem decimals que pode não existir)
const ERC20_ABI_SIMPLE = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

// ABI completa
const ERC20_ABI_FULL = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
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
  private decimals: number = 6; // USDC tem 6 decimals por padrão

  // Inicializar com a carteira conectada
  async initialize(address: string): Promise<boolean> {
    if (!window.ethereum) {
      console.error("MetaMask não encontrado");
      return false;
    }
    
    try {
      this.userAddress = address;
      this.provider = new ethers.BrowserProvider(window.ethereum);
      
      // Tentar obter decimals do contrato (pode falhar)
      try {
        const tempContract = new ethers.Contract(
          ARC_TESTNET.usdc,
          ERC20_ABI_FULL,
          await this.provider.getSigner()
        );
        const decimals = await tempContract.decimals();
        this.decimals = Number(decimals);
        console.log(`✅ USDC decimals: ${this.decimals}`);
      } catch (decError) {
        console.log("⚠️ Contrato não tem decimals(), usando padrão 6");
        this.decimals = 6;
      }
      
      this.usdcContract = new ethers.Contract(
        ARC_TESTNET.usdc,
        ERC20_ABI_SIMPLE,
        await this.provider.getSigner()
      );
      
      return true;
    } catch (error) {
      console.error("Erro ao inicializar integração real:", error);
      return false;
    }
  }

  // Obter saldo REAL de USDC da carteira - CORRIGIDO
async getRealUSDCBalance(address: string): Promise<number> {
  try {
    const { realSwap } = await import("./real-swap-executor");
    return await realSwap.getBalance("USDC");
  } catch {
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
      const amountInWei = ethers.parseUnits(amount.toString(), this.decimals);
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