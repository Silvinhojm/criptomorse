"use client";
// app/components/RealAutomatedTrader.tsx
// Painel de trading REAL — exibe tx hash clicável, saldos reais e confirmação blockchain

import { useState, useEffect, useRef } from "react";
import { realAutomatedTrader, type TradeRecord, type TraderStats } from "@/lib/real-automated-trader";
import { NETWORKS } from "@/lib/real-swap-executor";
import { ethers } from "ethers";

interface Props {
  account: string;
  currentNetwork: keyof typeof NETWORKS;
}

export function RealAutomatedTrader({ account, currentNetwork }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [stats, setStats] = useState<TraderStats | null>(null);
  const [balances, setBalances] = useState({ usdc: 0, eurc: 0 });
  const [history, setHistory] = useState<TradeRecord[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [tradeAmount, setTradeAmount] = useState(10);
  const [intervalSec, setIntervalSec] = useState(60);
  const logsRef = useRef<HTMLDivElement>(null);

  const net = NETWORKS[currentNetwork];
  const isMainnet = currentNetwork !== "arc";

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const refreshStats = async () => {
    const s = realAutomatedTrader.getStats();
    const b = await realAutomatedTrader.getBalances();
    setStats({ ...s, usdcBalance: b.usdc, eurcBalance: b.eurc });
    setBalances(b);
    setHistory(realAutomatedTrader.getHistory());
  };

  // Inicializar trader com server auto-sign (env) ou MetaMask
  const handleInit = async () => {
    setIsInitializing(true);

    // Verificar se o servidor tem PRIVATE_KEY configurada
    try {
      const signStatus = await fetch("/api/swap/sign").then(r => r.json());
      if (signStatus.autoSignAvailable) {
        addLog("🔑 PRIVATE_KEY detectada no servidor — modo auto-sign (sem MetaMask)");
        realAutomatedTrader.setAutoSignMode(true);
        const ok = await realAutomatedTrader.initialize(account, currentNetwork);
        if (ok) {
          realAutomatedTrader.onLog(addLog);
          realAutomatedTrader.onTrade(() => refreshStats());
          setInitialized(true);
          addLog(`✅ Auto-sign ativo na ${net.name} — wallet: ${account?.slice(0, 6)}...${account?.slice(-4)}`);
          await refreshStats();
        } else {
          addLog("❌ Falha ao conectar — verifique RPC e .env");
        }
        setIsInitializing(false);
        return;
      }
    } catch {
      // servidor sem suporte a auto-sign, fallback para MetaMask
    }

    addLog("🔑 Conectando carteira MetaMask...");
    let externalSigner: ethers.Signer | undefined;
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        externalSigner = await provider.getSigner();
        addLog(`✅ Signer obtido do MetaMask: ${account?.slice(0, 6)}...`);
      }
    } catch {
      addLog("⚠️ MetaMask nao disponivel, modo somente leitura");
    }

    const ok = await realAutomatedTrader.initialize(account, currentNetwork, externalSigner);
    if (ok) {
      realAutomatedTrader.onLog(addLog);
      realAutomatedTrader.onTrade(() => refreshStats());
      setInitialized(true);
      addLog(`✅ Conectado à ${net.name} — wallet: ${account?.slice(0, 6)}...${account?.slice(-4)}`);
      await refreshStats();
    } else {
      addLog("❌ Falha ao conectar — verifique conexao com MetaMask e RPC");
    }
    setIsInitializing(false);
  };

  const handleStart = () => {
    if (!initialized) return;
    realAutomatedTrader.startAutomatedTrading(intervalSec, tradeAmount);
    setIsRunning(true);
    addLog(`🚀 Trading REAL iniciado — $${tradeAmount} a cada ${intervalSec}s`);
  };

  const handleStop = () => {
    realAutomatedTrader.stopAutomatedTrading();
    setIsRunning(false);
    refreshStats();
  };

  const handleManual = async () => {
    if (!initialized) return;
    addLog("🔄 Ciclo manual iniciado...");
    await realAutomatedTrader.runTradingCycle(tradeAmount);
    await refreshStats();
  };

  useEffect(() => {
    setInitialized(false);
    setIsRunning(false);
    setStats(null);
    setBalances({ usdc: 0, eurc: 0 });
    setHistory([]);
    setLogs([]);
  }, [currentNetwork]);

  useEffect(() => {
    const id = setInterval(refreshStats, 8000);
    return () => clearInterval(id);
  }, []);

  // ─── UI ───────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: "#0a0f1e",
      border: `1px solid ${isMainnet ? "#ef4444" : "#3b82f6"}`,
      borderRadius: 16,
      padding: 20,
      fontFamily: "'JetBrains Mono', monospace",
      color: "#e2e8f0",
      marginTop: 16,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 22 }}>🤖</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: isMainnet ? "#ef4444" : "#3b82f6", letterSpacing: 1 }}>
            REAL AUTOMATED TRADER
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            {net.name} · {account?.slice(0, 6)}...{account?.slice(-4)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {isRunning && (
            <span style={{ fontSize: 9, background: "#22c55e", color: "#000", padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>
              🔴 LIVE
            </span>
          )}
          {initialized && (
            <span style={{ fontSize: 9, background: "#1e40af", color: "#fff", padding: "2px 8px", borderRadius: 99 }}>
              ✅ ON-CHAIN
            </span>
          )}
        </div>
      </div>

      {/* Aviso mainnet */}
      {isMainnet && (
        <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: 8, padding: 8, marginBottom: 14, fontSize: 10, color: "#fca5a5", textAlign: "center" }}>
          ⚠️ DINHEIRO REAL — Cada trade executa transação na blockchain. Comece com $5.
        </div>
      )}

      {/* Saldos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#0f172a", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>USDC REAL</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>
            ${balances.usdc.toFixed(2)}
          </div>
        </div>
        <div style={{ background: "#0f172a", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>EURC REAL</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#60a5fa" }}>
            €{balances.eurc.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Trades", value: stats.totalTrades, color: "#fbbf24" },
            { label: "On-chain ✅", value: stats.confirmedTrades, color: "#4ade80" },
            { label: "Win Rate", value: `${stats.winRate}%`, color: "#a78bfa" },
            { label: "Lucro", value: `$${stats.totalProfit}`, color: parseFloat(stats.totalProfit) >= 0 ? "#4ade80" : "#f87171" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#0f172a", borderRadius: 8, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#475569" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Configurações */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>💵 Valor por trade ($)</div>
          <input
            type="number"
            value={tradeAmount}
            onChange={(e) => setTradeAmount(Math.max(1, parseFloat(e.target.value) || 10))}
            min={1}
            max={isMainnet ? 50 : 1000}
            style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>⏱️ Intervalo (segundos)</div>
          <input
            type="number"
            value={intervalSec}
            onChange={(e) => setIntervalSec(Math.max(30, parseInt(e.target.value) || 60))}
            min={30}
            max={600}
            style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13 }}
          />
        </div>
      </div>

      {/* Botões */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {!initialized ? (
          <button
            onClick={handleInit}
            disabled={isInitializing}
            style={{ flex: 1, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
          >
            {isInitializing ? "⏳ Conectando..." : "🔑 CONECTAR CARTEIRA REAL"}
          </button>
        ) : !isRunning ? (
          <>
            <button
              onClick={handleStart}
              style={{ flex: 2, background: isMainnet ? "#ef4444" : "#10b981", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
            >
              🤖 INICIAR TRADING REAL
            </button>
            <button
              onClick={handleManual}
              style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
            >
              🔄 Manual
            </button>
          </>
        ) : (
          <button
            onClick={handleStop}
            style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
          >
            ⏹️ PARAR TRADING
          </button>
        )}
      </div>

      {/* Histórico de trades com tx hash */}
      {history.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>📜 TRADES BLOCKCHAIN</div>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {history.slice(0, 10).map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 0",
                  borderBottom: "1px solid #0f172a",
                  fontSize: 10,
                  gap: 8,
                }}
              >
                <span style={{ color: t.action === "HOLD" ? "#64748b" : (t.profit ?? 0) >= 0 ? "#4ade80" : "#f87171", minWidth: 40 }}>
                  {t.action}
                </span>
                <span style={{ color: "#94a3b8", flex: 1 }}>
                  ${(t.fromAmount ?? 0).toFixed(2)}
                </span>
                <span style={{ color: (t.profit ?? 0) >= 0 ? "#4ade80" : "#f87171", minWidth: 60 }}>
                  {(t.profit ?? 0) >= 0 ? "+" : ""}${(t.profit ?? 0).toFixed(4)}
                </span>
                {t.txHash ? (
                  <a
                    href={t.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#3b82f6", textDecoration: "none", fontFamily: "monospace" }}
                    title="Ver na blockchain"
                  >
                    🔗 {t.txHash.slice(0, 8)}...
                  </a>
                ) : (
                  <span style={{ color: "#475569" }}>sem tx</span>
                )}
                <span style={{ color: "#475569" }}>{t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : "-"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log terminal */}
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>📡 LOG SISTEMA</div>
        <div
          ref={logsRef}
          style={{
            background: "#020617",
            borderRadius: 8,
            padding: 10,
            maxHeight: 140,
            overflowY: "auto",
            fontFamily: "monospace",
            fontSize: 10,
            color: "#4ade80",
            lineHeight: 1.6,
          }}
        >
          {logs.length === 0 ? (
            <span style={{ color: "#334155" }}>Aguardando inicialização...</span>
          ) : (
            logs.map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>
      </div>

      <div style={{ fontSize: 9, color: "#1e3a5f", textAlign: "center", marginTop: 12 }}>
        Cada trade executa transação real · Confirmado via {net.explorer.replace("https://", "")}
      </div>
    </div>
  );
}
