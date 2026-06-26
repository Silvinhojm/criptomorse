"use client"

import { type AgentScore } from "@/lib/accountant"
import { accountant } from "@/lib/accountant"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { TERMOS } from "@/constants/messages"
import { Brain, TrendingUp, TrendingDown, Minus } from "lucide-react"

type Props = {
  score: AgentScore
  rank: number
  isTop3: boolean
}

export default function AgentCard({ score, rank, isTop3 }: Props) {
  const grade = accountant.getGrade(score.score)
  const feedback = accountant.getTeacherFeedback(score.agentName)
  const nextGrade = accountant.getNextGrade(score.score)

  const confianca = Math.min(95, Math.max(5,
    score.totalTrades > 0 ? Math.round((score.wins / score.totalTrades) * 50 + 20 + (score.streak > 0 ? 10 : -10)) : 10
  ))

  const borderColor = isTop3 ? DS.colors.accent.gold : DS.colors.bg.border
  const borderWidth = isTop3 ? 2 : 1

  return (
    <div className="rounded-xl p-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
      style={{
        background: DS.colors.bg.card,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow: isTop3 ? `0 0 16px ${DS.colors.accent.gold}22` : undefined,
      }}
      role="region" aria-label={`Robô ${score.agentName}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: `${DS.colors.accent.blue}18`, color: DS.colors.accent.blue }}>
            {rank}
          </div>
          <div>
            <div className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>{score.agentName}</div>
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>
              {grade.icone} {grade.nome}
              {nextGrade && ` · ${nextGrade.pontosFaltando} pts p/ ${nextGrade.nome}`}
            </div>
          </div>
        </div>
        {isTop3 && <span className="text-[10px] font-bold" style={{ color: DS.colors.accent.gold }}>🏆 TOP 3</span>}
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-[10px] mb-1">
          <span style={{ color: DS.colors.text.muted }}>{TERMOS.confiança}</span>
          <span style={{ color: DS.colors.text.secondary }}>{confianca}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: DS.colors.bg.hover }}
          role="progressbar" aria-label={`Nível de Certeza: ${confianca}%`} aria-valuenow={confianca} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${confianca}%`,
              background: confianca >= 60 ? DS.colors.accent.green : confianca >= 30 ? DS.colors.status.medium : DS.colors.accent.red,
            }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
        <div className="p-1 rounded" style={{ background: DS.colors.bg.hover }}>
          <div style={{ color: DS.colors.text.muted }}>V/D</div>
          <div className="font-mono font-semibold" style={{ color: DS.colors.text.primary }}>
            {score.wins}/{score.losses}
          </div>
        </div>
        <div className="p-1 rounded" style={{ background: DS.colors.bg.hover }}>
          <div style={{ color: DS.colors.text.muted }}>%</div>
          <div className="font-mono font-semibold" style={{ color: DS.colors.accent.green }}>
            {(score.winRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="p-1 rounded flex items-center gap-0.5" style={{ background: DS.colors.bg.hover }}>
          <div style={{ color: DS.colors.text.muted }}>
            {score.streak > 0 ? <TrendingUp size={10} style={{ color: DS.colors.accent.green }} /> :
             score.streak < 0 ? <TrendingDown size={10} style={{ color: DS.colors.accent.red }} /> :
             <Minus size={10} style={{ color: DS.colors.text.muted }} />}
          </div>
          <div className="font-mono font-semibold" style={{ color: DS.colors.text.primary }}>
            {score.streak > 0 ? "+" : ""}{score.streak}
          </div>
        </div>
      </div>

      <div className="text-[10px] italic leading-relaxed p-2 rounded-lg"
        style={{ background: "rgba(148,163,184,0.06)", color: DS.colors.text.muted, borderLeft: `2px solid ${DS.colors.accent.blue}33` }}>
        {feedback}
      </div>
    </div>
  )
}
