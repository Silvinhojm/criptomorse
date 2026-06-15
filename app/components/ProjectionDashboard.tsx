"use client";
import { useEffect, useState } from "react";
import { calculateProjection, type ProjectionResult } from "@/lib/projection-engine";

const CARD_BG = "#0a0f1e";
const BORDER = "#1e293b";
const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const ORANGE = "#f59e0b";
const TEXT = "#e2e8f0";
const MUTED = "#64748b";

export function ProjectionDashboard() {
  const [result, setResult] = useState<ProjectionResult | null>(null);
  const [capital, setCapital] = useState(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/trades');
        const trades: any[] = res.ok ? await res.json() : [];
        const formatted = trades
          .filter((t: any) => t.txHash)
          .map((t: any) => ({
            profit: t.profit ?? 0,
            amount: t.fromAmount ?? 0,
            timestamp: t.timestamp ?? Date.now(),
            status: t.confirmed ? 'completed' : 'pending',
          }));
        setResult(calculateProjection(formatted, capital));
      } catch { /* no data */ }
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [capital]);

  const fmt = (v: number) => v.toFixed(2);
  const fmt4 = (v: number) => v.toFixed(4);
  const pct = (v: number) => v.toFixed(1) + '%';

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>📊</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#a78bfa", letterSpacing: 1 }}>PROJEÇÃO DE GANHOS</div>
          <div style={{ fontSize: 10, color: MUTED }}>Estimativa vs Resultado Real dos Robôs Autônomos</div>
        </div>
        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: MUTED }}>Capital:</span>
          <input type="number" value={capital} onChange={e => setCapital(parseFloat(e.target.value) || 0)}
            style={{ width: 70, padding: "4px 8px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#0a0f1e", color: TEXT, fontSize: 12, textAlign: "right" }} />
        </div>
      </div>

      {loading && <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>Calculando projeções...</div>}

      {result && result.hoursActive > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <Stat label="Horas Ativo" value={fmt(result.hoursActive)} />
            <Stat label="Trades/dia" value={fmt(result.tradesPerDay)} />
            <Stat label="Lucro Médio/Trade" value={`$${fmt4(result.avgProfitPerTrade)}`} color={result.avgProfitPerTrade >= 0 ? GREEN : RED} />
            <Stat label="Win Rate" value={pct(result.winRate)} color={GREEN} />
            <Stat label="APY Projetado" value={pct(result.apyProjected)} color={ORANGE} />
            <Stat label="APY Real" value={pct(result.apyActual)} color={GREEN} />
            <Stat label="Volume Total" value={`$${fmt(result.totalVolume)}`} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}`, color: MUTED }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Período</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Trades Proj.</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Lucro Proj.</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>ROI Proj.</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Trades Real</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Lucro Real</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>ROI Real</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Precisão</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.period} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600, color: TEXT }}>{row.period}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: MUTED }}>{row.projectedTrades}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: ORANGE }}>${fmt(row.projectedProfit)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: ORANGE }}>{pct(row.projectedROI)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: TEXT }}>{row.actualTrades}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: row.actualProfit >= 0 ? GREEN : RED }}>${fmt(row.actualProfit)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: row.actualROI >= 0 ? GREEN : RED }}>{pct(row.actualROI)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: row.accuracy > 80 ? GREEN : row.accuracy > 50 ? ORANGE : RED }}>
                      {pct(row.accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: MUTED }}>
            <span>Primeiro trade: <strong style={{ color: TEXT }}>{result.firstTradeDate}</strong></span>
            <span>Lucro projetado (1 ano): <strong style={{ color: ORANGE }}>${fmt(result.totalProjectedProfit)}</strong></span>
            <span>Lucro real: <strong style={{ color: result.totalActualProfit >= 0 ? GREEN : RED }}>${fmt(result.totalActualProfit)}</strong></span>
          </div>

          <div style={{ marginTop: 12, padding: 12, background: "rgba(167,139,250,0.1)", borderRadius: 8, border: `1px solid rgba(167,139,250,0.3)`, fontSize: 11, color: "#c4b5fd" }}>
            <strong>🤖 Vantagens dos Robôs Autônomos:</strong>
            <ul style={{ margin: "6px 0 0 0", paddingLeft: 16 }}>
              <li>Trading 24/7 sem intervenção humana — oportunidade contínua de lucro</li>
              <li>5 agentes votam por consenso (maioria de 3), cada um com estratégia especializada</li>
              <li>Peso adaptativo: agentes vencedores ganham mais influência nas decisões futuras</li>
              <li>Análise de mercado em tempo real: Fear & Greed, notícias, volume global</li>
              <li>Projeção conservadora: usa win rate como fator de desconto para estimativas realistas</li>
            </ul>
          </div>
        </>
      )}

      {!loading && result && result.hoursActive === 0 && (
        <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 20 }}>
          Nenhum trade concluído ainda. Os dados aparecerão após o primeiro ciclo de trading.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 100, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color ?? TEXT }}>{value}</div>
    </div>
  );
}
