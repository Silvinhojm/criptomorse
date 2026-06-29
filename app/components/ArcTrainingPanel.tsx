"use client"

import { useState, useEffect } from "react"
import { arcTraining, type ArcTrainingState, type TrainingAgentSnapshot, type TrainingParamSnapshot } from "@/lib/arc-training"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const card: React.CSSProperties = {
  marginBottom: 12,
  background: "rgba(139,92,246,0.05)",
  borderRadius: 12,
  padding: 12,
  border: "1px solid rgba(139,92,246,0.15)",
}

const btnBase: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 8,
  border: "none",
  fontSize: 12,
  fontWeight: "bold",
  cursor: "pointer",
}

export function ArcTrainingPanel({ network }: { network: string }) {
  const [state, setState] = useState<ArcTrainingState>(arcTraining.getState())
  const isArc = network === "arc"

  useEffect(() => {
    const unsub = arcTraining.subscribe(setState)
    return unsub
  }, [])

  const handleStart = () => { arcTraining.start() }
  const handleStop = () => { arcTraining.stop() }

  const lastAgents = state.agentSnapshots[state.agentSnapshots.length - 1]
  const lastParams = state.parameterSnapshots[state.parameterSnapshots.length - 1]
  const firstAgents = state.agentSnapshots.length >= 2 ? state.agentSnapshots[0] : null

  const formatDelta = (current: number, baseline: number | undefined): string => {
    if (baseline === undefined || baseline === 0) return ""
    const delta = current - baseline
    if (Math.abs(delta) < 1) return ""
    return delta > 0 ? ` ▲${delta}` : ` ▼${Math.abs(delta)}`
  }

  if (!isArc) return null

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🎓</span>
        <span style={{ fontSize: 13, color: "#fff", fontWeight: "bold" }}>Arc Training</span>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 10,
          background: state.active ? "#22c55e" : "#64748b", color: "#fff",
        }}>
          {state.active ? "Treinando" : "Parado"}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>
          {state.cyclesCompleted}/{state.cyclesTarget} ciclos
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={handleStart}
          disabled={state.active}
          style={{ ...btnBase, background: state.active ? "#334155" : "#22c55e", color: "#fff" }}
        >▶ Iniciar</button>
        <button
          onClick={handleStop}
          disabled={!state.active}
          style={{ ...btnBase, background: !state.active ? "#334155" : "#ef4444", color: "#fff" }}
        >⏹ Parar</button>
      </div>

      {lastAgents && (
        <div style={{ fontSize: 11, color: "#c4b5fd", marginBottom: 6 }}>
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>Agentes:</div>
          {lastAgents.agents.slice(0, 5).map((a, i) => {
            const baseline = firstAgents?.agents.find(ba => ba.nome === a.nome)
            const deltaPts = baseline ? a.pontos - baseline.pontos : 0
            const deltaTaxa = baseline ? a.taxaAcerto - baseline.taxaAcerto : 0
            return (
              <div key={a.nome} style={{ display: "flex", gap: 12, padding: "2px 0" }}>
                <span style={{ width: 120 }}>{a.nome}</span>
                <span style={{
                  color: a.pontos >= 0 ? "#22c55e" : "#ef4444", width: 80,
                }}>
                  {a.pontos}pts
                  {deltaPts !== 0 && (
                    <span style={{ color: deltaPts > 0 ? "#22c55e" : "#ef4444", fontSize: 10 }}>
                      {deltaPts > 0 ? ` ▲${deltaPts}` : ` ▼${Math.abs(deltaPts)}`}
                    </span>
                  )}
                </span>
                <span style={{ color: "#94a3b8", width: 60 }}>{a.taxaAcerto.toFixed(0)}%</span>
                <span style={{ color: "#64748b", fontSize: 10 }}>{a.palpitesTotal} palpites</span>
              </div>
            )
          })}
        </div>
      )}

      {lastParams && lastParams.params.length > 0 && (
        <div style={{ fontSize: 11, color: "#a78bfa", marginBottom: 6 }}>
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>Parâmetros calibrados:</div>
          {lastParams.params.slice(0, 5).map((p, i) => (
            <div key={p.nome} style={{ display: "flex", gap: 12, padding: "2px 0" }}>
              <span style={{ width: 120 }}>{p.nome}</span>
              <span>conf.min={p.confiancaMinima}%</span>
              <span>entrada={(p.thresholdEntrada * 100).toFixed(2)}%</span>
              <span>spread={(p.thresholdSpread * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}

      {state.logs.length > 0 && (
        <div style={{
          fontSize: 10, color: "#64748b", maxHeight: 80, overflowY: "auto",
          background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 6,
        }}>
          {state.logs.slice(-5).map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  )
}
