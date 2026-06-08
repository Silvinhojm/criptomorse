// lib/trading-nanopayments-real.ts
// Sistema de trading usando saldo REAL da MetaMask

import { realBalance } from "./real-balance-integration";

export interface TradeOrderReal {
  id: string;
  fromAgent: string;
  toAgent: string;
  amount: number;
  price: number;
  type: 'BUY' | 'SELL';
  status: 'pending' | 'completed' | 'failed';
  timestamp: number;
  txHash?: string;
}

class TradingNanopaymentSystemReal {
  private orders: TradeOrderReal[] = [];
  private activeTrades: Map<string, TradeOrderReal> = new Map();
  private userAddress: string | null = null;
  
  // Agentes traders
  private tradingAgents = [
    { name: 'QuantumTrader', strategy: 'momentum', maxAmount: 5 },
    { name: 'ArbitrageHunter', strategy: 'arbitrage', maxAmount: 3 },
    { name: 'ScalpingBot', strategy: 'scalping', maxAmount: 2 },
    { name: 'MarketMaker', strategy: 'liquidity', maxAmount: 4 }
  ];

  // Inicializar com endereço da carteira
  async initialize(address: string) {
    this.userAddress = address;
    await realBalance.initialize(address);
    
    // Verificar saldo real
    const balance = await realBalance.getRealUSDCBalance(address);
    console.log(`💰 Saldo REAL da carteira: $${balance.toFixed(2)} USDC`);
    
    if (balance < 10) {
      console.warn(`⚠️ Saldo baixo! Adicione USDC na Arc Testnet pelo faucet.`);
    }
    
    return balance;
  }

  // Comprar USDC (usando saldo real)
  async buyUSDCReal(amount: number, price: number): Promise<TradeOrderReal | null> {
    if (!this.userAddress) {
      throw new Error("Conecte a carteira primeiro");
    }
    
    const totalCost = amount * price;
    const hasBalance = await realBalance.hasEnoughBalance(this.userAddress, totalCost);
    
    if (!hasBalance) {
      console.error(`❌ Saldo insuficiente: necessário $${totalCost.toFixed(4)}`);
      return null;
    }
    
    // Simular compra (em produção, seria um swap real)
    const orderId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const order: TradeOrderReal = {
      id: orderId,
      fromAgent: this.userAddress,
      toAgent: 'Market',
      amount,
      price,
      type: 'BUY',
      status: 'completed',
      timestamp: Date.now()
    };
    
    this.orders.push(order);
    console.log(`📈 COMPRA REAL: ${amount} USDC a $${price} - Total: $${totalCost.toFixed(4)}`);
    
    return order;
  }

  // Vender USDC
  async sellUSDCReal(amount: number, price: number): Promise<TradeOrderReal | null> {
    if (!this.userAddress) {
      throw new Error("Conecte a carteira primeiro");
    }
    
    const hasBalance = await realBalance.hasEnoughBalance(this.userAddress, amount);
    
    if (!hasBalance) {
      console.error(`❌ Saldo insuficiente para venda: ${amount} USDC`);
      return null;
    }
    
    const orderId = `sell_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const totalValue = amount * price;
    
    const order: TradeOrderReal = {
      id: orderId,
      fromAgent: this.userAddress,
      toAgent: 'Market',
      amount,
      price,
      type: 'SELL',
      status: 'completed',
      timestamp: Date.now()
    };
    
    this.orders.push(order);
    console.log(`📉 VENDA REAL: ${amount} USDC a $${price} - Total: $${totalValue.toFixed(4)}`);
    
    return order;
  }

  // Estratégia de Arbitragem com saldo real
  async arbitrageOpportunityReal(): Promise<TradeOrderReal | null> {
    const balance = await realBalance.getRealUSDCBalance(this.userAddress || "");
    if (balance < 5) {
      console.log(`⚠️ Saldo baixo ($${balance.toFixed(2)}), arbitragem não executada`);
      return null;
    }
    
    // Simular oportunidade de arbitragem
    const spread = 0.3 + Math.random() * 0.5;
    
    if (spread > 0.4) {
      const amount = Math.min(3, balance * 0.3);
      const buyPrice = 0.998;
      const sellPrice = 1.002;
      
      console.log(`💰 Oportunidade de arbitragem! Spread: ${spread.toFixed(2)}%`);
      console.log(`   Comprar a $${buyPrice} / Vender a $${sellPrice}`);
      
      const profit = amount * (sellPrice - buyPrice);
      console.log(`   Lucro estimado: $${profit.toFixed(4)}`);
      
      return this.buyUSDCReal(amount, buyPrice);
    }
    
    return null;
  }

  // Obter estatísticas
  getStats() {
    const totalVolume = this.orders.reduce((sum, o) => sum + (o.amount * o.price), 0);
    return {
      totalOrders: this.orders.length,
      totalBuys: this.orders.filter(o => o.type === 'BUY').length,
      totalSells: this.orders.filter(o => o.type === 'SELL').length,
      totalVolume: totalVolume.toFixed(4)
    };
  }

  // Obter histórico
  getOrders() {
    return this.orders;
  }
}

export const tradingReal = new TradingNanopaymentSystemReal();