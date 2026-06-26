"use client"

import { useState, useEffect } from "react"
import { positionManager, type OpenPosition } from "@/lib/position-manager"
import ProfitStaircase from "./ProfitStaircase"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { FRASES } from "@/constants/messages"
import { TrendingUp, TrendingDown, Minus, XCircle } from "lucide-react"

export default function ActiveTrades() {
  const [positions, setPositions] = useState<OpenPosition[]>([])

  useEffect(() => {
    const t = setInterval(() => {
      setPositions([...positionManager.getOpenPositions()])
    }, 3000)
    return () => clearInterval(t)
  }, [])

  if (positions.length === 0) {
    return (
      <div className="rounded-xl p-4 flex flex-col items-center gap-2" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <span className="text-2xl mt-2">💤</span>
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Nenhum trade ativo agora</span>
        <span className="text-[10px] text-center leading-relaxed max-w-[200px]" style={{ color: DS.colors.text.muted }}>
          Os robôs estão aguardando uma oportunidade com lucro garantido
        </span>
        <div className="flex gap-2 mt-1 mb-2">
          <span className="text-[9px] px-2 py-1 rounded-full" style={{ background: "rgba(148,163,184,0.1)", color: DS.colors.text.muted }}>
            🟢 Monitorando
          </span>
          <span className="text-[9px] px-2 py-1 rounded-full" style={{ background: "rgba(148,163,184,0.1)", color: DS.colors.text.muted }}>
            💰 Aguardando
          </span>
        </div>
      </div>
    )
  }

  const closePosition = async (id: string) => {
    const pos = positionManager.getPosition(id)
    if (pos) {
      await positionManager.closePosition(id, pos.currentPrice)
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} style={{ color: DS.colors.accent.green }} />
          <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Trades Ativos</span>
        </div>
          <span className="text-[10px]" style={{ color: DS.colors.text.muted }}>{positions.length > 0 ? `📂 ${positions.length} investimento(s) ativo(s)` : ""}</span>
      </div>

      <div className="space-y-3">
        {positions.map((pos) => {
          const profitPct = pos.currentProfitPercent ?? 0
          const profitIcon = profitPct > 0 ? <TrendingUp size={14} style={{ color: DS.colors.accent.green }} /> :
                            profitPct < 0 ? <TrendingDown size={14} style={{ color: DS.colors.accent.red }} /> :
                            <Minus size={14} style={{ color: DS.colors.text.muted }} />
          const isStopped = profitPct <= -15

          return (
            <div key={pos.id} className="rounded-lg overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
              style={{ background: DS.colors.bg.hover, border: `1px solid ${isStopped ? `${DS.colors.accent.red}33` : DS.colors.bg.border}` }}>
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {profitIcon}
                    <span className="text-sm font-semibold font-mono" style={{ color: DS.colors.text.primary }}>
                      {pos.boughtToken}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: `${DS.colors.bg.DEFAULT}88`, color: DS.colors.text.muted }}>
                      {pos.networkKey}
                    </span>
                  </div>
                  <button onClick={() => closePosition(pos.id)}
                    className="p-1 rounded transition-colors hover:bg-white/10"
                    aria-label={`Fechar trade ${pos.boughtToken}`}>
                    <XCircle size={14} style={{ color: DS.colors.text.muted }} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
                  <div>
                    <div style={{ color: DS.colors.text.muted }}>Investido</div>
                    <div className="font-mono font-semibold" style={{ color: DS.colors.text.primary }}>
                      ${pos.amountPaid.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: DS.colors.text.muted }}>Valor</div>
                    <div className="font-mono font-semibold" style={{ color: DS.colors.text.primary }}>
                      ${(pos.amountBought * pos.currentPrice).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: DS.colors.text.muted }}>Resultado</div>
                    <div className="font-mono font-semibold" style={{
                      color: profitPct > 0 ? DS.colors.accent.green : profitPct < 0 ? DS.colors.accent.red : DS.colors.text.secondary,
                    }}>
                      {profitPct > 0 ? "+" : ""}{profitPct.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {pos.amountBought > 0 && <ProfitStaircase position={pos} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
