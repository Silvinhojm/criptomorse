"use client";
import { useState, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import { tradingNanopaymentSystem } from "@/lib/trading-nanopayments";
import { nanopaymentSystem } from "@/lib/nanopayment-system";
import { realSwap, NETWORKS } from "@/lib/real-swap-executor";

export function TradingNanopaymentDashboard({ network, privateKey }: { network?: any; privateKey?: string }) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState(tradingNanopaymentSystem.getTradingStats());
  const [orders, setOrders] = useState(tradingNanopaymentSystem.getOrderHistory());
  const [wallets, setWallets] = useState(nanopaymentSystem.getAllWallets());
  const [currentPrice, setCurrentPrice] = useState(tradingNanopaymentSystem.getCurrentPrice());
  const [realBalances, setRealBalances] = useState({ usdc: 0, eurc: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [realMode, setRealMode] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  const isMainnet = network && !network.isTestnet;
  const networkKey: keyof typeof NETWORKS = 
    network?.id === "base" ? "base" : 
    network?.id === "polygon" ? "polygon" : "arc";

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-29), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  // Inicializar realSwap quando tem privateKey
  useEffect(() => {
    if (privateKey && privateKey.length > 10) {
      realSwap.initialize(privateKey, networkKey).then(ok => {
        if (ok) {
          setRealMode(true);
          addLog(`✅ Conectado à ${network?.name || "Arc"} — modo ${isMainnet ? "REAL" : "TESTNET"}`);
          refreshRealBalances();
        }
      });
    }
  }, [privateKey, networkKey]);

  const refreshRealBalances = async () => {
    const usdc = await realSwap.getBalance("USDC");
    const eurc = await realSwap.getBalance("EURC");
    setRealBalances({ usdc, eurc });
  };

  const refreshData = () => {
    setStats(tradingNanopaymentSystem.getTradingStats());
    setOrders(tradingNanopaymentSystem.getOrderHistory());
    setWallets(nanopaymentSystem.getAllWallets());
    setCurrentPrice(tradingNanopaymentSystem.getCurrentPrice());
    refreshRealBalances();
  };

  // Executar trade REAL via LI.FI
  const executeRealTrade = async (action: "BUY" | "SELL", amount: number) => {
    addLog(`🚀 Executando ${action} real de $${amount}...`);
    const result = await realSwap.executeSwap(action, amount, addLog);
    if (result.success && result.confirmed) {
      addLog(`✅ ${action} confirmado! TX: ${result.txHash.slice(0, 10)}...`);
      addLog(`🔗 ${result.explorerUrl}`);
      toast.success(`✅ ${action} $${amount} confirmado on-chain!`);
      await refreshRealBalances();
      return true;
    } else {
      addLog(`❌ ${action} falhou: ${result.message}`);
      return false;
    }
  };

  const startAutomatedTrading = () => {
    if (isRunning) return;
    setIsRunning(true);
    const mode = realMode && isMainnet ? "REAL ON-CHAIN" : "simulado";
    toast.success(`🤖 Trading ${mode} iniciado!`);
    addLog(`🤖 Trading ${mode} iniciado — ${network?.name}`);

    intervalRef.current = setInterval(async () => {
      try {
        if (realMode && isMainnet) {
          // Modo REAL — executa swap via LI.FI
          const price = tradingNanopaymentSystem.getCurrentPrice();
          const spread = Math.abs(price.usdc - price.eurc) / price.usdc * 100;
          addLog(`📊 Spread: ${spread.toFixed(3)}% | USDC: $${price.usdc.toFixed(4)} | EURC: $${price.eurc.toFixed(4)}`);
          
          if (spread > 0.4 && realBalances.usdc > 5) {
            await executeRealTrade("BUY", 5);
          } else if (realBalances.eurc > 4.5 && price.eurc > 1.001) {
            await executeRealTrade("SELL", 5);
          } else {
            addLog(`⏸️ HOLD — spread ${spread.toFixed(3)}% ou saldo insuficiente`);
          }
        } else {
          // Modo simulado
          await tradingNanopaymentSystem.executeAutomatedTrading();
        }
        refreshData();
      } catch (error: any) {
        addLog(`❌ Erro: ${error?.message || "desconhecido"}`);
      }
    }, 20000);
  };

  const stopAutomatedTrading = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    addLog("⏹️ Trading parado");
    toast.success("⏹️ Trading parado");
  };

  const handleAddCredits = (agentName: string) => {
    nanopaymentSystem.addCredits(agentName, 50);
    refreshData();
    toast.success(`💰 $50 adicionado para ${agentName}`);
  };

  const handleArbitrage = async () => {
    toast.loading("Procurando arbitragem...", { id: "arb" });
    try {
      if (realMode && isMainnet) {
        addLog("🔍 Arbitragem REAL iniciada...");
        const price = tradingNanopaymentSystem.getCurrentPrice();
        if (price.eurc > price.usdc * 1.004) {
          await executeRealTrade("BUY", 5);
          toast.success("💰 Arbitragem REAL executada!", { id: "arb" });
        } else {
          toast.success("Sem oportunidade agora", { id: "arb" });
        }
      } else {
        const result = await tradingNanopaymentSystem.arbitrageOpportunity("ArbitrageHunter");
        result ? toast.success("💰 Arbitragem simulada!", { id: "arb" }) : toast.error("Sem oportunidade", { id: "arb" });
      }
    } catch {
      toast.error("Erro na arbitragem", { id: "arb" });
    }
    refreshData();
  };

  const handleScalping = async () => {
    toast.loading("Executando scalping...", { id: "scalp" });
    try {
      if (realMode && isMainnet) {
        addLog("⚡ Scalping REAL iniciado...");
        await executeRealTrade("BUY", 3);
        toast.success("⚡ Scalping REAL executado!", { id: "scalp" });
      } else {
        const result = await tradingNanopaymentSystem.scalpingStrategy("ScalpingBot");
        result ? toast.success("⚡ Scalping executado!", { id: "scalp" }) : toast.success("Sem oportunidade", { id: "scalp" });
      }
    } catch {
      toast.error("Erro no scalping", { id: "scalp" });
    }
    refreshData();
  };

  useEffect(() => {
    const id = setInterval(refreshData, 5000);
    return () => {
      clearInterval(id);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const price = currentPrice;

  return (
    <div style={{ marginTop: 16, padding: 16, background: "#0f172a", borderRadius: 16, border: `1px solid ${isMainnet ? "#ef4444" : "#3b82f6"}` }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>🤖💰</span>
        <div>
          <div style={{ fontWeight: 700, color: isMainnet ? "#ef4444" : "#3b82f6", fontSize: 13 }}>
            Trading com Nanopagamentos
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>{network?.name || "Arc Testnet"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {isRunning && <span style={{ fontSize: 9, background: "#22c55e", color: "#000", padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>LIVE</span>}
          {realMode && <span style={{ fontSize: 9, background: isMainnet ? "#ef4444" : "#1e40af", color: "#fff", padding: "2px 8px", borderRadius: 99 }}>{isMainnet ? "💰 REAL" : "🧪 TESTNET"}</span>}
        </div>
      </div>

      {/* Saldos reais */}
      {realMode && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div style={{ background: "#0a0f1e", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>USDC</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#4ade80" }}>${price.usdc.toFixed(4)}</div>
          </div>
          <div style={{ background: "#0a0f1e", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>EURC</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#60a5fa" }}>${price.eurc.toFixed(4)}</div>
          </div>
          <div style={{ background: "#0a0f1e", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>SPREAD</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fbbf24" }}>
              {(Math.abs(price.usdc - price.eurc) / price.usdc * 100).toFixed(3)}%
            </div>
          </div>
        </div>
      )}

      {/* Saldos carteira */}
      {realMode && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div style={{ background: "#0a0f1e", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>USDC Carteira</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#4ade80" }}>${realBalances.usdc.toFixed(2)}</div>
          </div>
          <div style={{ background: "#0a0f1e", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 9, color: "#64748b" }}>EURC Carteira</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>€{realBalances.eurc.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Saldo dos agentes traders */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>💰 Saldo dos Agentes Traders:</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {wallets.filter(w => ["QuantumTrader","ArbitrageHunter","ScalpingBot","MarketMaker"].includes(w.agentId)).map(w => (
            <div key={w.agentId} style={{ background: "#0a0f1e", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{w.agentId}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: w.balance > 100 ? "#4ade80" : w.balance < 80 ? "#f87171" : "#fbbf24" }}>
                ${w.balance.toFixed(2)}
              </div>
              <button onClick={() => handleAddCredits(w.agentId)} style={{ fontSize: 9, background: "#1e3a5f", color: "#60a5fa", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", marginTop: 4 }}>
                +$50
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Botões */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {!isRunning ? (
          <button onClick={startAutomatedTrading} style={{ flex: 2, background: isMainnet ? "#ef4444" : "#10b981", color: "#fff", border: "none", borderRadius: 10, padding: 10, fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
            ⏹️ {isMainnet ? "🔴 Iniciar Trading REAL" : "🤖 Iniciar Trading"}
          </button>
        ) : (
          <button onClick={stopAutomatedTrading} style={{ flex: 2, background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: 10, fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
            ⏹️ Parar Trading
          </button>
        )}
        <button onClick={handleArbitrage} style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: 10, fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
          🔍 {isMainnet ? "Arb Real" : "Arbitragem"}
        </button>
        <button onClick={handleScalping} style={{ flex: 1, background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 10, padding: 10, fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
          ⚡ {isMainnet ? "Scalp Real" : "Scalping"}
        </button>
      </div>

      {/* Estatísticas */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>📊 Estatísticas</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[
            { label: "Ordens", value: stats.totalOrders },
            { label: "Compras", value: stats.buyOrders },
            { label: "Vendas", value: stats.sellOrders },
            { label: "Volume", value: `$${stats.totalVolume.toFixed(2)}` },
          ].map(s => (
            <div key={s.label} style={{ background: "#0a0f1e", borderRadius: 6, padding: 6, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#475569" }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Últimas negociações */}
      {orders.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>📜 Últimas Negociações:</div>
          <div style={{ maxHeight: 120, overflowY: "auto" }}>
            {orders.slice(-5).reverse().map((o: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #0f172a", fontSize: 10 }}>
                <span style={{ color: o.type === "BUY" ? "#4ade80" : "#f87171" }}>
                  {o.type === "BUY" ? "📥 COMPRA" : "📤 VENDA"}
                </span>
                <span style={{ color: "#94a3b8" }}>{o.fromAgent} → {o.toAgent}</span>
                <span style={{ color: "#fbbf24" }}>{o.amount} USDC</span>
                <span style={{ color: "#4ade80" }}>${o.price?.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log terminal — só em modo real */}
      {realMode && (
        <div>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>📡 LOG REAL</div>
          <div ref={logsRef} style={{ background: "#020617", borderRadius: 8, padding: 10, maxHeight: 120, overflowY: "auto", fontFamily: "monospace", fontSize: 10, color: "#4ade80", lineHeight: 1.6 }}>
            {logs.length === 0 ? <span style={{ color: "#334155" }}>Aguardando...</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: "#1e3a5f", textAlign: "center", marginTop: 10 }}>
        💡 Agentes compram e vendem USDC entre si usando nanopagamentos TLAY
      </div>
    </div>
  );
}
