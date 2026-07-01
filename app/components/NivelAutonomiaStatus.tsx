"use client"

import { useState, useEffect } from "react"
import { escolaRobos } from "@/lib/escola-robos"
import { NIVEL_RULES, type NivelAutonomia } from "@/lib/nivel-autonomia"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { TrendingUp } from "lucide-react"

type NivelDisplay = {
  nome: string
  nivel: NivelAutonomia
  label: string
  titulo: string
  progressoProximo: number
  podeExecutarSolo: boolean
  podeAumentarOrcamento: boolean
  pontos: number
  taxaAcerto: number
  lucroAcumulado: number
  maxAmountUSD: number
}

export default function NivelAutonomiaStatus() {
  const [robos, setRobos] = useState<NivelDisplay[]>([])

  useEffect(() => {
    function refresh() {
      const agentes = escolaRobos.getAll()
      const display = agentes
        .filter(a => a.palpitesTotal > 0)
        .map(a => {
          const info = escolaRobos.getNivelInfo(a.nome)
          return {
            nome: a.nome,
            nivel: info.nivel,
            label: info.label,
            titulo: info.titulo,
            progressoProximo: info.progressoProximo,
            podeExecutarSolo: info.podeExecutarSolo,
            podeAumentarOrcamento: info.podeAumentarOrcamento,
            pontos: info.pontos,
            taxaAcerto: info.taxaAcerto,
            lucroAcumulado: info.lucroAcumulado,
            maxAmountUSD: info.maxAmountUSD,
          }
        })
        .sort((a, b) => b.nivel - a.nivel || b.pontos - a.pontos)
      setRobos(display)
    }

    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [])

  if (robos.length === 0) return null

  return (
    <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} style={{ color: DS.colors.accent.blue }} />
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>
          Autonomia dos Agentes
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
          {robos.filter(r => r.podeExecutarSolo).length} autônomos
        </span>
      </div>

      <div className="space-y-2">
        {robos.map(r => {
          const rule = NIVEL_RULES[r.nivel]
          return (
            <div key={r.nome} className="flex items-center gap-3 p-2 rounded-lg text-xs"
              style={{ background: DS.colors.bg.hover }}>
              {/* Level badge */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ background: `${rule.coresDashboard}22`, color: rule.coresDashboard }}>
                {r.nivel}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate" style={{ color: DS.colors.text.primary }}>
                    {r.nome}
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded whitespace-nowrap"
                    style={{ background: `${rule.coresDashboard}22`, color: rule.coresDashboard }}>
                    {r.label}
                  </span>
                  {r.podeExecutarSolo && (
                    <span className="text-[10px]" style={{ color: DS.colors.accent.green }}>🤖</span>
                  )}
                  {r.podeAumentarOrcamento && (
                    <span className="text-[10px]" style={{ color: DS.colors.accent.blue }}>💰</span>
                  )}
                </div>
                <div className="flex gap-3 mt-0.5 text-[10px]" style={{ color: DS.colors.text.muted }}>
                  <span>{r.pontos}pts</span>
                  <span>{r.taxaAcerto.toFixed(0)}% acerto</span>
                  <span>${r.lucroAcumulado.toFixed(2)} lucro</span>
                  <span>max ${r.maxAmountUSD}</span>
                </div>

                {/* Progress bar para próximo nível */}
                {r.nivel < 4 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 rounded-full" style={{ background: DS.colors.bg.border }}>
                      <div className="h-1 rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, r.progressoProximo)}%`,
                          background: `linear-gradient(90deg, ${rule.coresDashboard}, ${NIVEL_RULES[(r.nivel + 1) as NivelAutonomia]?.coresDashboard || rule.coresDashboard})`,
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono" style={{ color: DS.colors.text.muted }}>
                      Nível {r.nivel + 1}: {r.progressoProximo}%
                    </span>
                  </div>
                )}
                {r.nivel >= 4 && (
                  <div className="text-[9px] mt-0.5" style={{ color: DS.colors.accent.green }}>
                    🏆 Autonomia total — orçamento cresce com lucro
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legenda */}
      <div className="flex gap-3 mt-2 text-[9px]" style={{ color: DS.colors.text.muted }}>
        <span>🤖 Solo</span>
        <span>💰 Bônus</span>
        <span>Nível 0-4</span>
      </div>
    </div>
  )
}