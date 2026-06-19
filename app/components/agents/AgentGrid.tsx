"use client"

import { useState, useEffect } from "react"
import { accountant } from "@/lib/accountant"
import AgentCard from "./AgentCard"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { FRASES } from "@/constants/messages"
import { Brain } from "lucide-react"

export default function AgentGrid() {
  const [ranking, setRanking] = useState(accountant.getRanking())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setInterval(() => {
      setRanking(accountant.getRanking())
      setLoading(false)
    }, 4000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <Brain size={14} style={{ color: DS.colors.accent.blue }} />
          <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Ranking dos Robôs</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl p-3" style={{ background: DS.colors.bg.hover }}>
              <div className="h-4 w-20 mb-3 rounded" style={{ background: DS.colors.bg.card }} />
              <div className="h-2 w-full mb-3 rounded" style={{ background: DS.colors.bg.card }} />
              <div className="h-3 w-16 rounded" style={{ background: DS.colors.bg.card }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <Brain size={14} style={{ color: DS.colors.accent.blue }} />
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Ranking dos Robôs</span>
        <span className="text-[10px] ml-auto" style={{ color: DS.colors.text.muted }}>
          {ranking.length} robôs · 🏆 {ranking.slice(0, 3).map(s => s.agentName).join(", ")}
        </span>
      </div>

      {ranking.length === 0 ? (
        <div className="text-[11px] py-6 text-center" style={{ color: DS.colors.text.muted }}>
          {FRASES.analisando}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {ranking.map((score, i) => (
            <AgentCard key={score.agentName} score={score} rank={i + 1} isTop3={i < 3} />
          ))}
        </div>
      )}
    </div>
  )
}
