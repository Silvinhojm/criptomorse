"use client"

import { useState, useEffect } from "react"
import { timingOptimizer } from "@/lib/timing-optimizer"

const CARD_BG = "#0a0f1e"
const BORDER = "#1e293b"
const TEXT = "#e2e8f0"
const MUTED = "#64748b"
const GREEN = "#22c55e"
const RED = "#ef4444"
const YELLOW = "#eab308"
const BLUE = "#3b82f6"

function formatHour(h: number): string {
  if (h < 0) return "—"
  return `${h.toString().padStart(2, "0")}:00`
}

function multiplierColor(m: number): string {
  if (m >= 1.0) return GREEN
  if (m >= 0.7) return YELLOW
  return RED
}

function winRateColor(wr: number): string {
  if (wr >= 60) return GREEN
  if (wr >= 40) return YELLOW
  return RED
}

function barColor(wr: number): string {
  if (wr >= 70) return GREEN
  if (wr >= 50) return BLUE
  if (wr >= 30) return YELLOW
  return RED
}

export default function TimingOptimizerStatus() {
  const [stats, setStats] = useState<ReturnType<typeof timingOptimizer.getStats> | null>(null)
  const [recs, setRecs] = useState<ReturnType<typeof timingOptimizer.getCurrentHourRecommendations> | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    function refresh() {
      setStats(timingOptimizer.getStats())
      setRecs(timingOptimizer.getCurrentHourRecommendations())
    }
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>⏰</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#a78bfa", letterSpacing: 1 }}>TIMING OPTIMIZER</div>
          <div style={{ fontSize: 10, color: MUTED }}>
            {stats
              ? `${stats.agentesComDados} agente(s) com dados • ${stats.totalSamples} amostras • hora atual ${formatHour(stats.horaAtual)}`
              : "Coletando dados de horários..."}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, borderRadius: 8,
            padding: "4px 10px", color: MUTED, fontSize: 11, cursor: "pointer",
          }}
        >
          {expanded ? "▲ Resumir" : "▼ Detalhes"}
        </button>
      </div>

      {recs && recs.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: expanded ? 12 : 0 }}>
          {recs.slice(0, expanded ? recs.length : 5).map(r => (
            <div
              key={r.agentName}
              style={{
                flex: "1 0 160px", padding: "8px 12px", borderRadius: 8,
                background: r.samples >= 3
                  ? `rgba(${r.confidenceMultiplier >= 1.0 ? "34,197,94" : "239,68,68"},0.08)`
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${
                  r.samples >= 3
                    ? multiplierColor(r.confidenceMultiplier)
                    : BORDER
                }`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: TEXT }}>{r.agentName}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: multiplierColor(r.confidenceMultiplier),
                  background: `rgba(${r.confidenceMultiplier >= 1.0 ? "34,197,94" : "239,68,68"},0.15)`,
                  padding: "1px 6px", borderRadius: 4,
                }}>
                  {r.confidenceMultiplier.toFixed(2)}x
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: MUTED }}>
                <span>{formatHour(r.currentHour)}: <span style={{ color: winRateColor(r.currentHourWinRate) }}>{r.currentHourWinRate.toFixed(0)}%</span></span>
                <span>{r.samples} amostras</span>
              </div>
              {expanded && (
                <div style={{ marginTop: 6, fontSize: 9, color: MUTED }}>
                  <div>Melhor hora: <span style={{ color: GREEN }}>{formatHour(r.bestHour)} ({r.bestWinRate.toFixed(0)}%)</span></div>
                  <div>Pior hora: <span style={{ color: RED }}>{formatHour(r.worstHour)} ({r.worstWinRate.toFixed(0)}%)</span></div>
                  <div>Score: <span style={{ color: r.timingScore >= 0 ? GREEN : RED }}>{r.timingScore > 0 ? "+" : ""}{r.timingScore}</span></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && stats && stats.agentes.map(a => {
        const profile = timingOptimizer.getProfile(a.nome)
        if (!profile) return null
        return (
          <div key={a.nome} style={{
            marginTop: 8, padding: "8px 12px", borderRadius: 8,
            background: "rgba(255,255,255,0.02)", border: `1px solid ${BORDER}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: TEXT }}>{a.nome}</span>
              <span style={{ fontSize: 10, color: MUTED }}>{a.totalSamples} amostras</span>
            </div>
            <div style={{ display: "flex", gap: 2, height: 16, alignItems: "flex-end" }}>
              {Array.from({ length: 24 }, (_, h) => {
                const stats = profile.hourly[h]
                const samples = stats?.samples ?? 0
                if (samples === 0) {
                  return <div key={h} style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2 }} title={`${formatHour(h)}: sem dados`} />
                }
                const wr = stats.winRate
                const height = Math.max(4, (wr / 100) * 14)
                const isNow = h === new Date().getHours()
                return (
                  <div key={h} style={{
                    flex: 1, height, background: barColor(wr), borderRadius: 2,
                    opacity: isNow ? 1 : 0.6,
                    border: isNow ? "1px solid white" : "none",
                  }} title={`${formatHour(h)}: ${wr.toFixed(0)}% win (${samples} amostras)`} />
                )
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: MUTED }}>
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </div>
        )
      })}

      {(!recs || recs.length === 0) && (
        <div style={{ color: MUTED, fontSize: 12, textAlign: "center", padding: 16 }}>
          Nenhum dado de timing coletado ainda. Os perfis aparecerão conforme os palpites forem avaliados.
        </div>
      )}
    </div>
  )
}
