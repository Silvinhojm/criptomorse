"use client"

import { useEffect, useState, useRef } from "react"
import { narrador, type NarratorEvent } from "@/lib/narrator"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

type ChatMessage = {
  role: "user" | "assistant"
  text: string
  icon?: string
}

type Mood = "dormindo" | "animado" | "pensativo" | "feliz"

const MOOD_AVATAR: Record<Mood, string> = {
  dormindo: "😴",
  animado: "🤖",
  pensativo: "🤔",
  feliz: "🎉",
}

const MOOD_COLOR: Record<Mood, string> = {
  dormindo: DS.colors.text.muted,
  animado: DS.colors.accent.blue,
  pensativo: DS.colors.status.medium,
  feliz: DS.colors.accent.green,
}

export default function NarratorBot() {
  const [events, setEvents] = useState<NarratorEvent[]>([])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"events" | "chat">("events")
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [asking, setAsking] = useState(false)
  const [mood, setMood] = useState<Mood>("dormindo")
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setEvents(narrador.getHistory())
    const unsub = narrador.onEvent((ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 10))
      if (ev.type === "success") setMood("feliz")
      else if (ev.type === "error") setMood("pensativo")
      else if (ev.type === "warn") setMood("pensativo")
      else setMood("animado")
      setTimeout(() => setMood("dormindo"), 4000)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (tab === "chat") setTimeout(() => inputRef.current?.focus(), 100)
  }, [tab])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat])

  const perguntar = async () => {
    const q = input.trim()
    if (!q || asking) return
    setInput("")
    setChat((prev) => [...prev, { role: "user", text: q, icon: "🧑" }])
    setAsking(true)
    setMood("pensativo")
    try {
      const res = await fetch("/api/narrator/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      setChat((prev) => [...prev, { role: "assistant", text: data.answer ?? "Sem resposta.", icon: "🤖" }])
      setMood("feliz")
    } catch {
      setChat((prev) => [...prev, { role: "assistant", text: "Erro ao consultar o sistema.", icon: "❌" }])
      setMood("pensativo")
    }
    setAsking(false)
    setTimeout(() => setMood("dormindo"), 4000)
  }

  const ultimoEvento = events[0]
  const latestText = tab === "chat" && chat.length > 0
    ? chat[chat.length - 1].text
    : ultimoEvento?.text ?? "Os robôs estão monitorando o mercado..."

  return (
    <div className="max-w-7xl mx-auto px-4 mb-4">
      <div className="rounded-xl p-3 flex items-center gap-3 transition-all duration-300 cursor-pointer hover:brightness-110"
        style={{
          background: `${MOOD_COLOR[mood]}10`,
          border: `1px solid ${MOOD_COLOR[mood]}30`,
        }}
        onClick={() => setOpen(!open)}>
        {/* Avatar do robô */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{
              background: `linear-gradient(135deg, ${DS.colors.accent.blue}33, ${DS.colors.accent.green}33)`,
              border: `1px solid ${MOOD_COLOR[mood]}44`,
              transition: "border-color 0.5s ease",
            }}>
            {MOOD_AVATAR[mood]}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${mood === "animado" ? "animate-ping" : ""}`}
            style={{ background: MOOD_COLOR[mood] }} />
        </div>

        {/* Balão de fala */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold mb-0.5" style={{ color: DS.colors.text.primary }}>
            Narrador
          </div>
          <div className="text-[11px] leading-relaxed line-clamp-2" style={{ color: DS.colors.text.secondary }}>
            {latestText.slice(0, 120)}
            {latestText.length > 120 ? "..." : ""}
          </div>
        </div>

        <span className="text-lg flex-shrink-0" style={{ color: DS.colors.text.muted }}>
          {open ? "▼" : "▲"}
        </span>
      </div>

      {open && (
        <div className="rounded-xl mt-2 overflow-hidden transition-all duration-300"
          style={{
            background: DS.colors.bg.card,
            border: `1px solid ${DS.colors.bg.border}`,
          }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${DS.colors.bg.border}` }}>
            <button onClick={() => setTab("events")} style={{
              flex: 1, padding: "8px", cursor: "pointer", border: "none",
              background: tab === "events" ? "rgba(148,163,184,0.12)" : "transparent",
              color: tab === "events" ? DS.colors.text.primary : DS.colors.text.muted, fontSize: 12,
            }}>📡 Eventos</button>
            <button onClick={() => setTab("chat")} style={{
              flex: 1, padding: "8px", cursor: "pointer", border: "none",
              background: tab === "chat" ? "rgba(148,163,184,0.12)" : "transparent",
              color: tab === "chat" ? DS.colors.text.primary : DS.colors.text.muted, fontSize: 12,
            }}>💬 Perguntar</button>
          </div>

          {tab === "events" ? (
            <div style={{ overflowY: "auto", padding: 8, maxHeight: 200 }}>
              {events.length === 0 ? (
                <div style={{ color: DS.colors.text.muted, padding: 8, textAlign: "center", fontSize: 11 }}>
                  Nenhum evento ainda.
                </div>
              ) : (
                events.map((ev, i) => (
                  <div key={i} style={{
                    padding: "6px 8px", marginBottom: 4,
                    background: ev.type === "success" ? "rgba(34,197,94,0.12)" : ev.type === "warn" ? "rgba(234,179,8,0.12)" : ev.type === "error" ? "rgba(239,68,68,0.12)" : "rgba(148,163,184,0.08)",
                    border: `1px solid ${ev.type === "success" ? "rgba(34,197,94,0.25)" : ev.type === "warn" ? "rgba(234,179,8,0.25)" : ev.type === "error" ? "rgba(239,68,68,0.25)" : "rgba(148,163,184,0.15)"}`,
                    borderRadius: 8, color: DS.colors.text.primary, lineHeight: 1.4, fontSize: 11,
                  }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{ev.icon}</span>
                      <span style={{ flex: 1 }}>{ev.text}</span>
                    </div>
                    <div style={{ fontSize: 10, color: DS.colors.text.muted, marginTop: 2, textAlign: "right" }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 320 }}>
              <div style={{ overflowY: "auto", padding: "6px 8px", flex: 1, minHeight: 150 }}>
                {chat.length === 0 && (
                  <div style={{ padding: 8, color: DS.colors.text.secondary, textAlign: "center", fontSize: 11 }}>
                    Faça perguntas sobre o sistema:<br />
                    gas · spread · moedas · saldo · posições
                  </div>
                )}
                {chat.map((msg, i) => (
                  <div key={i} style={{
                    padding: "6px 8px", marginBottom: 4,
                    background: msg.role === "user" ? "rgba(99,102,241,0.1)" : "rgba(148,163,184,0.08)",
                    border: `1px solid ${DS.colors.bg.border}`,
                    borderRadius: 8, color: DS.colors.text.primary, lineHeight: 1.5, whiteSpace: "pre-wrap", fontSize: 11,
                  }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span>{msg.icon ?? (msg.role === "user" ? "🧑" : "🤖")}</span>
                      <span style={{ flex: 1 }}>{msg.text}</span>
                    </div>
                  </div>
                ))}
                {asking && (
                  <div style={{ color: DS.colors.text.muted, padding: 8, textAlign: "center", fontSize: 11 }}>
                    Pensando...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderTop: `1px solid ${DS.colors.bg.border}` }}>
                <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && perguntar()}
                  placeholder="Pergunte algo..." style={{
                    flex: 1, padding: "6px 8px", fontSize: 11,
                    background: DS.colors.bg.DEFAULT, border: `1px solid ${DS.colors.bg.border}`,
                    borderRadius: 6, color: DS.colors.text.primary, outline: "none",
                  }} />
                <button onClick={perguntar} disabled={asking || !input.trim()} style={{
                  padding: "6px 10px", cursor: "pointer", fontSize: 11,
                  background: asking ? `${DS.colors.accent.blue}44` : `${DS.colors.accent.blue}88`,
                  border: `1px solid ${DS.colors.accent.blue}66`, borderRadius: 6, color: "#fff",
                }}>{asking ? "..." : "→"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
