// app/components/AutomatedTraderDashboard.tsx
"use client";

import { useState, useEffect } from "react";
import { toast } from "react-hot-toast";
import { automatedTrader } from "@/lib/automated-trader";
import { realBalance } from "@/lib/real-balance-integration";

interface AutomatedTraderDashboardProps {
  account: string;
}

export function AutomatedTraderDashboard({ account }: AutomatedTraderDashboardProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState(automatedTrader.getStats());
  const [history, setHistory] = useState(automatedTrader.getHistory());
  const [balance, setBalance] = useState(0);
  const [tradeAmount, setTradeAmount] = useState(5);
  const [intervalSec, setIntervalSec] = useState(30);
  const [isLoading, setIsLoading] = useState(false);

  const refreshData = async () => {
    setStats(automatedTrader.getStats());
    setHistory(automatedTrader.getHistory());
    
    // Tentar buscar saldo real
    if (account) {
      try {
        const bal = await realBalance.getRealUSDCBalance(account);
        setBalance(bal);
        console.log(`💰 Saldo atualizado: $${bal}`);
      } catch (error) {
        console.error("Erro ao buscar saldo:", error);
        setBalance(0);
      }
    }
  };

  // Adicionar saldo manualmente (mock para teste)
  const addMockBalance = () => {
    const newBalance = balance + 10;
    setBalance(newBalance);
    toast.success(`💰 $10 adicionado ao saldo virtual! Novo saldo: $${newBalance.toFixed(2)}`, { icon: '💰' });
  };

  const startTrading = async () => {
    if (balance < tradeAmount) {
      toast.error(`Saldo insuficiente! Você tem $${balance.toFixed(2)}. Necessário: $${tradeAmount}. Clique em "+$10" para adicionar saldo.`);
      return;
    }

    setIsLoading(true);
    try {
      automatedTrader.initialize(account);
      automatedTrader.startAutomatedTrading(intervalSec, tradeAmount);
      setIsRunning(true);
      toast.success(`🤖 Trading automático iniciado! Intervalo: ${intervalSec}s | Trade: $${tradeAmount}`, { icon: '🤖', duration: 5000 });
    } catch (error) {
      toast.error("Erro ao iniciar trading");
    } finally {
      setIsLoading(false);
    }
  };

  const stopTrading = () => {
    automatedTrader.stopAutomatedTrading();
    setIsRunning(false);
    toast.success("⏹️ Trading automático parado");
    refreshData();
  };

  const runManualCycle = async () => {
    if (balance < tradeAmount) {
      toast.error(`Saldo insuficiente! Você tem $${balance.toFixed(2)}. Necessário: $${tradeAmount}`);
      return;
    }

    toast.loading("Consultando agentes e executando trade...", { id: "manual" });
    try {
      automatedTrader.initialize(account);
      const result = await automatedTrader.runTradingCycle(tradeAmount);
      await refreshData();
      
      if (result.success) {
        if (result.profit > 0) {
          toast.success(`✅ Trade finalizado! Lucro: $${result.profit.toFixed(4)}`, { id: "manual", icon: '💰' });
        } else if (result.profit < 0) {
          toast.error(`📉 Trade finalizado! Prejuízo: $${result.profit.toFixed(4)}`, { id: "manual" });
        } else {
          toast.success(`⏸️ HOLD - Nenhum trade executado`, { id: "manual", icon: '⏸️' });
        }
      } else {
        toast.error(result.message, { id: "manual" });
      }
    } catch (error) {
      toast.error("Erro no ciclo manual", { id: "manual" });
    }
  };

  useEffect(() => {
    if (account) {
      refreshData();
    }
    
    const interval = setInterval(refreshData, 5000);
    return () => clearInterval(interval);
  }, [account]);

  return (
    <div style={{ marginTop: 16, padding: 16, background: 'linear-gradient(135deg, #1a1a4e 0%, #0a0a2e 100%)', borderRadius: 16, border: '2px solid #fbbf24' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>🤖💰</span>
        <span style={{ fontWeight: 'bold', color: '#fbbf24', fontSize: 18 }}>AUTOMATED TRADER</span>
        <span style={{ fontSize: 9, background: '#8b5cf6', padding: '2px 8px', borderRadius: 10, color: '#fff' }}>AGENTES + NANOPAGAMENTOS</span>
        {isRunning && <span style={{ fontSize: 9, background: '#22c55e', padding: '2px 8px', borderRadius: 10, color: '#fff' }}>🔴 LIVE</span>}
      </div>

      {/* Saldo e Lucro */}
      <div style={{ background: '#1e293b', padding: 12, borderRadius: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Seu Saldo</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: balance > 0 ? '#4ade80' : '#f97316' }}>
              ${balance.toFixed(4)} USDC
            </div>
            {balance === 0 && (
              <button 
                onClick={addMockBalance}
                style={{ marginTop: 8, background: '#f59e0b', color: '#0f172a', padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}
              >
                +$10 (Adicionar Saldo)
              </button>
            )}
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Lucro Total</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: stats.totalProfit > 0 ? '#4ade80' : '#f97316' }}>
              ${stats.totalProfit}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Win Rate</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fbbf24' }}>{stats.winRate}%</div>
          </div>
        </div>
      </div>

      {/* Configurações */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: '#94a3b8' }}>💵 Valor por Trade ($)</label>
          <input 
            type="number"
            value={tradeAmount}
            onChange={e => setTradeAmount(parseFloat(e.target.value))}
            min={1}
            max={balance || 100}
            step={0.5}
            style={{ width: '100%', padding: 8, borderRadius: 8, background: '#1e293b', color: '#fff', border: '1px solid #334155' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: '#94a3b8' }}>⏱️ Intervalo (segundos)</label>
          <input 
            type="number"
            value={intervalSec}
            onChange={e => setIntervalSec(parseInt(e.target.value))}
            min={10}
            max={300}
            step={5}
            style={{ width: '100%', padding: 8, borderRadius: 8, background: '#1e293b', color: '#fff', border: '1px solid #334155' }}
          />
        </div>
      </div>

      {/* Botões */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {!isRunning ? (
          <button 
            onClick={startTrading} 
            disabled={isLoading || balance < tradeAmount}
            style={{ 
              flex: 2, 
              background: balance >= tradeAmount ? '#10b981' : '#6b7280', 
              color: '#fff', 
              padding: 12, 
              borderRadius: 10, 
              border: 'none', 
              cursor: balance >= tradeAmount ? 'pointer' : 'not-allowed', 
              fontWeight: 'bold' 
            }}
          >
            {isLoading ? "⏳" : "🤖 INICIAR TRADING AUTOMÁTICO"}
          </button>
        ) : (
          <button onClick={stopTrading} style={{ flex: 2, background: '#ef4444', color: '#fff', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            ⏹️ PARAR TRADING
          </button>
        )}
        <button 
          onClick={runManualCycle} 
          disabled={isRunning || balance < tradeAmount}
          style={{ 
            flex: 1, 
            background: balance >= tradeAmount ? '#8b5cf6' : '#6b7280', 
            color: '#fff', 
            padding: 12, 
            borderRadius: 10, 
            border: 'none', 
            cursor: balance >= tradeAmount ? 'pointer' : 'not-allowed', 
            fontWeight: 'bold' 
          }}
        >
          🔄 Ciclo Manual
        </button>
      </div>

      {/* Estatísticas detalhadas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Total Trades</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fbbf24' }}>{stats.totalTrades}</div>
        </div>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Wins / Losses</div>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>
            <span style={{ color: '#4ade80' }}>{stats.wins}</span> / <span style={{ color: '#f97316' }}>{stats.losses}</span>
          </div>
        </div>
        <div style={{ background: '#1e293b', padding: 8, borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Méd. por Trade</div>
          <div style={{ fontSize: 14, fontWeight: 'bold', color: '#a78bfa' }}>${stats.totalTrades > 0 ? (stats.totalProfit / stats.totalTrades).toFixed(2) : '0.00'}</div>
        </div>
      </div>

      {/* Últimos trades */}
      {history.length > 0 && (
        <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 10, marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', marginBottom: 6 }}>📜 Últimos Trades:</div>
          {history.slice(-5).reverse().map((trade, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #334155' }}>
              <span style={{ color: trade.profit > 0 ? '#4ade80' : trade.profit < 0 ? '#f97316' : '#94a3b8' }}>
                {trade.profit > 0 ? '📈 LUCRO' : trade.profit < 0 ? '📉 PREJUÍZO' : '⏸️ HOLD'}
              </span>
              <span>{new Date(trade.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Explicação */}
      <div style={{ fontSize: 9, color: '#475569', textAlign: 'center' }}>
        💡 <strong>Como funciona:</strong> O sistema consulta os 6 agentes (Quantum, Technical, News, Market, Volume)
        <br />cada consulta gera um <strong>nanopagamento TLAY</strong>. Os agentes votam e o trade é executado automaticamente!
        <br />
        {balance === 0 && (
          <span style={{ color: '#fbbf24', display: 'block', marginTop: 4 }}>
            ⚠️ Clique em "+$10 (Adicionar Saldo)" para começar a testar!
          </span>
        )}
      </div>
    </div>
  );
}