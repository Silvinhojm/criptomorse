"use client"

import { positionManager, type OpenPosition } from "@/lib/position-manager"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { FRASES } from "@/constants/messages"
import { TrendingUp, Shield } from "lucide-react"

type Props = {
  position: OpenPosition
}

export default function ProfitStaircase({ position }: Props) {
  const profitPct = position.currentProfitPercent ?? 0
  const peakPct = position.peakProfitPercent ?? 0
  const entryToPeak = Math.max(1, Math.ceil(peakPct))
  const currentStep = Math.max(0, Math.min(entryToPeak, Math.floor(Math.max(0, profitPct))))
  const levels = position.staircaseLevel ?? 0

  const steps = Array.from({ length: Math.min(entryToPeak, 8) }, (_, i) => i + 1)
  const hasStopLoss = profitPct <= -15

  return (
    <div className="rounded-lg p-3" style={{ background: DS.colors.bg.hover }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={12} style={{ color: DS.colors.accent.green }} />
          <span className="text-[11px] font-semibold" style={{ color: DS.colors.text.primary }}>
            {FRASES.staircaseAtivo(position.boughtToken, levels)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px]" style={{ color: DS.colors.text.muted }}>
          <Shield size={10} />
          {levels} trava(s)
        </div>
      </div>

      <div className="relative flex items-end gap-1 h-20 mb-1">
        {steps.map((step) => {
          const isLit = step <= currentStep
          const isLastTrail = step === currentStep && step > 0
          return (
            <div key={step} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className={`w-full rounded-t-sm transition-all duration-500 ${isLastTrail ? 'animate-pulse' : ''}`}
                style={{
                  height: `${(step / steps.length) * 100}%`,
                  background: isLit
                    ? `linear-gradient(to top, ${DS.colors.accent.green}, ${DS.colors.accent.green}88)`
                    : DS.colors.bg.border,
                  opacity: isLit ? 1 : 0.4,
                  boxShadow: isLastTrail ? `0 0 8px ${DS.colors.accent.green}44` : undefined,
                }} />
              <span className="text-[8px] mt-0.5" style={{ color: DS.colors.text.muted }}>{step}%</span>
            </div>
          )
        })}
      </div>

      {hasStopLoss && (
        <div className="flex items-center gap-1 text-[10px] mt-1 p-1.5 rounded"
          style={{ background: `${DS.colors.accent.red}15`, color: DS.colors.accent.red }}>
          <Shield size={10} />
          Trava de Segurança acionada — stop loss em -15%
        </div>
      )}
    </div>
  )
}
