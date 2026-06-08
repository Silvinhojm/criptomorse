"use client";

import { useState, useEffect } from "react";
import { toast } from "react-hot-toast";
import { tradingNanopaymentSystem } from "@/lib/trading-nanopayments";
import { nanopaymentSystem } from "@/lib/nanopayment-system";

export function TradingNanopaymentDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState(tradingNanopaymentSystem.getTradingStats());
  const [orders, setOrders] = useState(tradingNanopaymentSystem.getOrderHistory());
  const [wallets, setWallets] = useState(nanopaymentSystem.getAllWallets());
  const [currentPrice, setCurrentPrice] = useState(tradingNanopaymentSystem.getCurrentPrice());
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  const refreshData = () => {
    setStats(tradingNanopaymentSystem.getTradingStats());
    setOrders(tradingNanopaymentSystem.getOrderHistory());
    setWallets(nanopaymentSystem.getAllWallets());
    setCurrentPrice(tradingNanopaymentSystem.getCurrentPrice());
  };

  const startAutomatedTrading = () => {
    if (isRunning) return;
    setIsRunning(true);
    toast.success("🤖 Trading automatizado iniciado!", { icon: '🤖' });
    
    const id = setInterval(async () => {
      try {
        await tradingNanopaymentSystem.executeAutomatedTrading();
        refreshData();
      } catch (error) {
        console.error("Erro no trading:", error);
      }
    }, 20000);
    
    setIntervalId(id);
  };

  const stopAutomatedTrading = () => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
    setIsRunning(false);
    toast.success("⏹️ Trading automatizado parado", { icon: '⏹️' }); // CORRIGIDO: toast.info → toast.success
  };

  const handleAddCredits = (agentName: string) => {
    nanopaymentSystem.addCredits(agentName, 50);
    refreshData();
    toast.success(`💰 $50 adicionado para ${agentName}`, { icon: '💰' });
  };

  const handleArbitrage = async () => {
    toast.loading("Procurando oportunidade de arbitragem...", { id: "arb" });
    try {
      const result = await tradingNanopaymentSystem.arbitrageOpportunity("ArbitrageHunter");
      if (result) {
        toast.success(`💰 Arbitragem executada!`, { id: "arb", icon: '💰' });
      } else {
        toast.error("Nenhuma oportunidade de arbitragem no momento", { id: "arb" });
      }
    } catch (error) {
      toast.error("Erro na arbitragem", { id: "arb" });
    }
    refreshData();
  };

  const handleScalping = async () => {
    toast.loading("Executando scalping...", { id: "scalp" });
    try {
      const result = await tradingNanopaymentSystem.scalpingStrategy("ScalpingBot");
      if (result) {
        toast.success(`⚡ Scalping executado!`, { id: "scalp", icon: '⚡' });
      } else {
        toast.success("Sem oportunidade de scalping agora", { id: "scalp", icon: '📊' }); // CORRIGIDO: toast.info → toast.success
      }
    } catch (error) {
      toast.error("Erro no scalping", { id: "scalp" });
    }
    refreshData();
  };

  useEffect(() => {
    tradingNanopaymentSystem.startPriceSimulation(5000);
    const priceInterval = setInterval(() => {
      setCurrentPrice(tradingNanopaymentSystem.getCurrentPrice());
    }, 1000);
    
    // Dar crédito inicial para todos os agentes
    const agents = ['QuantumTrader', 'ArbitrageHunter', 'ScalpingBot', 'MarketMaker'];
    agents.forEach(agent => {
      const balance = nanopaymentSystem.getBalance(agent);
      if (balance < 50) {
        nanopaymentSystem.addCredits(agent, 100);
      }
    });
    
    refreshData();
    
    return () => {
      if (intervalId) clearInterval(intervalId);
      clearInterval(priceInterval);
    };
  }, []);

  // Filtrar apenas os agentes traders
  const traderWallets = wallets.filter(w => 
    ['QuantumTrader', 'ArbitrageHunter', 'ScalpingBot', 'MarketMaker'].includes(w.agentId)
  );

  return (
    <div style={{ marginTop: 16, padding: 16, background: '#0f172a', borderRadius: 16, border: '1px solid #f59e0b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🤖💰</span>
        <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>Trading com Nanopagamentos</span>
        {isRunning && <span style={{ fontSize: 9, background: '#22c55e', padding: '2px 6px', borderRadius: 10, color: '#fff' }}>LIVE</span>}
      </div>

      {/* Preços em tempo real */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>USDC</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#4ade80' }}>${currentPrice.usdc.toFixed(6)}</div>
        </div>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>EURC</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#4ade80' }}>${currentPrice.eurc.toFixed(6)}</div>
        </div>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>SPREAD</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: currentPrice.spread > 0.2 ? '#fbbf24' : '#94a3b8' }}>
            {currentPrice.spread.toFixed(3)}%
          </div>
        </div>
      </div>

      {/* Saldo dos Agentes Traders */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>💰 Saldo dos Agentes Traders:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {traderWallets.map(wallet => (
            <div key={wallet.agentId} style={{ background: '#1e293b', padding: '8px 12px', borderRadius: 10, flex: 1, minWidth: 100 }}>
              <div style={{ fontSize: 10, color: '#a78bfa' }}>{wallet.agentId}</div>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: wallet.balance > 0 ? '#4ade80' : '#ef4444' }}>
                ${wallet.balance.toFixed(2)}
              </div>
              <button 
                onClick={() => handleAddCredits(wallet.agentId)}
                style={{ fontSize: 9, background: '#f59e0b', border: 'none', borderRadius: 4, padding: '2px 6px', marginTop: 4, cursor: 'pointer', color: '#0f172a' }}
              >
                +$50
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Botões de controle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {!isRunning ? (
          <button onClick={startAutomatedTrading} style={{ flex: 1, background: '#10b981', color: '#fff', padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            🤖 Iniciar Trading Automático
          </button>
        ) : (
          <button onClick={stopAutomatedTrading} style={{ flex: 1, background: '#ef4444', color: '#fff', padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            ⏹️ Parar Trading
          </button>
        )}
        <button onClick={handleArbitrage} style={{ flex: 1, background: '#8b5cf6', color: '#fff', padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer' }}>
          🔍 Arbitragem Manual
        </button>
        <button onClick={handleScalping} style={{ flex: 1, background: '#f59e0b', color: '#0f172a', padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          ⚡ Scalping Manual
        </button>
      </div>

      {/* Estatísticas */}
      <div style={{ marginBottom: 16, padding: 12, background: '#1e293b', borderRadius: 12 }}>
        <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 8 }}>📊 Estatísticas de Trading</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 11 }}>
          <div>📝 Total Ordens: <span style={{ color: '#4ade80' }}>{stats.totalOrders}</span></div>
          <div>📈 Compras: <span style={{ color: '#4ade80' }}>{stats.totalBuys}</span></div>
          <div>📉 Vendas: <span style={{ color: '#f97316' }}>{stats.totalSells}</span></div>
          <div>💰 Volume Total: <span style={{ color: '#fbbf24' }}>${stats.totalVolume}</span></div>
        </div>
      </div>

      {/* Últimas ordens */}
      {orders.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>📜 Últimas Negociações:</div>
          <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 10 }}>
            {orders.slice(-5).reverse().map(order => (
              <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #334155' }}>
                <span style={{ color: order.type === 'BUY' ? '#4ade80' : '#f97316' }}>
                  {order.type === 'BUY' ? '📥 COMPRA' : '📤 VENDA'}
                </span>
                <span>{order.fromAgent} → {order.toAgent}</span>
                <span>{order.amount} USDC</span>
                <span style={{ color: '#fbbf24' }}>${(order.amount * order.price).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: '#475569', marginTop: 12, textAlign: 'center' }}>
        💡 Agentes compram e vendem USDC entre si usando nanopagamentos TLAY
      </div>
    </div>
  );
}