"use client"

import { type OpenPosition } from "@/lib/position-manager"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { TrendingUp, Shield } from "lucide-react"

type Props = {
  position: OpenPosition
}

export default function ProfitStaircase({ position }: Props) {
  const profitPct = position.currentProfitPercent ?? 0
  const profitUsd = position.profitUsd ?? ((position.currentPrice - position.entryPrice) * position.amountBought)
  const age = Date.now() - position.entryTimestamp
  const ageSec = Math.round(age / 1000)

  const temStopLoss = profitPct <= -15
  const lucroMinimo = profitUsd >= 0.05
  const tempoMinimo = ageSec >= 60

  return (
    <div className="rounded-lg p-3" style={{ background: DS.colors.bg.hover }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={12} style={{ color: DS.colors.accent.green }} />
          <span className="text-[11px] font-semibold" style={{ color: DS.colors.text.primary }}>
            {position.boughtToken} — {ageSec}s
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px]" style={{ color: DS.colors.text.muted }}>
          <Shield size={10} />
          {profitPct > 0 ? `${profitPct.toFixed(1)}%` : `${profitPct.toFixed(1)}%`}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs" style={{ color: DS.colors.text.secondary }}>
        <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, Math.max(0, (profitPct / 15) * 100))}%`,
              background: profitPct >= 0
                ? `linear-gradient(to right, ${DS.colors.accent.green}, ${DS.colors.accent.green}88)`
                : DS.colors.accent.red,
            }}
          />
        </div>
        <span style={{ color: lucroMinimo ? DS.colors.accent.green : DS.colors.text.muted }}>
          ${profitUsd.toFixed(4)}
        </span>
      </div>

      <div className="flex gap-2 mt-2 text-[9px]">
        <span style={{ color: lucroMinimo ? DS.colors.accent.green : DS.colors.text.muted }}>
          {lucroMinimo ? "✅" : "⏳"} $0.05 lucro
        </span>
        <span style={{ color: tempoMinimo ? DS.colors.accent.green : DS.colors.text.muted }}>
          {tempoMinimo ? "✅" : "⏳"} 1 min
        </span>
      </div>

      {temStopLoss && (
        <div className="flex items-center gap-1 text-[10px] mt-1 p-1.5 rounded"
          style={{ background: `${DS.colors.accent.red}15`, color: DS.colors.accent.red }}>
          <Shield size={10} />
          Stop loss em -15% ativo
        </div>
      )}
    </div>
  )
}
