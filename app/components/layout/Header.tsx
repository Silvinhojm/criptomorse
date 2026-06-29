"use client"

import { useState, useEffect } from "react"
import { realSwap, NETWORKS, type NetworkKey } from "@/lib/real-swap-executor"
import { Wallet, Activity, ChevronDown, Lock } from "lucide-react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const NETWORK_META: { key: NetworkKey; icon: string; label: string }[] = [
  { key: "arc", icon: "🔵", label: "Arc" },
  { key: "base", icon: "🟢", label: "Base" },
  { key: "polygon", icon: "🟣", label: "Polygon" },
  { key: "ethereum", icon: "💙", label: "Ethereum" },
  { key: "sepolia", icon: "🧪", label: "Sepolia" },
]

type Props = {
  onToggleWallet: () => void
  currentNetworkKey?: NetworkKey
  onNetworkChange?: (key: NetworkKey) => void
}

export default function Header({ onToggleWallet, currentNetworkKey, onNetworkChange }: Props) {
  const [balance, setBalance] = useState(0)
  const [redeAtiva, setRedeAtiva] = useState("polygon")
  const [status, setStatus] = useState<"conectado" | "desconectado">("desconectado")

  useEffect(() => {
    const net = realSwap.getNetworkKey()
    setRedeAtiva(net)
    setBalance(realSwap.getBalance("USDC"))
    setStatus(realSwap.getAddress() ? "conectado" : "desconectado")

    const t = setInterval(() => {
      realSwap.refreshAllBalances().catch(() => {})
      setBalance(realSwap.getBalance("USDC"))
    }, 5000)
    return () => clearInterval(t)
  }, [])

  const netName = NETWORKS[redeAtiva as NetworkKey]?.name ?? "Desconhecida"
  const isTestnet = NETWORKS[redeAtiva as NetworkKey]?.isTestnet ?? false

  return (
    <header className="fixed top-0 left-0 right-0 z-50"
      style={{ background: DS.colors.bg.DEFAULT, borderBottom: `1px solid ${DS.colors.bg.border}` }}>
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity size={20} style={{ color: DS.colors.accent.blue }} />
            <span className="font-bold text-sm tracking-tight" style={{ color: DS.colors.text.primary }}>
              CriptoMorse
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
            style={{
              background: status === "conectado" ? "rgba(0,212,170,0.1)" : "rgba(255,92,92,0.1)",
              color: status === "conectado" ? DS.colors.accent.green : DS.colors.accent.red,
            }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block"
              style={{ background: status === "conectado" ? DS.colors.accent.green : DS.colors.accent.red }} />
            {status === "conectado" ? (isTestnet ? "Testnet" : "Mainnet") : "Offline"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {NETWORK_META.map(n => {
            const active = (currentNetworkKey ?? redeAtiva) === n.key
            return (
              <button key={n.key} onClick={() => onNetworkChange?.(n.key)}
                className="text-[11px] px-2 py-1 rounded-md font-medium transition-all duration-200 hover:brightness-110"
                style={{
                  background: active ? "rgba(59,130,246,0.2)" : "transparent",
                  color: active ? "#3b82f6" : DS.colors.text.muted,
                  border: `1px solid ${active ? "rgba(59,130,246,0.3)" : "transparent"}`,
                }}>
                {n.icon} {n.label}
              </button>
            )
          })}
        </div>

        {/* Toggle de privacidade (desabilitado — em breve) */}
        <div className="relative group">
          <button disabled
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium opacity-50 cursor-not-allowed"
            style={{ background: DS.colors.bg.card, color: DS.colors.text.muted, border: `1px solid ${DS.colors.bg.border}` }}>
            <Lock size={12} />
            Privado
          </button>
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
            <div className="px-2 py-1 rounded text-[10px] whitespace-nowrap"
              style={{ background: DS.colors.bg.hover, color: DS.colors.text.secondary, border: `1px solid ${DS.colors.bg.border}` }}>
              🔒 Modo privado em breve
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm"
            style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
            <Wallet size={14} style={{ color: DS.colors.accent.green }} />
            <span style={{ fontFamily: DS.fonts.mono, color: DS.colors.text.primary, fontWeight: 600 }}>
              ${balance.toFixed(2)}
            </span>
            <span className="text-[11px]" style={{ color: DS.colors.text.muted }}>USDC</span>
          </div>

          <button onClick={onToggleWallet}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 hover:brightness-110"
            style={{ background: DS.colors.bg.card, color: DS.colors.text.secondary, border: `1px solid ${DS.colors.bg.border}` }}>
            <Wallet size={14} />
            Cofre
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
    </header>
  )
}
