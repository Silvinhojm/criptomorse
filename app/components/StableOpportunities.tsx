// app/components/StableOpportunities.tsx
// Painel de micro-trades com stablecoins — "grão em grão a galinha enche o papo"
// Mostra top 3 pares stablecoin com maior viabilidade de lucro

"use client"

import { useState, useEffect } from "react"
import { stablePairScanner, type StablePairInfo } from "@/lib/stable-pair-scanner"
import type { PoolInfo } from "@/lib/pool-finder"

export function StableOpportunities() {
  const [pairs, setPairs] = useState<StablePairInfo[]>([])
  const [scanTime, setScanTime] = useState(0)
  const [loading, setLoading] = useState(false)
  const [realPools, setRealPools] = useState<PoolInfo[]>([])
  const [poolLoading, setPoolLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await stablePairScanner.scan()
      setPairs(data.filter(p => p.score >= 10))
      setScanTime(Date.now())
    } catch { /* offline */ }
    setLoading(false)
  }

  const refreshPools = async () => {
    setPoolLoading(true)
    try {
      const res = await fetch('/api/pool-finder?rede=polygon')
      const data = await res.json()
      if (Array.isArray(data)) setRealPools(data.slice(0, 5))
    } catch { /* offline */ }
    setPoolLoading(false)
  }

  useEffect(() => {
    refresh()
    refreshPools()
    const t = setInterval(refresh, 45_000)
    const tp = setInterval(refreshPools, 5 * 60 * 1000)
    return () => { clearInterval(t); clearInterval(tp) }
  }, [])

  const viavel = (p: StablePairInfo) => p.batchMinimo > 0
  const top = pairs.filter(p => p.recomendacao === 'AGORA' && viavel(p)).slice(0, 3)
  const monitor = pairs.filter(p => p.recomendacao === 'MONITORAR' && viavel(p)).slice(0, 2)

  if (pairs.length === 0) return null

  const scoreColor = (s: number) => s >= 60 ? "#22c55e" : s >= 30 ? "#fbbf24" : "#6b7280"
  const pairEmoji = (p: StablePairInfo) => p.fromToken === 'EURC' || p.toToken === 'EURC' ? '💶' : '💵'
  const shortPair = (p: StablePairInfo) => `${p.network.slice(0, 3)}:${p.fromToken}/${p.toToken}`

  return (
    <div style={{
      background: "rgba(20,83,45,0.15)",
      border: "1px solid rgba(34,197,94,0.2)",
      borderRadius: 10,
      padding: "8px 10px",
      fontSize: 11,
      fontFamily: "monospace",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "#4ade80", fontWeight: "bold" }}>
          🌾 Stable Micro-Trades
          <span style={{ fontSize: 9, color: "#6b7280", marginLeft: 8 }}>
            {loading ? "⏳" : `${pairs.length} pares · ${top.length} ativos`}
          </span>
        </div>
        <button onClick={refresh} style={{
          background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 10,
        }} disabled={loading}>
          🔄 {(Date.now() - scanTime) < 60000 ? 'agora' : `${Math.floor((Date.now() - scanTime)/60000)}m`}
        </button>
      </div>

      {/* Top Oportunidades */}
      {top.map((p, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "3px 0", borderBottom: i < top.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
        }}>
          <span style={{ color: "#e2e8f0", flex: 1 }}>
            {pairEmoji(p)} {shortPair(p)}
          </span>
          <span style={{ color: scoreColor(p.score), fontWeight: "bold", marginRight: 8, minWidth: 30, textAlign: "right" }}>
            {p.score}/100
          </span>
          <span style={{ color: "#4ade80", minWidth: 55, textAlign: "right" }}>
            +${p.lucroPorBatch.toFixed(3)}
          </span>
          <span style={{ color: "#6b7280", marginLeft: 6, minWidth: 45, textAlign: "right", fontSize: 9 }}>
            batch ${p.batchMinimo}
          </span>
        </div>
      ))}

      {/* Monitorando */}
      {monitor.length > 0 && top.length === 0 && (
        <div style={{ marginTop: 4, color: "#fbbf24", fontSize: 10 }}>
          ⏳ Aguardando micro-movimento...
        </div>
      )}
      {monitor.filter(m => !top.find(t => t.pair === m.pair)).slice(0, 2).map((p, i) => (
        <div key={`m${i}`} style={{
          display: "flex", justifyContent: "space-between", padding: "2px 0", opacity: 0.6, fontSize: 10,
        }}>
          <span style={{ color: "#94a3b8" }}>{pairEmoji(p)} {shortPair(p)}</span>
          <span style={{ color: "#fbbf24" }}>{p.score}/100</span>
          <span style={{ color: "#6b7280" }}>batch ${p.batchMinimo}</span>
        </div>
      ))}

      {/* Nenhuma oportunidade */}
      {top.length === 0 && monitor.length === 0 && (
        <div style={{ color: "#6b7280", fontSize: 10, textAlign: "center", padding: "8px 0" }}>
          Nenhum par stablecoin viável agora — mercado flat
        </div>
      )}

      {/* Pools Reais (DexScreener) */}
      {realPools.length > 0 && (
        <>
          <div style={{
            marginTop: 8, marginBottom: 4, fontSize: 10, color: "#818cf8", fontWeight: "bold",
            borderTop: "1px solid rgba(129,140,248,0.15)", paddingTop: 6,
          }}>
            🔍 Pools Reais · {poolLoading ? '⏳' : `${realPools.length} ativas`}
          </div>
          {realPools.map((p, i) => (
            <div key={`pool${i}`} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "2px 0", fontSize: 10,
              borderBottom: i < realPools.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}>
              <span style={{ color: "#c7d2fe", flex: 1 }}>
                {p.dex?.slice(0, 6)}: {p.label}
              </span>
              <span style={{ color: "#a5b4fc", minWidth: 50, textAlign: "right" }}>
                ${(p.tvlUSD / 1e6).toFixed(1)}M
              </span>
              <span style={{ color: p.score >= 60 ? "#4ade80" : "#fbbf24", minWidth: 30, textAlign: "right", fontWeight: "bold" }}>
                {p.score}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Métricas */}
      {pairs.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 9, color: "#6b7280", display: "flex", gap: 12 }}>
          <span>📊 {pairs.length} pares</span>
          <span>🎯 {top.length} prontos</span>
          <span>⏳ {monitor.length} monitorando</span>
          <span>{pairs.filter(p => p.arbitragemCrossChain).length} arb</span>
        </div>
      )}
    </div>
  )
}
