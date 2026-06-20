import { recordError } from './circuit-breaker';

// lib/nanopayment-system.ts
// Sistema de nanopagamentos TLAY para agentes de IA

import { realBalance } from "./real-balance-integration";

export interface Nanopayment {
  id: string;
  fromAgent: string;
  toAgent: string;
  amount: number;
  reason: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  txHash?: string;
}

export interface AgentWallet {
  agentId: string;
  balance: number;
  dailySpent: number;
  dailyLimit: number;
  totalSpent: number;
  totalReceived: number;
  lastReset: number;
}

export interface ServicePricing {
  serviceId: string;
  agentProvider: string;
  pricePerCall: number;
  description: string;
}

class NanopaymentSystem {
  private agentWallets: Map<string, AgentWallet> = new Map();
  private payments: Nanopayment[] = [];
  private serviceCatalog: ServicePricing[] = [];
  private dailyLimitDefault = 100;

  constructor() {
    this.initMockData();
  }

  private initMockData() {
    // Carteiras iniciais dos agentes
    const agents = ['QuantumAgent', 'TechnicalAgent', 'NewsAgent', 'MarketAgent', 'VolumeAgent', 'SynthesisAgent'];
    agents.forEach(agent => {
      this.agentWallets.set(agent, {
        agentId: agent,
        balance: 100,
        dailySpent: 0,
        dailyLimit: this.dailyLimitDefault,
        totalSpent: 0,
        totalReceived: 0,
        lastReset: Date.now()
      });
    });

    // Catálogo de serviços
    this.serviceCatalog = [
      { serviceId: 'market-data', agentProvider: 'MarketAgent', pricePerCall: 0.01, description: 'Dados de mercado' },
      { serviceId: 'sentiment', agentProvider: 'NewsAgent', pricePerCall: 0.005, description: 'Análise de sentimento' },
      { serviceId: 'quantum-forecast', agentProvider: 'QuantumAgent', pricePerCall: 0.02, description: 'Previsão quântica' },
      { serviceId: 'technical-indicators', agentProvider: 'TechnicalAgent', pricePerCall: 0.008, description: 'Indicadores técnicos' },
      { serviceId: 'volume-analysis', agentProvider: 'VolumeAgent', pricePerCall: 0.007, description: 'Análise de volume' }
    ];
  }

  private resetDailyIfNeeded(wallet: AgentWallet): AgentWallet {
    const now = Date.now();
    const dayInMs = 86400000;
    if (now - wallet.lastReset > dayInMs) {
      wallet.dailySpent = 0;
      wallet.lastReset = now;
    }
    return wallet;
  }

  private canSpend(agentId: string, amount: number): boolean {
    const wallet = this.agentWallets.get(agentId);
    if (!wallet) return false;
    const resetWallet = this.resetDailyIfNeeded(wallet);
    return resetWallet.balance >= amount && (resetWallet.dailySpent + amount) <= resetWallet.dailyLimit;
  }

  async makePayment(
    fromAgent: string,
    toAgent: string,
    amount: number,
    reason: string
  ): Promise<Nanopayment> {
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (!this.canSpend(fromAgent, amount)) {
      // Tentar dar crÃ©dito automÃ¡tico
      const wallet = this.agentWallets.get(fromAgent);
      if (wallet) {
        wallet.balance += 50;
        this.agentWallets.set(fromAgent, wallet);
        console.log(`ðŸ’¸ CrÃ©dito automÃ¡tico de $50 para ${fromAgent}`);
      }
      
      if (!this.canSpend(fromAgent, amount)) {
        throw new Error(`${fromAgent} nÃ£o tem saldo suficiente`);
      }
    }

    const fromWallet = this.agentWallets.get(fromAgent)!;
    const toWallet = this.agentWallets.get(toAgent)!;

    fromWallet.balance -= amount;
    fromWallet.dailySpent += amount;
    fromWallet.totalSpent += amount;
    
    toWallet.balance += amount;
    toWallet.totalReceived += amount;

    this.agentWallets.set(fromAgent, fromWallet);
    this.agentWallets.set(toAgent, toWallet);

    const payment: Nanopayment = {
      id: paymentId,
      fromAgent,
      toAgent,
      amount,
      reason,
      timestamp: Date.now(),
      status: 'completed'
    };
    this.payments.push(payment);

    console.log(`ðŸ’¸ Nanopagamento: ${fromAgent} pagou $${amount} para ${toAgent} - ${reason}`);
    return payment;
  }

  async payForService(agentId: string, serviceId: string): Promise<Nanopayment> {
    const service = this.serviceCatalog.find(s => s.serviceId === serviceId);
    if (!service) {
      throw new Error(`ServiÃ§o ${serviceId} nÃ£o encontrado`);
    }
    return this.makePayment(agentId, service.agentProvider, service.pricePerCall, `ServiÃ§o: ${service.description}`);
  }

  getBalance(agentId: string): number {
    const wallet = this.agentWallets.get(agentId);
    return wallet ? wallet.balance : 0;
  }

  getAllWallets(): AgentWallet[] {
    return Array.from(this.agentWallets.values()).map(w => this.resetDailyIfNeeded(w));
  }

  getPaymentHistory(agentId?: string): Nanopayment[] {
    if (agentId) {
      return this.payments.filter(p => p.fromAgent === agentId || p.toAgent === agentId);
    }
    return this.payments;
  }

  setDailyLimit(agentId: string, limit: number): void {
    const wallet = this.agentWallets.get(agentId);
    if (wallet) {
      wallet.dailyLimit = limit;
      this.agentWallets.set(agentId, wallet);
    }
  }

  addCredits(agentId: string, amount: number): void {
    let wallet = this.agentWallets.get(agentId);
    if (wallet) {
      wallet.balance += amount;
      this.agentWallets.set(agentId, wallet);
    } else {
      this.agentWallets.set(agentId, {
        agentId,
        balance: amount,
        dailySpent: 0,
        dailyLimit: this.dailyLimitDefault,
        totalSpent: 0,
        totalReceived: amount,
        lastReset: Date.now()
      });
    }
    console.log(`ðŸ’° CrÃ©dito adicionado: ${agentId} +$${amount}`);
  }

  /**
   * Recompensa um agente por performance em trade lucrativo.
   * Cria carteira se nao existir, credita o valor e registra com memoId via transactionMemos.
   */
  rewardAgentForTrade(
    agentName: string,
    profitShare: number,
    tradeId: string,
    pair: string
  ): Nanopayment {
    let wallet = this.agentWallets.get(agentName)
    if (!wallet) {
      wallet = {
        agentId: agentName,
        balance: 0,
        dailySpent: 0,
        dailyLimit: this.dailyLimitDefault,
        totalSpent: 0,
        totalReceived: 0,
        lastReset: Date.now(),
      }
      this.agentWallets.set(agentName, wallet)
    }

    wallet.balance += profitShare
    wallet.totalReceived += profitShare

    const payment: Nanopayment = {
      id: `reward_${tradeId}_${agentName}`,
      fromAgent: 'Sistema',
      toAgent: agentName,
      amount: profitShare,
      reason: `🎯 Performance trade ${pair} (${tradeId.slice(0, 8)})`,
      timestamp: Date.now(),
      status: 'completed',
    }
    this.payments.push(payment)

    console.log(`🏆 Recompensa: ${agentName} recebeu $${profitShare.toFixed(4)} por trade ${pair} (${tradeId.slice(0, 8)})`)
    return payment
  }

  /** Total recebido por performance de trades (exclui pagamentos de servicos) */
  getPerformanceEarnings(agentId: string): number {
    return this.payments
      .filter(p => p.toAgent === agentId && p.id.startsWith('reward_'))
      .reduce((sum, p) => sum + p.amount, 0)
  }

  getServiceCatalog(): ServicePricing[] {
    return this.serviceCatalog;
  }

  getStats() {
    const totalPayments = this.payments.length;
    const totalVolume = this.payments.reduce((sum, p) => sum + p.amount, 0);
    const avgPayment = totalVolume / (totalPayments || 1);
    return { totalPayments, totalVolume, avgPayment };
  }

  // Verificar se agente pode gastar (usando saldo virtual ou real)
  async canAgentSpend(agentId: string, amount: number, userAddress: string): Promise<boolean> {
    const virtualAgents = ['QuantumTrader', 'ArbitrageHunter', 'ScalpingBot', 'MarketMaker'];
    
    if (virtualAgents.includes(agentId)) {
      return this.canSpend(agentId, amount);
    } else {
      const realBalanceAmount = await realBalance.getRealUSDCBalance(userAddress);
      return realBalanceAmount >= amount;
    }
  }

  // Gastar da fonte correta
  async spendFromCorrectSource(agentId: string, amount: number, userAddress: string): Promise<boolean> {
    const virtualAgents = ['QuantumTrader', 'ArbitrageHunter', 'ScalpingBot', 'MarketMaker'];
    
    if (virtualAgents.includes(agentId)) {
      if (this.canSpend(agentId, amount)) {
        const wallet = this.agentWallets.get(agentId)!;
        wallet.balance -= amount;
        wallet.dailySpent += amount;
        this.agentWallets.set(agentId, wallet);
        return true;
      }
      return false;
    } else {
      return false;
    }
  }
}

export const nanopaymentSystem = new NanopaymentSystem();
