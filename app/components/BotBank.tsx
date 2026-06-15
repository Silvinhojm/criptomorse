"use client";
import { useEffect, useState } from "react";

interface TradeEntry {
  id: string;
  action: string;
  fromToken?: string;
  toToken?: string;
  fromAmount: number;
  toAmount: number;
  profit: number;
  txHash: string;
  explorerUrl: string;
  message: string;
  timestamp: number;
  confirmed: boolean;
}

const CARD_BG = "#0a0f1e";
const BORDER = "#1e293b";
const GREEN = "#22c55e";
const RED = "#ef4444";
const TEXT = "#e2e8f0";
const MUTED = "#64748b";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function BotBank() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const POLL_INTERVAL = 5000;

  useEffect(() => {
    let mounted = true;

    async function fetchTrades() {
      try {
        const res = await fetch("/api/trades");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0 && mounted) {
            setTrades(data.reverse());
            setLoading(false);
            return;
          }
        }
      } catch { /* fallback */ }

      try {
        const local = localStorage.getItem("arcflow_trade_history");
        if (local && mounted) {
          const data = JSON.parse(local);
          if (Array.isArray(data)) {
            setTrades(data.reverse());
          }
        }
      } catch { /* no data */ }
      if (mounted) setLoading(false);
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, POLL_INTERVAL);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const totalProfit = trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);
  const wins = trades.filter(t => (t.profit ?? 0) > 0).length;
  const losses = trades.filter(t => (t.profit ?? 0) < 0).length;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>🏦</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24", letterSpacing: 1 }}>BOT BANK</div>
          <div style={{ fontSize: 10, color: MUTED }}>Extrato de trades dos robôs</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: totalProfit >= 0 ? GREEN : RED, fontWeight: 700 }}>
            {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(4)}
          </div>
          <div style={{ fontSize: 10, color: MUTED }}>
            {wins}W / {losses}L · {trades.length} trades
          </div>
        </div>
      </div>

      {loading && <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>Carregando extrato...</div>}

      {error && <div style={{ color: RED, fontSize: 12, textAlign: "center", padding: 10 }}>{error}</div>}

      {!loading && trades.length === 0 && (
        <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>
          Nenhum trade encontrado. Os trades aparecerão aqui após a primeira execução.
        </div>
      )}

      {trades.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}`, color: MUTED }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Data</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Par</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Valor</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Recebido</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Lucro</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>TX</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const pair = t.fromToken && t.toToken
                  ? `${t.fromToken}→${t.toToken}`
                  : t.message?.match(/([A-Z]+)→([A-Z]+)/)?.[0] || "-";
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${BORDER}`, opacity: t.confirmed ? 1 : 0.5 }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: MUTED }}>
                      {t.timestamp ? formatTime(t.timestamp) : "-"}
                    </td>
                    <td style={{ padding: "6px 8px", fontWeight: 600, color: TEXT }}>{pair}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: TEXT }}>
                      ${t.fromAmount?.toFixed(2) ?? "-"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: TEXT }}>
                      {t.toAmount ? t.toAmount.toFixed(6) : "-"}
                    </td>
                    <td style={{
                      padding: "6px 8px", textAlign: "right", fontWeight: 700,
                      color: (t.profit ?? 0) > 0 ? GREEN : (t.profit ?? 0) < 0 ? RED : MUTED,
                    }}>
                      {(t.profit ?? 0) !== 0 ? `${(t.profit ?? 0) > 0 ? "+" : ""}$${(t.profit ?? 0).toFixed(4)}` : "-"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      {t.confirmed ? (
                        <span style={{ color: GREEN, fontSize: 10 }}>✅</span>
                      ) : (
                        <span style={{ color: MUTED, fontSize: 10 }}>⏳</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {t.explorerUrl ? (
                        <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#3b82f6", textDecoration: "none", fontSize: 10 }}>
                          {t.txHash?.slice(0, 8)}...
                        </a>
                      ) : (
                        <span style={{ color: MUTED, fontSize: 10 }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {trades.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED }}>
          <span>Total de trades: <strong style={{ color: TEXT }}>{trades.length}</strong></span>
          <span>Confirmados: <strong style={{ color: GREEN }}>{trades.filter(t => t.confirmed).length}</strong></span>
          <span>Lucro líquido: <strong style={{ color: totalProfit >= 0 ? GREEN : RED }}>
            {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(4)}
          </strong></span>
        </div>
      )}
    </div>
  );
}
