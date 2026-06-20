"use client"

import { useState, useEffect } from "react"
import { accountant } from "@/lib/accountant"
import { positionManager } from "@/lib/position-manager"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { FRASES } from "@/constants/messages"

function CircularProgress({ pct, size = 40 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(pct, 100) / 100) * circ
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={pct >= 50 ? DS.colors.accent.green : pct >= 25 ? DS.colors.status.medium : DS.colors.accent.red}
        strokeWidth={4} strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fill={DS.colors.text.primary} fontSize={size * 0.28} fontWeight="bold" fontFamily={DS.fonts.mono}>
        {pct.toFixed(0)}%
      </text>
    </svg>
  )
}

function Skeleton() {
  return (
    <div className="animate-pulse flex flex-col gap-2 p-4 rounded-xl" style={{ background: DS.colors.bg.card, minWidth: 160 }}>
      <div className="h-3 w-16 rounded" style={{ background: DS.colors.bg.hover }} />
      <div className="h-7 w-20 rounded" style={{ background: DS.colors.bg.hover }} />
    </div>
  )
}

export default function KpiPanel() {
  const [stats, setStats] = useState(accountant.getStats())
  const [positions, setPositions] = useState(positionManager.getOpenPositions().length)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setInterval(() => {
      setStats(accountant.getStats())
      setPositions(positionManager.getOpenPositions().length)
      setLoading(false)
    }, 3000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        <Skeleton /><Skeleton /><Skeleton /><Skeleton />
      </div>
    )
  }

  const profitColor = stats.totalProfit >= 0 ? DS.colors.accent.green : DS.colors.accent.red
  const isAtivo = positions > 0
  const hasData = stats.completedTrades >= 3

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Card Lucro Total */}
      <MetricCard
        icon={stats.totalProfit >= 0 ? "📈" : "📉"}
        label="Lucro Total"
        value={`$${stats.totalProfit.toFixed(2)}`}
        color={profitColor}
        bgColor={stats.totalProfit >= 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"}
        sublabel="Resultado acumulado"
      />

      {/* Card Win Rate ou Status se <3 trades */}
      {hasData ? (
        <div className="flex items-center gap-3 p-4 rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
          style={{
            background: DS.colors.bg.card,
            border: `1px solid ${DS.colors.bg.border}`,
          }}>
          <CircularProgress pct={stats.winRate} size={48} />
          <div>
            <div className="text-[11px] font-medium" style={{ color: DS.colors.text.muted }}>Win Rate</div>
            <div className="text-lg font-bold font-mono" style={{ color: DS.colors.accent.green, fontFamily: DS.fonts.mono }}>
              {stats.winRate.toFixed(0)}%
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-xl"
          style={{
            background: DS.colors.bg.card,
            border: `1px solid ${DS.colors.bg.border}`,
          }}>
          <div className="p-2 rounded-lg" style={{ background: `${DS.colors.status.medium}15` }}>
            <span className="text-xl">🔬</span>
          </div>
          <div>
            <div className="text-[11px] font-medium" style={{ color: DS.colors.text.muted }}>Status</div>
            <div className="text-sm font-bold" style={{ color: DS.colors.status.medium }}>
              {isAtivo ? "🟢 Ativo" : "🟡 Aguardando"} · {stats.completedTrades} trades
            </div>
          </div>
        </div>
      )}

      {/* Card Trades */}
      <MetricCard
        icon="🔄"
        label="Trades"
        value={`${stats.completedTrades}`}
        color={DS.colors.text.primary}
        sublabel={`${stats.totalTrades} total · ${stats.completedTrades} concluídos`}
      />

      {/* Card Status Robôs */}
      <div className="flex items-center gap-3 p-4 rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
        style={{
          background: isAtivo ? "rgba(34,197,94,0.08)" : DS.colors.bg.card,
          border: `1px solid ${isAtivo ? "rgba(34,197,94,0.2)" : DS.colors.bg.border}`,
        }}>
        <div className="relative">
          <div className="p-2 rounded-lg" style={{ background: `${DS.colors.accent.green}15` }}>
            <span className="text-xl">🤖</span>
          </div>
          <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ${isAtivo ? "animate-pulse" : ""}`}
            style={{
              background: isAtivo ? DS.colors.accent.green : DS.colors.status.medium,
              boxShadow: isAtivo ? `0 0 8px ${DS.colors.accent.green}` : "none",
            }} />
        </div>
        <div>
          <div className="text-[11px] font-medium" style={{ color: DS.colors.text.muted }}>Robôs</div>
          <div className="text-base font-bold" style={{
            color: isAtivo ? DS.colors.accent.green : DS.colors.status.medium,
          }}>
            {isAtivo ? "🟢 Ativos" : "🟡 Aguardando"}
          </div>
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>
            {positions > 0 ? `${positions} posição(ões) aberta(s)` : "Nenhuma posição aberta"}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, color, bgColor, sublabel }: {
  icon: string; label: string; value: string; color: string; bgColor?: string; sublabel?: string
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
      style={{
        background: bgColor ?? DS.colors.bg.card,
        border: `1px solid ${DS.colors.bg.border}`,
      }}>
      <div className="p-2 rounded-lg" style={{ background: `${color}15` }}>
        <span className="text-xl">{icon}</span>
      </div>
      <div>
        <div className="text-[11px] font-medium" style={{ color: DS.colors.text.muted }}>{label}</div>
        <div className="text-lg font-bold font-mono" style={{ color, fontFamily: DS.fonts.mono }}>
          {value}
        </div>
        {sublabel && (
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>{sublabel}</div>
        )}
      </div>
    </div>
  )
}
