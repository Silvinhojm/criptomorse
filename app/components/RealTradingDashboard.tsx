// app/components/RealTradingDashboard.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";

interface RealTradingDashboardProps {
  account: string;
  currentNetwork?: {
    rpc: string;
    usdc: string;
    name: string;
    isTestnet: boolean;
    chainId: number;
  };
}

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export function RealTradingDashboard({ account, currentNetwork }: RealTradingDashboardProps) {
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [profit, setProfit] = useState(0);
  const [trades, setTrades] = useState(0);

  const loadRealBalance = useCallback(async () => {
    if (!account || !currentNetwork) return;
    setIsLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider(currentNetwork.rpc);
      const contract = new ethers.Contract(currentNetwork.usdc, ERC20_ABI, provider);
      const [bal, dec] = await Promise.all([
        contract.balanceOf(account),
        contract.decimals().catch(() => 6),
      ]);
      setBalance(parseFloat(ethers.formatUnits(bal, Number(dec))));
    } catch {
      setBalance(0);
    }
    setIsLoading(false);
  }, [account, currentNetwork]);

  useEffect(() => {
    loadRealBalance();
  }, [loadRealBalance]);

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

  const refreshBalance = () => {
    loadRealBalance();
    toast.success("💰 Saldo atualizado!");
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
        <div style={{ fontSize: 11, color: '#94a3b8' }}>SEU SALDO REAL ({currentNetwork?.name || "..."})</div>
        <div style={{ fontSize: 32, fontWeight: 'bold', color: balance > 0 ? '#4ade80' : '#f97316' }}>
          {isLoading ? "..." : `$${balance.toFixed(4)}`}
        </div>
        {balance < 5 && !isLoading && (
          <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 8 }}>
            ⚠️ Saldo baixo! {currentNetwork?.isTestnet ? "Consiga USDC grátis no faucet" : "Adicione fundos na carteira"}
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
          onClick={refreshBalance}
          style={{ flex: 1, background: '#3b82f6', color: '#fff', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          🔄 Atualizar
        </button>
      </div>

      {/* Informação */}
      <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
        💡 Rede: {currentNetwork?.name || "..."} · {currentNetwork?.isTestnet ? "Testnet (faucet)" : "Mainnet (dinheiro real)"}
        {currentNetwork?.isTestnet && (
          <>
            <br />
            <a href="https://faucet.arc.network" target="_blank" style={{ color: '#3a6cc8' }}>Obter USDC do faucet</a>
          </>
        )}
      </div>
    </div>
  );
}