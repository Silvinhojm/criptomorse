"use client";
// app/components/TradingNanopaymentDashboard.tsx

import { useState, useEffect, useRef } from "react";
import { tradingNanopaymentSystem, type TradeOrder, type TradingStats } from "@/lib/trading-nanopayments";
import { NETWORKS, TRADING_PAIRS, type NetworkKey } from "@/lib/real-swap-executor";

interface Props { account: string; currentNetwork: { chainId: number; name?: string; shortName?: string; rpc?: string; }; privateKey?: string; }

export function TradingNanopaymentDashboard({ account, currentNetwork, privateKey }: Props) {
  const [isRunning, setIsRunning]       = useState(false);
  const [isIniting, setIsIniting]       = useState(false);
  const [isReady, setIsReady]           = useState(false);
  const [stats, setStats]               = useState<TradingStats | null>(null);
  const [orders, setOrders]             = useState<TradeOrder[]>([]);
  const [balances, setBalances]         = useState<Array<{ symbol: string; balance: number }>>([]);
  const [logs, setLogs]                 = useState<string[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>("auto");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const logsRef     = useRef<HTMLDivElement>(null);

  const CHAIN_MAP: Record<number, import("@/lib/real-swap-executor").NetworkKey> = { 5042002: "arc", 8453: "base", 137: "polygon", 1: "ethereum", 42161: "arbitrum" };
  const networkKey = CHAIN_MAP[currentNetwork.chainId] ?? "arc";
  const net = NETWORKS[networkKey];
  const pairs     = TRADING_PAIRS[networkKey] ?? [];
  const isTestnet = net.isTestnet;

  const addLog = (msg: string) =>
    setLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const refreshData = async () => {
    setStats(tradingNanopaymentSystem.getStats());
    setOrders(tradingNanopaymentSystem.getOrderHistory());
    const bals = await tradingNanopaymentSystem.getRealBalances();
    setBalances(bals.map(b => ({ symbol: b.symbol, balance: b.balance })));
  };

  useEffect(() => {
    setIsReady(false);
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const init = async () => {
      setIsIniting(true);
      addLog(`Inicializando em ${net.name}...`);
      const ok = await tradingNanopaymentSystem.initialize(account, networkKey, privateKey);
      if (ok) {
        setIsReady(true);
        addLog(`Conectado a ${net.name} | ${isTestnet ? "Testnet (faucet)" : "Mainnet (real)"}`);
        await refreshData();
      } else {
        addLog(`Falha ao conectar em ${net.name}`);
      }
      setIsIniting(false);
    };

    if (account) init();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [account, currentNetwork]);

  const handleStart = () => {
    if (!isReady || isRunning) return;
    setIsRunning(true);
    addLog(`Trading automatico iniciado em ${net.name}`);
    intervalRef.current = setInterval(async () => {
      try {
        await tradingNanopaymentSystem.executeAutomatedCycle(addLog);
        await refreshData();
      } catch (err: any) {
        addLog(`Erro no ciclo: ${err?.message}`);
      }
    }, 30000);
  };

  const handleStop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(false);
    addLog("Trading parado");
    refreshData();
  };

  const handleManualTrade = async (agentName: string) => {
    if (!isReady) return;
    addLog(`Trade manual: ${agentName}...`);
    const agent = tradingNanopaymentSystem.getAgents().find(a => a.name === agentName);
    if (!agent) return;
    try {
      await (tradingNanopaymentSystem as any).executeAgentTrade(agent, addLog);
      await refreshData();
    } catch (err: any) {
      addLog(`${agentName}: ${err?.message}`);
    }
  };

  const netColor = isTestnet ? "#3b82f6" : "#ef4444";

  return (
    <div style={{ marginTop: 16, padding: 16, background: "#0a0f1e", border: `1px solid ${netColor}`, borderRadius: 16, fontFamily: "monospace", color: "#e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22 }}>🤖💰</span>
        <div>
          <div style={{ fontWeight: 700, color: netColor, fontSize: 12 }}>TRADING REAL - Multi-Par</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>{net.name} · {isTestnet ? "Testnet" : "Mainnet"} · {account?.slice(0,6)}...{account?.slice(-4)}</div>
        </div>
        {isRunning && <span style={{ marginLeft: "auto", fontSize: 9, background: "#22c55e", color: "#000", padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>LIVE</span>}
      </div>

      {!isTestnet && (
        <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: 8, padding: 8, marginBottom: 14, fontSize: 10, color: "#fca5a5", textAlign: "center" }}>
          DINHEIRO REAL - Trades executam transacoes reais na {net.name}
        </div>
      )}

      {balances.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>SALDO REAL DA CARTEIRA</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {balances.map(b => (
              <div key={b.symbol} style={{ background: "#0f172a", borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: "#64748b" }}>{b.symbol}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#4ade80" }}>{b.balance.toFixed(4)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>PARES DISPONIVEIS ({pairs.length})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button onClick={() => setSelectedPair("auto")} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: selectedPair === "auto" ? netColor : "#1e293b", color: "#fff" }}>
            Auto (melhor)
          </button>
          {pairs.map(p => (
            <button key={p.label} onClick={() => setSelectedPair(p.label)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: selectedPair === p.label ? netColor : "#1e293b", color: "#fff" }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>AGENTES</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tradingNanopaymentSystem.getAgents().map(agent => (
            <div key={agent.name} style={{ background: "#0f172a", borderRadius: 10, padding: "8px 12px", flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "#a78bfa", marginBottom: 2 }}>{agent.name}</div>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 4 }}>{agent.strategy} · max ${agent.maxAmount}</div>
              <button onClick={() => handleManualTrade(agent.name)} disabled={!isReady} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 6, border: "none", cursor: isReady ? "pointer" : "default", background: isReady ? "#7c3aed" : "#1e293b", color: "#fff" }}>
                Trade manual
              </button>
            </div>
          ))}
        </div>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Trades",   value: stats.totalOrders },
            { label: "Volume",   value: `$${stats.totalVolume.toFixed(2)}` },
            { label: "Win Rate", value: `${stats.winRate.toFixed(0)}%` },
            { label: "Lucro",    value: `$${stats.totalProfit.toFixed(4)}` },
          ].map(s => (
            <div key={s.label} style={{ background: "#0f172a", borderRadius: 8, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#475569" }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#4ade80" }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {isIniting ? (
          <div style={{ flex: 1, textAlign: "center", color: "#64748b", fontSize: 12, padding: 12 }}>Conectando...</div>
        ) : !isRunning ? (
          <button onClick={handleStart} disabled={!isReady} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, background: isReady ? (isTestnet ? "#10b981" : "#ef4444") : "#1e293b", color: "#fff", cursor: isReady ? "pointer" : "default" }}>
            Iniciar Trading Automatico
          </button>
        ) : (
          <button onClick={handleStop} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, background: "#ef4444", color: "#fff", cursor: "pointer" }}>
            Parar Trading
          </button>
        )}
      </div>

      {orders.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>HISTORICO</div>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {orders.slice(0, 15).map(o => (
              <div key={o.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid #0f172a", fontSize: 10, alignItems: "center" }}>
                <span style={{ color: o.status === "completed" ? "#4ade80" : "#f87171", minWidth: 80 }}>{o.fromToken}-{o.toToken}</span>
                <span style={{ color: "#94a3b8" }}>{o.agentName}</span>
                <span style={{ color: o.profit >= 0 ? "#4ade80" : "#f87171", marginLeft: "auto" }}>{o.profit >= 0 ? "+" : ""}${o.profit.toFixed(6)}</span>
                {o.txHash && <a href={o.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6" }}>🔗{o.txHash.slice(0,8)}</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={logsRef} style={{ background: "#020617", borderRadius: 8, padding: 10, maxHeight: 130, overflowY: "auto", fontFamily: "monospace", fontSize: 10, color: "#4ade80", lineHeight: 1.6 }}>
        {logs.length === 0 ? <span style={{ color: "#334155" }}>Aguardando...</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <div style={{ fontSize: 9, color: "#1e3a5f", textAlign: "center", marginTop: 12 }}>
        {isTestnet ? "Testnet" : "Mainnet"} | {net.name} | Multi-Par LI.FI
      </div>
    </div>
  );
}



