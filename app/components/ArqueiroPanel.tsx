"use client"

import { useState, useEffect } from "react"
import { arqueiro } from "@/lib/arqueiro"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const STATE_COLORS: Record<string, string> = {
  OCIOSO: "#64748b",
  TENSIONANDO: "#60a5fa",
  ARMADO: "#a78bfa",
  DISPARO: "#22c55e",
  DESARMADO: "#f59e0b",
}

const STATE_LABELS: Record<string, string> = {
  OCIOSO: "💤",
  TENSIONANDO: "⚡",
  ARMADO: "🎯",
  DISPARO: "🚀",
  DESARMADO: "🔁",
}

export function ArqueiroPanel() {
  const [snapshots, setSnapshots] = useState<{ key: string; state: string; tensionScore: number; atrPercentile?: number; squeezeActive?: boolean }[]>([])
  const [shadow, setShadow] = useState(true)

  useEffect(() => {
    const refresh = () => {
      const all = arqueiro.allSnapshots().map(s => {
        const [pair, net] = s.key.split(":")
        const snap = arqueiro.getSnapshot(pair, net)
        return { ...s, atrPercentile: snap?.atrPercentile, squeezeActive: snap?.squeezeActive }
      })
      setSnapshots(all)
      setShadow(arqueiro.shadowMode)
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [])

  if (snapshots.length === 0) {
    return (
      <div className="rounded-2xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontSize: 16 }}>🏹</span>
          <span className="text-sm font-bold" style={{ color: DS.colors.text.primary }}>Arqueiro</span>
          {shadow && <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "#1e293b", color: "#64748b" }}>SHADOW</span>}
        </div>
        <p className="text-xs" style={{ color: DS.colors.text.muted }}>⏳ Monitorando compressão de volatilidade... (sem dados ainda)</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }}>🏹</span>
          <span className="text-sm font-bold" style={{ color: DS.colors.text.primary }}>Arqueiro</span>
          {shadow && <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "#1e293b", color: "#64748b" }}>SHADOW</span>}
        </div>
        <span className="text-[10px]" style={{ color: DS.colors.text.muted }}>
          {snapshots.length} par(es) monitorado(s)
        </span>
      </div>

      <div className="space-y-1.5">
        {snapshots.map(s => {
          const [pair, net] = s.key.split(":")
          const color = STATE_COLORS[s.state] ?? "#64748b"
          const label = STATE_LABELS[s.state] ?? "?"
          const grad = s.tensionScore > 0 ? `linear-gradient(90deg, ${color}22, transparent)` : "transparent"
          return (
            <div key={s.key} className="flex items-center justify-between py-1.5 px-2 rounded-lg text-xs" style={{ background: grad, borderLeft: `2px solid ${color}` }}>
              <div className="flex items-center gap-2">
                <span>{label}</span>
                <span className="font-bold" style={{ color: DS.colors.text.primary }}>{pair.replace("→", "/")}</span>
                <span className="text-[10px]" style={{ color: DS.colors.text.muted }}>{net}</span>
              </div>
              <div className="flex items-center gap-3">
                <span style={{ color: s.tensionScore >= 50 ? "#22c55e" : s.tensionScore >= 20 ? "#fbbf24" : "#64748b", fontWeight: 600 }}>
                  {s.tensionScore}
                </span>
                {s.atrPercentile !== undefined && (
                  <span className="text-[10px]" style={{ color: s.atrPercentile < 0.6 ? "#60a5fa" : "#64748b" }}>
                    pctl {(s.atrPercentile * 100).toFixed(0)}%
                  </span>
                )}
                {s.squeezeActive !== undefined && (
                  <span style={{ color: s.squeezeActive ? "#fbbf24" : "#64748b", fontSize: 10 }}>
                    {s.squeezeActive ? "◈ squeeze" : "◇"}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>
                  {s.state}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
