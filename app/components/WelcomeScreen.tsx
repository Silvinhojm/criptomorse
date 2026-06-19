"use client"

import { Activity } from "lucide-react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

type Props = {
  onConnect: () => void
  connecting?: boolean
}

export default function WelcomeScreen({ onConnect, connecting }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{
        background: `linear-gradient(135deg, ${DS.colors.gradient.from}, ${DS.colors.gradient.to})`,
      }}>
      {/* Logo animado */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${DS.colors.accent.blue}, ${DS.colors.accent.green})`,
            boxShadow: `0 0 40px ${DS.colors.accent.blue}44`,
          }}>
          <Activity size={40} className="text-white" />
        </div>
        <div className="absolute -inset-2 rounded-2xl opacity-20"
          style={{
            background: `linear-gradient(135deg, ${DS.colors.accent.blue}, ${DS.colors.accent.green})`,
            filter: "blur(16px)",
            zIndex: -1,
          }} />
      </div>

      {/* Nome da plataforma */}
      <h1 className="text-3xl font-bold tracking-tight mb-2"
        style={{ color: DS.colors.text.primary }}>
        ARCFLOW
      </h1>

      {/* Frase de impacto */}
      <p className="text-base mb-10 text-center max-w-xs"
        style={{ color: DS.colors.text.secondary }}>
        Seus robôs trabalhando para você 24h
      </p>

      {/* Botão Conectar Carteira */}
      <button
        onClick={onConnect}
        disabled={connecting}
        className="flex items-center gap-3 px-10 py-4 rounded-2xl text-base font-bold transition-all duration-300 hover:brightness-110 hover:-translate-y-0.5 active:scale-95"
        style={{
          background: `linear-gradient(135deg, ${DS.colors.accent.green}, #16a34a)`,
          color: "#fff",
          boxShadow: `0 0 30px ${DS.colors.accent.green}44`,
          opacity: connecting ? 0.7 : 1,
          cursor: connecting ? "not-allowed" : "pointer",
        }}>
        {connecting ? (
          <>
            <span className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Conectando...
          </>
        ) : (
          <>
            <span className="text-xl">🔌</span>
            Conectar Carteira
          </>
        )}
      </button>

      {/* Footer sutil */}
      <p className="text-xs mt-16" style={{ color: DS.colors.text.muted }}>
        Multi-chain · Trading Automatizado · 24/7
      </p>
    </div>
  )
}
