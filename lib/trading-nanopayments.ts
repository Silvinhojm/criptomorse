// lib/trading-nanopayments.ts
// Sistema de trading automatizado usando nanopagamentos TLAY

import { nanopaymentSystem, AgentWallet } from "./nanopayment-system";

export interface TradeOrder {
  id: string;
  fromAgent: string;
  toAgent: string;
  amount: number;
  price: number;
  type: 'BUY' | 'SELL';
  status: 'pending' | 'completed' | 'failed';
  timestamp: number;
  profit?: number;
}

export interface MarketPrice {
  usdc: number;
  eurc: number;
  spread: number;
  timestamp: number;
}

class TradingNanopaymentSystem {
  private orders: TradeOrder[] = [];
  private marketPrices: MarketPrice[] = [];
  private activeTrades: Map<string, TradeOrder> = new Map();
  
  // Agentes traders (cada um com sua estratégia)
  private tradingAgents = [
    { name: 'QuantumTrader', strategy: 'momentum', minProfit: 0.001, maxAmount: 10 },
    { name: 'ArbitrageHunter', strategy: 'arbitrage', minProfit: 0.0005, maxAmount: 5 },
    { name: 'ScalpingBot', strategy: 'scalping', minProfit: 0.0002, maxAmount: 2 },
    { name: 'MarketMaker', strategy: 'liquidity', minProfit: 0.0003, maxAmount: 8 }
  ];

  constructor() {
    // Inicializar carteiras para agentes traders com saldo inicial
    this.tradingAgents.forEach(agent => {
      try {
        const balance = nanopaymentSystem.getBalance(agent.name);
        if (balance === 0 || balance < 50) {
          // Dar crédito inicial de $100 para cada agente trader
          nanopaymentSystem.addCredits(agent.name, 100);
          console.log(`✅ Saldo inicial de $100 adicionado para ${agent.name}`);
        }
      } catch (e) {
        console.log(`Agente ${agent.name} não encontrado, criando carteira com $100...`);
        nanopaymentSystem.addCredits(agent.name, 100);
      }
    });
  }

  // Atualizar preço de mercado
  updateMarketPrice(usdcPrice: number, eurcPrice: number) {
    const spread = Math.abs((eurcPrice - usdcPrice) / usdcPrice) * 100;
    this.marketPrices.push({
      usdc: usdcPrice,
      eurc: eurcPrice,
      spread,
      timestamp: Date.now()
    });
    
    // Manter apenas últimos 100 preços
    if (this.marketPrices.length > 100) {
      this.marketPrices.shift();
    }
  }

  // Obter preço atual
  getCurrentPrice(): MarketPrice {
    if (this.marketPrices.length === 0) {
      return { usdc: 1.00, eurc: 1.002, spread: 0.2, timestamp: Date.now() };
    }
    return this.marketPrices[this.marketPrices.length - 1];
  }

  // Agente compra USDC de outro agente
  async buyUSDC(buyerAgent: string, sellerAgent: string, amount: number, price: number): Promise<TradeOrder> {
    const orderId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const totalCost = amount * price;
    
    // Verificar se comprador tem saldo
    const buyerBalance = nanopaymentSystem.getBalance(buyerAgent);
    if (buyerBalance < totalCost) {
      console.log(`${buyerAgent} saldo insuficiente: $${buyerBalance}, adicionando crédito...`);
      // ADICIONADO: dar crédito automático se saldo insuficiente
      nanopaymentSystem.addCredits(buyerAgent, totalCost + 50);
      const newBalance = nanopaymentSystem.getBalance(buyerAgent);
      if (newBalance < totalCost) {
        throw new Error(`${buyerAgent} não tem saldo suficiente mesmo após crédito. Saldo: $${newBalance}, Necessário: $${totalCost}`);
      }
    }
    
    // Verificar se vendedor tem saldo de USDC (simulado)
    const sellerBalance = nanopaymentSystem.getBalance(sellerAgent);
    if (sellerBalance < amount && sellerAgent !== 'SystemAPI') {
      console.log(`${sellerAgent} saldo USDC insuficiente, adicionando crédito...`);
      nanopaymentSystem.addCredits(sellerAgent, amount + 50);
    }
    
    // Realizar pagamento
    const payment = await nanopaymentSystem.makePayment(
      buyerAgent,
      sellerAgent,
      totalCost,
      `Compra de ${amount} USDC a $${price}`
    );
    
    const order: TradeOrder = {
      id: orderId,
      fromAgent: buyerAgent,
      toAgent: sellerAgent,
      amount,
      price,
      type: 'BUY',
      status: 'completed',
      timestamp: Date.now()
    };
    
    this.orders.push(order);
    this.activeTrades.set(orderId, order);
    
    console.log(`📈 COMPRA: ${buyerAgent} comprou ${amount} USDC de ${sellerAgent} por $${totalCost.toFixed(4)}`);
    return order;
  }

  // Agente vende USDC para outro agente
  async sellUSDC(sellerAgent: string, buyerAgent: string, amount: number, price: number): Promise<TradeOrder> {
    const orderId = `sell_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const totalValue = amount * price;
    
    let sellerBalance = nanopaymentSystem.getBalance(sellerAgent);
    if (sellerBalance < amount) {
      console.log(`${sellerAgent} saldo USDC insuficiente: $${sellerBalance}, adicionando crédito...`);
      nanopaymentSystem.addCredits(sellerAgent, amount + 50);
      sellerBalance = nanopaymentSystem.getBalance(sellerAgent);
    }
    
    const payment = await nanopaymentSystem.makePayment(
      buyerAgent,
      sellerAgent,
      totalValue,
      `Venda de ${amount} USDC a $${price}`
    );
    
    const order: TradeOrder = {
      id: orderId,
      fromAgent: sellerAgent,
      toAgent: buyerAgent,
      amount,
      price,
      type: 'SELL',
      status: 'completed',
      timestamp: Date.now()
    };
    
    this.orders.push(order);
    this.activeTrades.set(orderId, order);
    
    console.log(`📉 VENDA: ${sellerAgent} vendeu ${amount} USDC para ${buyerAgent} por $${totalValue.toFixed(4)}`);
    return order;
  }

  // Estratégia de Arbitragem - compra barato, vende caro
  async arbitrageOpportunity(agentName: string): Promise<TradeOrder | null> {
    // Garantir que o agente tem saldo
    let balance = nanopaymentSystem.getBalance(agentName);
    if (balance < 10) {
      nanopaymentSystem.addCredits(agentName, 100);
      balance = nanopaymentSystem.getBalance(agentName);
      console.log(`💸 Crédito automático de $100 para ${agentName}`);
    }
    
    const price = this.getCurrentPrice();
    const spread = price.spread;
    
    if (spread > 0.3) { // Spread > 0.3% é oportunidade (reduzido para mais oportunidades)
      const amount = 3; // $3 por trade (reduzido)
      const buyPrice = Math.min(price.usdc, price.eurc);
      const sellPrice = Math.max(price.usdc, price.eurc);
      const expectedProfit = amount * ((sellPrice - buyPrice) / buyPrice);
      
      if (expectedProfit > 0.001) { // Lucro > $0.001
        const partnerAgent = this.findTradingPartner(agentName);
        if (partnerAgent) {
          try {
            await this.buyUSDC(agentName, partnerAgent, amount, buyPrice);
            await this.sellUSDC(agentName, partnerAgent, amount, sellPrice);
            
            const profit = amount * (sellPrice - buyPrice);
            console.log(`💰 ARBITRAGEM: ${agentName} lucrou $${profit.toFixed(4)} com spread de ${spread.toFixed(2)}%`);
            nanopaymentSystem.addCredits(agentName, profit);
            return this.orders[this.orders.length - 1];
          } catch (error) {
            console.error(`Erro na arbitragem: ${error}`);
            return null;
          }
        }
      }
    }
    return null;
  }

  // Estratégia de Scalping - micro lucros rápidos
  async scalpingStrategy(agentName: string): Promise<TradeOrder | null> {
    // Garantir saldo
    let balance = nanopaymentSystem.getBalance(agentName);
    if (balance < 5) {
      nanopaymentSystem.addCredits(agentName, 50);
    }
    
    const prices = this.marketPrices.slice(-5);
    if (prices.length < 5) return null;
    
    const priceChange = prices[prices.length - 1].usdc - prices[0].usdc;
    const amount = 1.5; // $1.50 por trade
    
    if (Math.abs(priceChange) > 0.0003) { // Pequena tendência
      const partner = this.findTradingPartner(agentName);
      if (partner) {
        try {
          if (priceChange > 0) {
            const order = await this.buyUSDC(agentName, partner, amount, prices[prices.length - 1].usdc);
            console.log(`⚡ SCALPING: ${agentName} comprou ${amount} USDC - tendência de alta`);
            return order;
          } else {
            const order = await this.sellUSDC(agentName, partner, amount, prices[prices.length - 1].usdc);
            console.log(`⚡ SCALPING: ${agentName} vendeu ${amount} USDC - tendência de baixa`);
            return order;
          }
        } catch (error) {
          console.error(`Erro no scalping: ${error}`);
          return null;
        }
      }
    }
    return null;
  }

  // Estratégia de Market Making - oferecer liquidez
  async marketMakingStrategy(agentName: string): Promise<TradeOrder[]> {
    // Garantir saldo
    let balance = nanopaymentSystem.getBalance(agentName);
    if (balance < 20) {
      nanopaymentSystem.addCredits(agentName, 100);
    }
    
    const orders: TradeOrder[] = [];
    const currentPrice = this.getCurrentPrice();
    const amount = 2;
    
    const buyPrice = currentPrice.usdc * 0.999;
    const sellPrice = currentPrice.usdc * 1.001;
    
    const partners = this.findMultiplePartners(agentName, 2);
    
    for (const partner of partners) {
      try {
        const buyOrder = await this.buyUSDC(agentName, partner, amount, buyPrice);
        orders.push(buyOrder);
        
        const sellOrder = await this.sellUSDC(agentName, partner, amount, sellPrice);
        orders.push(sellOrder);
        
        const profit = amount * (sellPrice - buyPrice);
        nanopaymentSystem.addCredits(agentName, profit);
        console.log(`🏦 MARKET MAKING: ${agentName} lucrou $${profit.toFixed(4)}`);
      } catch (e) {
        console.error(`Erro no market making: ${e}`);
      }
    }
    
    return orders;
  }

  // Executar trades automáticos com todos os agentes
  async executeAutomatedTrading(): Promise<void> {
    console.log("🤖 Iniciando ciclo de trades automáticos...");
    
    for (const agent of this.tradingAgents) {
      try {
        // Garantir que cada agente tem saldo antes de executar
        let balance = nanopaymentSystem.getBalance(agent.name);
        if (balance < 10) {
          nanopaymentSystem.addCredits(agent.name, 100);
          console.log(`💸 Crédito automático para ${agent.name}: $100`);
        }
        
        let result: TradeOrder | null = null;
        
        switch (agent.strategy) {
          case 'arbitrage':
            result = await this.arbitrageOpportunity(agent.name);
            break;
          case 'scalping':
            result = await this.scalpingStrategy(agent.name);
            break;
          case 'liquidity':
            await this.marketMakingStrategy(agent.name);
            break;
          case 'momentum':
            const prices = this.marketPrices.slice(-10);
            if (prices.length >= 10) {
              const trend = prices[prices.length - 1].usdc - prices[0].usdc;
              const partner = this.findTradingPartner(agent.name);
              if (partner) {
                if (trend > 0) {
                  result = await this.buyUSDC(agent.name, partner, agent.maxAmount, prices[prices.length - 1].usdc);
                } else {
                  result = await this.sellUSDC(agent.name, partner, agent.maxAmount, prices[prices.length - 1].usdc);
                }
              }
            }
            break;
        }
        
        if (result) {
          console.log(`✅ ${agent.name} (${agent.strategy}) executou trade de $${result.amount} USDC`);
        }
      } catch (error) {
        console.error(`Erro no trade do agente ${agent.name}:`, error);
      }
    }
  }

  // Encontrar parceiro de trade
  private findTradingPartner(agentName: string): string | null {
    const partners = this.tradingAgents.filter(a => a.name !== agentName);
    if (partners.length === 0) return null;
    const randomPartner = partners[Math.floor(Math.random() * partners.length)];
    return randomPartner.name;
  }

  // Encontrar múltiplos parceiros
  private findMultiplePartners(agentName: string, count: number): string[] {
    const partners = this.tradingAgents.filter(a => a.name !== agentName);
    return partners.slice(0, count).map(p => p.name);
  }

  // Obter estatísticas de trading
  getTradingStats() {
    const totalBuys = this.orders.filter(o => o.type === 'BUY').length;
    const totalSells = this.orders.filter(o => o.type === 'SELL').length;
    const totalVolume = this.orders.reduce((sum, o) => sum + (o.amount * o.price), 0);
    const avgTradeSize = totalVolume / (this.orders.length || 1);
    
    const buys = this.orders.filter(o => o.type === 'BUY');
    const sells = this.orders.filter(o => o.type === 'SELL');
    const avgBuyPrice = buys.reduce((sum, o) => sum + o.price, 0) / (buys.length || 1);
    const avgSellPrice = sells.reduce((sum, o) => sum + o.price, 0) / (sells.length || 1);
    const estimatedProfit = (avgSellPrice - avgBuyPrice) * 100;
    
    return {
      totalOrders: this.orders.length,
      totalBuys,
      totalSells,
      totalVolume: totalVolume.toFixed(4),
      avgTradeSize: avgTradeSize.toFixed(4),
      avgBuyPrice: avgBuyPrice.toFixed(6),
      avgSellPrice: avgSellPrice.toFixed(6),
      estimatedProfitPercent: estimatedProfit.toFixed(4)
    };
  }

  // Obter histórico de ordens
  getOrderHistory(agentName?: string): TradeOrder[] {
    if (agentName) {
      return this.orders.filter(o => o.fromAgent === agentName || o.toAgent === agentName);
    }
    return this.orders;
  }

  // Simular preço de mercado em tempo real
  startPriceSimulation(intervalMs: number = 5000) {
    setInterval(() => {
      const lastPrice = this.getCurrentPrice();
      const usdcChange = (Math.random() - 0.5) * 0.0015;
      const eurcChange = (Math.random() - 0.5) * 0.002;
      
      this.updateMarketPrice(
        Math.max(0.99, Math.min(1.01, lastPrice.usdc + usdcChange)),
        Math.max(0.99, Math.min(1.01, lastPrice.eurc + eurcChange))
      );
    }, intervalMs);
  }
}

export const tradingNanopaymentSystem = new TradingNanopaymentSystem();