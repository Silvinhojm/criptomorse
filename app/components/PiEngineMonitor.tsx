"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { stableMR, type StableMRSnapshot } from "@/lib/stable-mr"
import { WARMUP_SAMPLES } from "@/lib/math/pi-filter"

interface PiEngineMonitorProps {
  logs: string[]
  network: string
}

const ROUTE_PATTERNS = {
  v3: /⚡ Rota ótima via V3/i,
  fallback: /🔄 Rota via Fallback V2/i,
  aborted: /🛑 Abortando/i,
  requote: /requote rejeitado/i,
}

function extractRoute(entry: string) {
  const matchV3 = entry.match(/⚡ Rota ótima via V3\s*\[Fee:\s*([\d.]+)%\]\s*para\s+(\S+→\S+)/)
  if (matchV3) return { type: "v3" as const, fee: parseFloat(matchV3[1]), pair: matchV3[2] }
  const matchV2 = entry.match(/🔄 Rota via Fallback V2\s*\[Fee:\s*([\d.]+)%\]\s*para\s+(\S+→\S+)/)
  if (matchV2) return { type: "fallback" as const, fee: parseFloat(matchV2[1]), pair: matchV2[2] }
  const matchAbort = entry.match(/🛑 Abortando Fallback V2 para\s+(\S+→\S+)\.\s*Lucro esperado\s*\(\$([\d.]+)\)/)
  if (matchAbort) return { type: "aborted" as const, pair: matchAbort[1], loss: parseFloat(matchAbort[2]) }
  const matchRequote = entry.match(/⏳\s*Lucro real\s*\$-?(\d[\d.]*)\s*<\s*mínimo\s*\$-?(\d[\d.]*)/)
  if (matchRequote) return { type: "requote" as const, gap: parseFloat(matchRequote[2]) - parseFloat(matchRequote[1]) }
  return null
}

export function PiEngineMonitor({ logs, network }: PiEngineMonitorProps) {
  const [snapshots, setSnapshots] = useState<StableMRSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    try {
      const snap = stableMR.getSnapshot()
      setSnapshots(snap.filter(s => s.network === network))
      setLoading(false)
    } catch { setLoading(false) }
  }, [network])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  const piRoutes = useMemo(() => {
    return logs
      .filter(l => l.includes("[PREGÃO]") && (l.includes("⚡") || l.includes("🔄") || l.includes("🛑") || l.includes("requote")))
      .map(extractRoute)
      .filter(Boolean)
      .slice(-12)
  }, [logs])

  const activePair = useMemo(() => {
    return snapshots.find(s => s.samples > 0) ?? null
  }, [snapshots])

  const warmupPct = useMemo(() => {
    if (!activePair) return 0
    return Math.min(100, Math.round((activePair.samples / WARMUP_SAMPLES) * 100))
  }, [activePair])

  const warmupLabel = useMemo(() => {
    if (!activePair) return "Sem dados"
    if (activePair.samples >= WARMUP_SAMPLES) return "Operacional"
    return `Amostrando ${activePair.samples}/${WARMUP_SAMPLES}`
  }, [activePair])

  const sigmaColor = useMemo(() => {
    if (!activePair) return "#64748b"
    const abs = Math.abs(activePair.sigma)
    if (abs >= Math.PI / 2) return activePair.sigma < 0 ? "#4ade80" : "#ef4444" // barreira π/2 rompida
    if (abs >= 1.5) return "#60a5fa" // região de entrada
    if (abs >= 1.1) return "#a78bfa" // atenção
    return "#64748b" // ruído
  }, [activePair])

  const sigmaLabel = useMemo(() => {
    if (!activePair) return "—"
    const abs = Math.abs(activePair.sigma)
    if (abs >= Math.PI / 2) return "rompida"
    if (abs >= 1.5) return "entrada"
    if (abs >= 1.1) return "atenção"
    return "ruído"
  }, [activePair])

  return (
    <div style={{ marginBottom: 12, background: "rgba(100,116,139,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(100,116,139,0.12)" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>π</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: "bold" }}>Monitor de Microestrutura Pi-Engine</div>
          <div style={{ fontSize: 9, color: "#64748b" }}>
            {activePair
              ? `${activePair.pair} · ${network}`
              : "Aguardando dados do PoolProfiler..."}
          </div>
        </div>
        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 9999,
          background: warmupPct >= 100 ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
          color: warmupPct >= 100 ? "#4ade80" : "#fbbf24",
        }}>
          {warmupLabel}
        </span>
      </div>

      {/* Grid de indicadores estocásticos */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8, marginBottom: 8,
      }}>
        {/* Warmup bar */}
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>Janela de Warmup</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3, transition: "width 0.5s",
                width: `${warmupPct}%`,
                background: warmupPct >= 100
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : warmupPct >= 50
                    ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                    : "linear-gradient(90deg, #ef4444, #f97316)",
              }} />
            </div>
            <span style={{ fontSize: 10, color: "#e2e8f0", fontWeight: "bold", minWidth: 32, textAlign: "right" }}>
              {activePair ? `${activePair.samples}/${WARMUP_SAMPLES}` : "—"}
            </span>
          </div>
          <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>
            {warmupPct >= 100 ? "EWMA estabilizada" : `Faltam ${WARMUP_SAMPLES - (activePair?.samples ?? 0)} ticks`}
          </div>
        </div>

        {/* Sigma (σ) */}
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>Desvio Padrão (σ)</div>
          <div style={{
            fontSize: 22, fontWeight: "bold", color: sigmaColor, lineHeight: 1,
            transition: "color 0.3s",
          }}>
            {activePair ? activePair.sigma.toFixed(3) : "—"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: sigmaColor,
              display: "inline-block",
            }} />
            <span style={{ fontSize: 8, color: sigmaColor }}>{sigmaLabel}</span>
            {activePair && Math.abs(activePair.sigma) >= Math.PI / 2 && (
              <span style={{ fontSize: 8, color: sigmaColor, animation: "pulse 1s infinite" }}>
                ⬤ barreira π/2
              </span>
            )}
          </div>
        </div>

        {/* noiseProbability */}
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>Prob. Ruído</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#94a3b8", lineHeight: 1 }}>
            {activePair
              ? `${((1 - activePair.confidence / 100) * 100).toFixed(1)}%`
              : "—"}
          </div>
          <div style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>
            {activePair
              ? activePair.confidence >= 90 ? "Sinal forte (≥90%)"
              : activePair.confidence >= 70 ? "Sinal moderado"
              : activePair.samples >= WARMUP_SAMPLES ? "Ruído dominante" : "Amostrando..."
              : "Sem dados"}
          </div>
        </div>
      </div>

      {/* Segunda linha de indicadores */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
        gap: 8, marginBottom: 8,
      }}>
        {/* EWMA */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>EWMA (μ)</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? activePair.ewma.toFixed(6) : "~"}
          </div>
        </div>

        {/* Volatilidade */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>Volatilidade</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? `${(activePair.volatility * 100).toFixed(4)}%` : "~"}
          </div>
        </div>

        {/* Alpha */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>Alpha (α)</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? activePair.alpha.toFixed(4) : "~"}
          </div>
        </div>

        {/* Threshold π/2 */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>Barreira π/2</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? `${(activePair.volatility * Math.PI / 2 * 100).toFixed(4)}%` : "~"}
          </div>
        </div>

        {/* Confiança */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>Confiança</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? `${activePair.confidence}%` : "~"}
          </div>
        </div>

        {/* Último Preço */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", marginBottom: 1 }}>Preço DEX</div>
          <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: "bold" }}>
            {activePair ? activePair.lastPrice.toFixed(6) : "~"}
          </div>
        </div>
      </div>

      {/* Histórico de Roteamento */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, fontWeight: "bold" }}>
          ⚡ Histórico de Roteamento (últimos 12 eventos)
        </div>
        {piRoutes.length === 0 ? (
          <div style={{ fontSize: 9, color: "#475569", padding: "8px 0", textAlign: "center" }}>
            Nenhum evento de roteamento registrado ainda
          </div>
        ) : (
          <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {piRoutes.filter(rt => rt !== null).map((rt, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 9, padding: "3px 6px",
                borderRadius: 4,
                background: rt.type === "v3" ? "rgba(74,222,128,0.08)"
                  : rt.type === "fallback" ? "rgba(96,165,250,0.08)"
                  : rt.type === "aborted" || rt.type === "requote" ? "rgba(251,113,133,0.08)"
                  : "rgba(255,255,255,0.05)",
                borderLeft: `2px solid ${
                  rt.type === "v3" ? "#4ade80" :
                  rt.type === "fallback" ? "#60a5fa" :
                  rt.type === "aborted" || rt.type === "requote" ? "#f87171" : "#475569"
                }`,
              }}>
                {/* Tag visual */}
                {rt.type === "v3" && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: "rgba(74,222,128,0.15)", color: "#4ade80", fontWeight: "bold",
                  }}>
                    ⚡ V3 {rt.fee !== undefined ? `${rt.fee.toFixed(3)}%` : ""}
                  </span>
                )}
                {rt.type === "fallback" && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: "rgba(96,165,250,0.15)", color: "#60a5fa", fontWeight: "bold",
                  }}>
                    🔄 V2 {rt.fee !== undefined ? `${(rt.fee).toFixed(3)}%` : ""}
                  </span>
                )}
                {rt.type === "aborted" && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: "rgba(251,113,133,0.15)", color: "#f87171", fontWeight: "bold",
                  }}>
                    🛑 Abortado
                  </span>
                )}
                {rt.type === "requote" && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: "rgba(251,113,133,0.1)", color: "#fbbf24", fontWeight: "bold",
                  }}>
                    ⏳ Requote
                  </span>
                )}

                {/* Par */}
                <span style={{ color: "#e2e8f0", flex: 1 }}>{rt.pair}</span>

                {/* Métrica */}
                {rt.type === "aborted" && (
                  <span style={{ color: "#f87171", fontWeight: "bold" }}>
                    -${rt.loss.toFixed(4)}
                  </span>
                )}
                {rt.type === "requote" && (
                  <span style={{ color: "#fbbf24" }}>
                    -${rt.gap.toFixed(4)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Estado vazio: fallback amigável */}
      {!activePair && !loading && (
        <div style={{
          marginTop: 8, padding: 8, borderRadius: 6,
          background: "rgba(100,116,139,0.08)", textAlign: "center",
        }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            π Buscando rota... O PiEngine será ativado quando o PoolProfiler encontrar liquidez.
          </div>
          <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
            Verifique o console para logs de RPC ou aguarde o próximo ciclo (cache 5min).
          </div>
        </div>
      )}

      {/* Animação pulse inline */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}} />
    </div>
  )
}
