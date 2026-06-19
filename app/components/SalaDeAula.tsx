"use client"
import { useState, useEffect } from "react"
import { accountant } from "@/lib/accountant"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const COR_DOURADO = "#d4a574"

const AGENTE_ICONES = [
  "🟦", "🟪", "🟥", "🟧", "🟨", "🟩", "🟫", "⬛", "⬜", "🔶", "🔷", "🟢",
]

const MEDALHAS: Record<string, string> = {
  "🌱 Aprendiz": "📖",
  "📗 Primeiro Grau": "📗",
  "📘 Segundo Grau": "📘",
  "📙 Terceiro Grau": "📙",
  "🎓 Mestrado": "🎓",
  "🏆 Doutorado": "🏆",
}

const ELOGIOS = [
  "Excelente! Seu raciocínio está afiado hoje.",
  "Análise precisa — continue confiando nos seus indicadores.",
  "Você está enxergando padrões que outros perdem. Nota 10!",
  "Evolução constante. Orgulho da turma!",
  "Seu feeling de mercado está cada vez mais aguçado.",
]
const CRITICAS = [
  "Você repetiu o mesmo erro três vezes. Revise a estratégia.",
  "Precipitação. Espere a confirmação antes de agir.",
  "Seus filtros estão largos demais — seja mais seletivo.",
  "O mercado mudou e você não ajustou. Hora de recalibrar.",
  "Teimosia não é estratégia. Saiba quando desistir de um setup.",
]
const NEUTRAS = [
  "Estável, mas pode render mais. Estude novos padrões.",
  "Resultado mediano — variância ou erro? Analise os logs.",
  "Você está na média da turma. Quer se destacar? Mude algo.",
  "Nem todo ciclo é lucrativo. Saber segurar também é sabedoria.",
]

function professorFeedback(score: number, streak: number, wins: number, losses: number): string {
  if (score > 70) return ELOGIOS[Math.floor(Math.random() * ELOGIOS.length)]
  if (wins + losses < 5) return "Ainda estou te avaliando, mas já vejo potencial. Continue assim."
  if (streak <= -3) return CRITICAS[Math.floor(Math.random() * CRITICAS.length)]
  if (streak >= 3) return ELOGIOS[Math.floor(Math.random() * ELOGIOS.length)]
  if (losses > wins) return CRITICAS[Math.floor(Math.random() * CRITICAS.length)]
  return NEUTRAS[Math.floor(Math.random() * NEUTRAS.length)]
}

function MedalVisual({ nome }: { nome: string }) {
  const medal = MEDALHAS[nome]
  return <span style={{ fontSize: 16 }}>{medal ?? "📖"}</span>
}

export function SalaDeAula() {
  const [ranking, setRanking] = useState(accountant.getRanking())
  const [turmaStats, setTurmaStats] = useState(accountant.getStats())
  const [professorMsg, setProfessorMsg] = useState("📚 Bem-vindos à Sala de Aula! Vamos ver como os agentes estão se saindo hoje...")
  const [animatingBar, setAnimatingBar] = useState("")

  useEffect(() => {
    const interval = setInterval(() => {
      const r = accountant.getRanking()
      const s = accountant.getStats()
      setRanking([...r])
      setTurmaStats({ ...s })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const mediaTurma = ranking.length > 0
    ? ranking.reduce((s, a) => s + a.score, 0) / ranking.length
    : 0

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>📚</span>
        <span style={{ fontWeight: "bold", color: DS.colors.text.primary, fontSize: 16 }}>Sala de Aula</span>
        <span style={{ fontSize: 10, color: DS.colors.text.muted }}>— Ranking dos Agentes</span>
      </div>

      {/* Mensagem do Professor com ícone de quadro-negro */}
      <div style={{
        background: `linear-gradient(135deg, ${DS.colors.accent.blue}15, rgba(212,165,116,0.05))`,
        border: `1px solid ${DS.colors.accent.blue}33`,
        borderRadius: 12, padding: "10px 14px",
        marginBottom: 12, fontSize: 11, color: DS.colors.text.primary, fontStyle: "italic",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 20 }}>📖</span>
        <span><strong>Professor:</strong> {professorMsg}</span>
      </div>

      {/* Estatísticas da Turma */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 12 }}>
        <Quadro label="🎓 Agentes" valor={`${ranking.length}`} />
        <Quadro label="📝 Avaliações" valor={`${turmaStats.totalTrades}`} />
        <Quadro label="📊 Média" valor={`${mediaTurma.toFixed(1)}`} cor="#fbbf24" />
        <Quadro label="🥇 Primeiro" valor={turmaStats.bestAgent ?? "—"} cor={DS.colors.accent.green} />
      </div>

      {/* Ranking dos Agentes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ranking.map((ag, i) => {
          const grade = accountant.getGrade(ag.score)
          const feedback = professorFeedback(ag.score, ag.streak, ag.wins, ag.losses)
          const proximo = accountant.getNextGrade(ag.score)
          const barraWidth = Math.min(100, ag.score)
          const agIcon = AGENTE_ICONES[i % AGENTE_ICONES.length]

          return (
            <div key={ag.agentName} style={{
              background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 8,
              border: `1px solid ${i === 0 ? `${COR_DOURADO}44` : "transparent"}`,
              boxShadow: i === 0 ? `0 0 12px ${COR_DOURADO}22` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: DS.colors.text.muted, minWidth: 20 }}>#{i + 1}</span>
                <MedalVisual nome={grade.nome} />
                <span style={{ fontSize: 12 }}>{agIcon}</span>
                <span style={{ fontWeight: "bold", color: DS.colors.text.primary, fontSize: 12 }}>{ag.agentName}</span>
                <span style={{
                  marginLeft: "auto", fontSize: 12, fontWeight: "bold",
                  color: ag.score > 50 ? DS.colors.accent.green : ag.score > 20 ? "#fbbf24" : DS.colors.accent.red,
                }}>
                  {ag.score.toFixed(1)}
                </span>
              </div>

              {/* Barra de progresso animada */}
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 4, height: 6, marginBottom: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${barraWidth}%`, height: "100%", borderRadius: 4,
                  background: `linear-gradient(90deg, ${DS.colors.accent.blue}, ${ag.score > 50 ? DS.colors.accent.green : COR_DOURADO})`,
                  transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: `0 0 8px ${ag.score > 50 ? DS.colors.accent.green : DS.colors.accent.blue}44`,
                }} />
              </div>

              <div style={{ display: "flex", gap: 8, fontSize: 9, color: DS.colors.text.muted, flexWrap: "wrap", alignItems: "center" }}>
                <span>{grade.nome}</span>
                <span>🏟️ {ag.points.toFixed(0)} pts</span>
                <span>✅ {ag.wins}V</span>
                <span>❌ {ag.losses}D</span>
                <span>📈 {ag.winRate.toFixed(0)}%</span>
                <span style={{ color: ag.streak >= 0 ? DS.colors.accent.green : DS.colors.accent.red }}>
                  {ag.streak >= 0 ? `🔥 +${ag.streak}` : `❄️ ${ag.streak}`}
                </span>
                {proximo && (
                  <span style={{ color: COR_DOURADO, fontSize: 9 }}>
                    🎯 {proximo.nome} em {proximo.pontosFaltando} pts
                  </span>
                )}
              </div>

              {/* Feedback do Professor */}
              <div style={{ fontSize: 9, color: DS.colors.text.secondary, marginTop: 3, fontStyle: "italic" }}>
                📖 {feedback}
              </div>
            </div>
          )
        })}
      </div>

      {ranking.length === 0 && (
        <div style={{ textAlign: "center", padding: 20, color: DS.colors.text.muted, fontSize: 11 }}>
          📚 Nenhum agente avaliado ainda. Os votos acumulados na Sala de Aula aparecerão aqui.
        </div>
      )}
    </div>
  )
}

function Quadro({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
      <div style={{ fontSize: 9, color: DS.colors.text.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: "bold", color: cor ?? DS.colors.text.primary }}>{valor}</div>
    </div>
  )
}
