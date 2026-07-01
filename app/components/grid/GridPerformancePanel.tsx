"use client"

import { useState, useEffect, useCallback } from "react"
import { gridTrader, type GridTradeRecord } from "@/lib/grid-trading"
import type { NetworkKey } from "@/lib/real-swap-executor"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

type Props = {
  currentNetworkKey?: NetworkKey
}

export default function GridPerformancePanel({ currentNetworkKey }: Props) {
  const [perf, setPerf] = useState(gridTrader.getPerformance())
  const [history, setHistory] = useState<GridTradeRecord[]>([])
  const [showDetail, setShowDetail] = useState(false)

  const refresh = useCallback(() => {
    setPerf(gridTrader.getPerformance())
    setHistory(gridTrader.getTradeHistory(10))
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [refresh])

  const netColor = perf.netProfit >= 0 ? DS.colors.accent.green : DS.colors.accent.red

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: DS.colors.text.primary }}>
          📐 Grid Adaptativo
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: DS.colors.accent.green }}>
          🟢 {perf.totalTrades} trades
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: DS.colors.accent.blue }}>
            {perf.totalTrades}
          </div>
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Trades</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: DS.colors.accent.green }}>
            ${perf.grossProfit.toFixed(4)}
          </div>
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Bruto</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: DS.colors.text.secondary }}>
            ${perf.gasCost.toFixed(4)}
          </div>
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Custos</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: netColor }}>
            ${perf.netProfit.toFixed(4)}
          </div>
          <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Líquido</div>
        </div>
      </div>

      <div className="flex gap-2 text-[10px] mb-2">
        <span style={{ color: DS.colors.accent.green }}>✅ {perf.wins} acertos</span>
        <span style={{ color: DS.colors.text.muted }}>·</span>
        <span style={{ color: DS.colors.accent.red }}>❌ {perf.losses} erros</span>
        <span style={{ color: DS.colors.text.muted }}>·</span>
        <span style={{ color: DS.colors.text.secondary }}>
          {(perf.totalTrades > 0 ? (perf.netProfit / perf.totalTrades) : 0).toFixed(4)} média
        </span>
      </div>

      {perf.totalTrades > 0 && (
        <div className="w-full h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "rgba(148,163,184,0.15)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${perf.winRate}%`,
              background: `linear-gradient(90deg, ${DS.colors.accent.green}, ${DS.colors.accent.blue})`,
            }}
          />
        </div>
      )}

      <button
        onClick={() => setShowDetail(!showDetail)}
        className="text-[10px] font-medium w-full text-left py-1 rounded px-2"
        style={{ color: DS.colors.text.secondary, background: "rgba(148,163,184,0.05)" }}
      >
        {showDetail ? "▾" : "▸"} Últimos trades
      </button>

      {showDetail && (
        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
          {history.map((t, i) => (
            <div
              key={i}
              className="flex justify-between items-center text-[10px] px-2 py-1 rounded"
              style={{ background: "rgba(148,163,184,0.05)" }}
            >
              <span style={{ color: DS.colors.text.secondary }}>
                {t.direction === "buy" ? "🟢" : "🔴"} {t.token}{" "}
                <span style={{ color: DS.colors.text.muted }}>
                  @ ${t.triggerPrice.toFixed(2)}
                </span>
              </span>
              <span
                className="font-medium"
                style={{ color: t.netProfit >= 0 ? DS.colors.accent.green : DS.colors.accent.red }}
              >
                {t.netProfit >= 0 ? "+" : ""}${t.netProfit.toFixed(4)}
              </span>
            </div>
          ))}
          {history.length === 0 && (
            <div className="text-[10px] text-center py-2" style={{ color: DS.colors.text.muted }}>
              Nenhum trade de grid ainda
            </div>
          )}
        </div>
      )}
    </div>
  )
}
