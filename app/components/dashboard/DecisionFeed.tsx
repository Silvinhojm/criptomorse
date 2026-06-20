"use client"

import { useState, useEffect, useRef } from "react"
import { pregão } from "@/lib/pregão"
import { accountant } from "@/lib/accountant"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { FRASES } from "@/constants/messages"
import { Bell, CheckCircle2, AlertCircle, Zap } from "lucide-react"

type FeedItem = {
  id: string
  text: string
  type: "sucesso" | "info" | "aviso" | "erro"
  timestamp: number
}

export default function DecisionFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [top3, setTop3] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    pregão.onLog((msg) => {
      const item = traduzirLog(msg)
      if (item) setItems(prev => [item, ...prev].slice(0, 30))
    })

    const t = setInterval(() => {
      const ranking = accountant.getRanking().slice(0, 3).map(s => s.agentName)
      setTop3(ranking)
    }, 5000)

    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [items])

  const typeStyle = (type: FeedItem["type"]) => {
    switch (type) {
      case "sucesso": return { bg: "rgba(0,212,170,0.1)", border: "1px solid rgba(0,212,170,0.2)", dot: DS.colors.accent.green, icon: CheckCircle2 }
      case "aviso":   return { bg: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", dot: DS.colors.status.medium, icon: AlertCircle }
      case "erro":    return { bg: "rgba(255,92,92,0.1)",  border: "1px solid rgba(255,92,92,0.2)",  dot: DS.colors.accent.red,   icon: AlertCircle }
      default:        return { bg: "rgba(74,158,255,0.1)", border: "1px solid rgba(74,158,255,0.2)", dot: DS.colors.accent.blue,  icon: Bell }
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <Bell size={14} style={{ color: DS.colors.accent.blue }} />
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>Linha do Tempo</span>
        {top3.length > 0 && (
          <span className="text-[10px] ml-auto" style={{ color: DS.colors.text.muted }}>
            👥 {top3.length} robôs ativos · 🏆 {top3.join(", ")}
          </span>
        )}
      </div>

      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-[11px] py-6 text-center flex flex-col items-center gap-1" style={{ color: DS.colors.text.muted }}>
            <span className="text-lg">📡</span>
            <span>Nenhum evento registrado ainda</span>
            <span className="text-[9px]">Os logs aparecerão aqui conforme os robôs executarem trades</span>
          </div>
        ) : (
          <div className="relative ml-2">
            {/* Linha do tempo vertical */}
            <div className="absolute left-[11px] top-2 bottom-2 w-px" style={{ background: DS.colors.bg.border }} />
            {items.map((item) => {
              const style = typeStyle(item.type)
              const Icon = style.icon
              const timeAgo = Math.floor((now - item.timestamp) / 1000)
              const timeStr = timeAgo < 60 ? `há ${timeAgo}s` : `há ${Math.floor(timeAgo / 60)}min`
              return (
                <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg text-[11px] leading-relaxed animate-fadeIn relative"
                  style={{ background: style.bg, border: style.border, marginLeft: 0 }}>
                  <div className="w-[22px] flex items-center justify-center flex-shrink-0 relative" style={{ zIndex: 1 }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: style.dot }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span style={{ color: DS.colors.text.primary }}>{item.text}</span>
                    <div className="text-[9px] mt-0.5" style={{ color: DS.colors.text.muted }}>{timeStr}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function traduzirLog(msg: string): FeedItem | null {
  if (msg.includes("🏛️ ORDEM GERADA")) return {
    id: crypto.randomUUID(), text: "📦 Os robôs aprovaram uma movimentação. Aguardando execução...",
    type: "info", timestamp: Date.now(),
  }
  if (msg.includes("✅ ORDEM CONCLUÍDA")) {
    const m = msg.match(/Lucro: \$([-\d.]+)/)
    if (m) {
      const lucro = parseFloat(m[1])
      return {
        id: crypto.randomUUID(),
        text: lucro >= 0 ? FRASES.lucroRealizado(lucro) : FRASES.perdaRealizada(lucro),
        type: lucro >= 0 ? "sucesso" : "aviso",
        timestamp: Date.now(),
      }
    }
  }
  if (msg.includes("🚫 Confiança")) return {
    id: crypto.randomUUID(), text: FRASES.confiancaBaixa,
    type: "aviso", timestamp: Date.now(),
  }
  if (msg.includes("Saldo stable") && msg.includes("abaixo do mínimo")) return {
    id: crypto.randomUUID(), text: FRASES.saldoInsuficiente("USDC"),
    type: "erro", timestamp: Date.now(),
  }
  if (msg.includes("Staircase") && msg.includes("lucro")) {
    const m = msg.match(/([\w]+):.*?([\d.]+)%/)
    if (m) return {
      id: crypto.randomUUID(), text: FRASES.staircaseAtivo(m[1], Math.round(parseFloat(m[2]) / 5)),
      type: "sucesso", timestamp: Date.now(),
    }
  }
  if (msg.includes("Top 3") && msg.includes("0 votos")) return {
    id: crypto.randomUUID(), text: FRASES.semSinais,
    type: "info", timestamp: Date.now(),
  }
  return null
}
