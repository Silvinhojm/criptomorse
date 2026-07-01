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

const MEDALHAS = ["🥇", "🥈", "🥉"]

export default function QuantumWavePanel() {
  const [wave, setWave] = useState(quantumWaveTrader.getLatestWave())

  useEffect(() => {
    const t = setInterval(() => {
      setWave(quantumWaveTrader.getLatestWave())
    }, 10000)
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
          Nenhuma oportunidade identificada no momento. Os robôs estão analisando o mercado.
        </div>
      </div>
    )
  }

  // Filtra pares com amplitude > 0, ordena decrescente, pega top 3
  const topPairs = wave.pairs
    .filter(p => p.amplitude > 0)
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, 3)

  // Agrupa por rede
  const testnetPairs = topPairs.filter(p => p.network === "arc")
  const mainnetPairs = topPairs.filter(p => p.network !== "arc")

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌊</span>
          <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Melhores Oportunidades</span>
        </div>
        {wave.collapsed && wave.collapsedPair && (
          <span className="text-[10px] px-2 py-1 rounded-md font-semibold"
            style={{ background: `${DS.colors.accent.green}15`, color: DS.colors.accent.green }}>
            🎯 {wave.collapsedPair.label}
          </span>
        )}
      </div>

      {/* Pairs agrupados por rede */}
      {testnetPairs.length > 0 && (
        <div className="mb-2">
          <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(234,179,8,0.15)", color: "#eab308" }}>
            🧪 Testnet (Arc)
          </span>
        </div>
      )}
      {testnetPairs.map((pair, i) => (
        <PairRow key={`arc-${pair.label}`} pair={pair} medalIndex={i} />
      ))}

      {mainnetPairs.length > 0 && (
        <div className={`${testnetPairs.length > 0 ? "mt-3" : ""} mb-2`}>
          <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
            💰 Mainnet ({mainnetPairs.map(p => p.network).filter((v, i, a) => a.indexOf(v) === i).join(", ")})
          </span>
        </div>
      )}
      {mainnetPairs.map((pair, i) => (
        <PairRow key={`main-${pair.label}`} pair={pair} medalIndex={testnetPairs.length + i} />
      ))}

      <div className="flex gap-4 text-[10px] justify-center pt-2 border-t mt-3"
        style={{ borderColor: DS.colors.bg.border, color: DS.colors.text.muted }}>
        <span style={{ color: DS.colors.accent.green }}>🟢 Compra (stable→volátil)</span>
        <span style={{ color: DS.colors.accent.red }}>🔴 Venda (volátil→stable)</span>
      </div>
    </div>
  )
}

function PairRow({ pair, medalIndex }: { pair: { label: string; amplitude: number; network: string }; medalIndex: number }) {
  const dir = getDirection(pair.label)
  const strengthPct = Math.round(pair.amplitude * 100)
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg mb-1 transition-all hover:-translate-y-0.5"
      style={{ background: "rgba(148,163,184,0.05)", border: `1px solid ${DS.colors.bg.border}` }}>
      <span className="text-sm">{MEDALHAS[medalIndex]}</span>
      <span className="text-xs font-bold flex-1" style={{ color: DS.colors.text.primary }}>
        {pair.label}
      </span>
      <span className="text-[10px] font-mono font-bold" style={{ color: DIRECTION_COLORS[dir] }}>
        {dir === "compra" ? "🟢" : "🔴"} força {strengthPct}%
      </span>
    </div>
  )
}
