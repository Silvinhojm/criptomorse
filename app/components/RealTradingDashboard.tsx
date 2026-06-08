// app/components/RealTradingDashboard.tsx
"use client";

import { useState, useEffect } from "react";
import { toast } from "react-hot-toast";

interface RealTradingDashboardProps {
  account: string;
}

export function RealTradingDashboard({ account }: RealTradingDashboardProps) {
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [profit, setProfit] = useState(0);
  const [trades, setTrades] = useState(0);

  // Simular carregamento de saldo real
  useEffect(() => {
    if (account) {
      // Em produção, buscar saldo real da blockchain
      const mockBalance = 25.50 + Math.random() * 10;
      setBalance(mockBalance);
    }
  }, [account]);

  const startTrading = () => {
    if (balance < 5) {
      toast.error(`Saldo insuficiente! Você tem $${balance.toFixed(2)} USDC. Adicione fundos no faucet.`);
      return;
    }
    
    setIsRunning(true);
    toast.success(`🤖 Trading REAL iniciado! Saldo: $${balance.toFixed(2)} USDC`);
    
    // Simular trades automáticos
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const tradeProfit = (Math.random() * 0.5).toFixed(4);
        setProfit(prev => prev + parseFloat(tradeProfit));
        setTrades(prev => prev + 1);
        setBalance(prev => prev + parseFloat(tradeProfit));
        toast.success(`💰 Trade executado! Lucro: $${tradeProfit}`, { icon: '💰' });
      }
    }, 15000);
    
    return () => clearInterval(interval);
  };

  const stopTrading = () => {
    setIsRunning(false);
    toast.success("⏹️ Trading REAL parado");
  };

  const addMockFunds = () => {
    const newBalance = balance + 10;
    setBalance(newBalance);
    toast.success(`💰 $10 adicionados à sua carteira! Novo saldo: $${newBalance.toFixed(2)}`);
  };

  return (
    <div style={{ marginTop: 16, padding: 16, background: '#0f172a', borderRadius: 16, border: '2px solid #10b981' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>💰🤖</span>
        <span style={{ fontWeight: 'bold', color: '#10b981' }}>TRADING REAL - Saldo da Carteira</span>
        {isRunning && <span style={{ fontSize: 9, background: '#22c55e', padding: '2px 8px', borderRadius: 10, color: '#fff' }}>ATIVO</span>}
      </div>

      {/* Saldo REAL */}
      <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>SEU SALDO REAL (USDC na Arc Testnet)</div>
        <div style={{ fontSize: 32, fontWeight: 'bold', color: balance > 0 ? '#4ade80' : '#f97316' }}>
          ${balance.toFixed(4)}
        </div>
        {balance < 5 && (
          <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 8 }}>
            ⚠️ Saldo baixo! Consiga USDC grátis no faucet da Arc Testnet
          </div>
        )}
      </div>

      {/* Estatísticas */}
      {trades > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Trades</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fbbf24' }}>{trades}</div>
          </div>
          <div style={{ flex: 1, background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Lucro</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#4ade80' }}>${profit.toFixed(4)}</div>
          </div>
        </div>
      )}

      {/* Botões */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {!isRunning ? (
          <button 
            onClick={startTrading}
            style={{ flex: 2, background: '#10b981', color: '#fff', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            🤖 Iniciar Trading REAL
          </button>
        ) : (
          <button 
            onClick={stopTrading}
            style={{ flex: 2, background: '#ef4444', color: '#fff', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ⏹️ Parar Trading
          </button>
        )}
        <button 
          onClick={addMockFunds}
          style={{ flex: 1, background: '#f59e0b', color: '#0f172a', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          +$10 (Mock)
        </button>
      </div>

      {/* Informação */}
      <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
        💡 Para obter USDC grátis na Arc Testnet, use o faucet oficial:
        <br />
        <a href="https://faucet.arc.network" target="_blank" style={{ color: '#3a6cc8' }}>https://faucet.arc.network</a>
        <br />
        <span style={{ fontSize: 9, color: '#6b7280', marginTop: 4, display: 'block' }}>
          ⚠️ Modo demonstração - Trades são simulados para teste
        </span>
      </div>
    </div>
  );
}