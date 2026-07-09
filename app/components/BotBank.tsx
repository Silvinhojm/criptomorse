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
  txHash?: string;
  explorerUrl?: string;
  message: string;
  timestamp: number;
  localRecorded?: boolean;
  displayStatus?: "accountant-local" | "legacy-local" | "tx-linked";
  networkKey?: string;
}

const CARD_BG = "#0a0f1e";
const BORDER = "#1e293b";
const GREEN = "#22c55e";
const RED = "#ef4444";
const TEXT = "#e2e8f0";
const MUTED = "#64748b";
const YELLOW = "#fbbf24";

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
      let found: TradeEntry[] = [];

      // Local/legacy accountant records. Not reconciled settlement evidence.
      try {
        const raw = localStorage.getItem("arcflow_accountant_reports");
        if (raw) {
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.length > 0) {
            found = data.map((r: any) => ({
              id: r.id || `${r.agentName}-${r.timestamp}`,
              action: r.action,
              fromToken: r.fromToken,
              toToken: r.toToken,
              fromAmount: r.amount,
              toAmount: r.toAmount,
              profit: r.profit,
              message: `${r.agentName} ${r.action} ${r.fromToken}->${r.toToken}`,
              timestamp: r.timestamp,
              localRecorded: true,
              displayStatus: "accountant-local",
            }));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "");
      }

      // Legacy real-automated-trader history. Kept for auditability only.
      if (found.length === 0) {
        try {
          const local = localStorage.getItem("arcflow_trade_history");
          if (local) {
            const data = JSON.parse(local);
            if (Array.isArray(data) && data.length > 0) {
              found = data.map((t: any) => ({
                ...t,
                localRecorded: true,
                displayStatus: t.txHash && t.explorerUrl ? "tx-linked" : "legacy-local",
              }));
            }
          }
        } catch { /* no data */ }
      }

      if (mounted) {
        found.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const seen = new Set<string>();
        found = found.filter(t => {
          const k = t.id || `${(t as any).agentName}-${t.timestamp}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setTrades(found);
        setLoading(false);
      }
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
        <span style={{ fontSize: 24 }}>Bank</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: YELLOW, letterSpacing: 1 }}>Legacy BotBank / Local Ledger</div>
          <div style={{ fontSize: 10, color: MUTED }}>Historico local/legado, nao reconciliado</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: totalProfit >= 0 ? GREEN : RED, fontWeight: 700 }}>
            {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(4)}
          </div>
          <div style={{ fontSize: 10, color: MUTED }}>
            Local: {wins}W / {losses}L - {trades.length} registros
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 10, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)", color: YELLOW, fontSize: 11, lineHeight: 1.5 }}>
        Dados locais/legados. Nao representam settlement reconciliado, lucro verificado ou prova on-chain.
      </div>

      {loading && <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>Carregando ledger local...</div>}

      {error && <div style={{ color: RED, fontSize: 12, textAlign: "center", padding: 10 }}>{error}</div>}

      {!loading && trades.length === 0 && (
        <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>
          Nenhum registro local encontrado. O historico local aparecera aqui quando existir dado em localStorage.
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
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Resultado local</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>TX</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const pair = t.fromToken && t.toToken
                  ? `${t.fromToken}->${t.toToken}`
                  : t.message?.match(/([A-Z]+)->([A-Z]+)/)?.[0] || "-";
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
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
                      <span style={{ color: t.displayStatus === "tx-linked" ? "#3b82f6" : MUTED, fontSize: 10 }}>
                        {t.displayStatus === "tx-linked" ? "TX linked" : t.displayStatus === "accountant-local" ? "Local" : "Legacy"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {t.explorerUrl ? (
                        <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#3b82f6", textDecoration: "none", fontSize: 10 }}>
                          {t.txHash?.slice(0, 8)}...
                        </a>
                      ) : (
                        <span style={{ color: MUTED, fontSize: 10 }}>No TX / local only</span>
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
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED, gap: 12, flexWrap: "wrap" }}>
          <span>Total de registros: <strong style={{ color: TEXT }}>{trades.length}</strong></span>
          <span>Marcados localmente: <strong style={{ color: TEXT }}>{trades.filter(t => t.localRecorded).length}</strong></span>
          <span>Resultado local reportado, nao reconciliado: <strong style={{ color: totalProfit >= 0 ? GREEN : RED }}>
            {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(4)}
          </strong></span>
        </div>
      )}
    </div>
  );
}
