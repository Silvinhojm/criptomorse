"use client"

import { useState, useEffect } from "react"
import { quantumWaveTrader } from "@/lib/quantum-wave"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const DIRECTION_COLORS = {
  compra: DS.colors.accent.green,
  venda: DS.colors.accent.red,
}

function getDirection(label: string): "compra" | "venda" {
  return label.includes("→USDC") || label.includes("→USDT") || label.includes("→DAI") ? "venda" : "compra"
}

export default function QuantumWavePanel() {
  const [wave, setWave] = useState(quantumWaveTrader.getLatestWave())

  useEffect(() => {
    const t = setInterval(() => {
      setWave(quantumWaveTrader.getLatestWave())
    }, 3000)
    return () => clearInterval(t)
  }, [])

  if (!wave || wave.pairs.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🌊</span>
          <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Onda Quântica</span>
        </div>
        <div className="text-[11px] py-6 text-center" style={{ color: DS.colors.text.muted }}>
          Nenhuma onda ativa no momento. Inicie o ciclo dos pregueiros.
        </div>
      </div>
    )
  }

  const pairs = wave.pairs.slice(0, 20)
  const maxAmplitude = Math.max(...pairs.map(p => p.amplitude), 1)

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌊</span>
          <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Onda Quântica</span>
        </div>
        {wave.collapsed && wave.collapsedPair && (
          <span className="text-[10px] px-2 py-1 rounded-md font-semibold"
            style={{ background: `${DS.colors.accent.green}15`, color: DS.colors.accent.green }}>
            🎯 {wave.collapsedPair.label}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 justify-center py-3" style={{ minHeight: 120 }}>
        {pairs.map((pair, i) => {
          const dir = getDirection(pair.label)
          const size = 48 + (pair.amplitude / maxAmplitude) * 64
          const isCollapsed = wave.collapsed && wave.collapsedPair?.label === pair.label && wave.collapsedPair?.network === pair.network

          return (
            <div key={`${pair.network}-${pair.label}-${i}`}
              className="flex flex-col items-center transition-all duration-700 cursor-default"
              style={{
                opacity: wave.collapsed && !isCollapsed ? 0.2 : 1,
                transform: isCollapsed ? "scale(1.3)" : "scale(1)",
                filter: wave.collapsed && !isCollapsed ? "blur(1px)" : "none",
              }}>
              <div className="rounded-full flex items-center justify-center font-bold text-[10px] font-mono transition-all duration-1000"
                style={{
                  width: size,
                  height: size,
                  background: `radial-gradient(circle at 30% 30%, ${DIRECTION_COLORS[dir]}33, ${DIRECTION_COLORS[dir]}15)`,
                  border: `2px solid ${DIRECTION_COLORS[dir]}66`,
                  color: DS.colors.text.primary,
                  animation: wave.collapsed && isCollapsed ? "none" : "pulse-dot 3s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                }}>
                <span className="text-center leading-tight">
                  {pair.label.replace("→", "\n→")}
                </span>
              </div>
              <span className="text-[9px] mt-1 font-mono" style={{ color: DIRECTION_COLORS[dir] }}>
                {pair.amplitude.toFixed(2)}
              </span>
              <span className="text-[8px]" style={{ color: DS.colors.text.muted }}>
                {pair.network}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex gap-4 text-[10px] justify-center pt-2 border-t" style={{ borderColor: DS.colors.bg.border, color: DS.colors.text.muted }}>
        <span style={{ color: DS.colors.accent.green }}>🟢 Compra</span>
        <span style={{ color: DS.colors.accent.red }}>🔴 Venda</span>
        <span>🌊 {pairs.length} pares · ${wave.investmentAmount.toFixed(2)}</span>
      </div>
    </div>
  )
}
