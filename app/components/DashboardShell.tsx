"use client"

import { useState, useCallback, type ReactNode } from "react"
import Header from "./layout/Header"
import DrawerWallet from "./layout/DrawerWallet"
import KpiPanel from "./dashboard/KpiPanel"
import DecisionFeed from "./dashboard/DecisionFeed"
import AgentGrid from "./agents/AgentGrid"
import ActiveTrades from "./positions/ActiveTrades"
import NarratorBot from "./NarratorBot"
import WelcomeScreen from "./WelcomeScreen"
import QuantumWavePanel from "./QuantumWavePanel"
import GridPerformancePanel from "./grid/GridPerformancePanel"
import AMMPoolStatus from "./AMMPoolStatus"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import type { NetworkKey } from "@/lib/real-swap-executor"
import { SectionContext, type Section } from "./SectionContext"

type Props = {
  children: ReactNode
  account: string | null
  networkName: string
  isTestnet: boolean
  currentNetworkKey?: NetworkKey
  onNetworkChange?: (key: NetworkKey) => void
  onConnect?: () => void
  connecting?: boolean
}



const SECTIONS: { key: Section; icon: string; label: string }[] = [
  { key: "overview", icon: "📊", label: "Visão Geral" },
  { key: "trading", icon: "🤖", label: "Auto Trader" },
  { key: "bot", icon: "🏦", label: "Bot Bank" },
  { key: "bridge", icon: "🌉", label: "Bridge" },
  { key: "payments", icon: "🏅", label: "Recompensas" },
  { key: "classroom", icon: "📚", label: "Sala de Aula" },
]

export default function DashboardShell({ children, account, networkName, isTestnet, currentNetworkKey, onNetworkChange, onConnect, connecting }: Props) {
  const [walletOpen, setWalletOpen] = useState(false)
  const [section, setSection] = useState<Section>("overview")

  if (!account) {
    return <WelcomeScreen onConnect={onConnect ?? (() => {})} connecting={connecting} />
  }

  return (
    <div className="min-h-screen" style={{ background: DS.colors.bg.DEFAULT, color: DS.colors.text.primary }}>
      <Header onToggleWallet={() => setWalletOpen(true)} currentNetworkKey={currentNetworkKey} onNetworkChange={onNetworkChange} />
      <DrawerWallet open={walletOpen} onClose={() => setWalletOpen(false)} />
      <NarratorBot />

      {/* Section Nav */}
      {account && (
        <div className="max-w-7xl mx-auto px-4 pt-16">
          <div className="flex gap-1 overflow-x-auto pb-1" style={{ borderBottom: `1px solid ${DS.colors.bg.border}` }}>
            {SECTIONS.map(s => {
              const active = section === s.key
              return (
                <button key={s.key} onClick={() => setSection(s.key)}
                  className="text-xs font-medium px-3 py-2 rounded-t-lg transition-all whitespace-nowrap"
                  style={{
                    background: active ? "rgba(59,130,246,0.12)" : "transparent",
                    color: active ? "#3b82f6" : DS.colors.text.muted,
                    borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
                  }}>
                  {s.icon} {s.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 pt-4 pb-8">
        {account && section === "overview" && (
          <>
            <div className="mb-6">
              <KpiPanel />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2">
                <DecisionFeed />
              </div>
              <div>
                <ActiveTrades />
              </div>
            </div>
            <div className="mb-6">
              <QuantumWavePanel />
            </div>
            <div className="mb-6">
              <GridPerformancePanel currentNetworkKey={currentNetworkKey} />
            </div>
            {currentNetworkKey === "arc" && (
              <div className="mb-6">
                <AMMPoolStatus />
              </div>
            )}
            <div className="mb-6">
              <AgentGrid />
            </div>
          </>
        )}

        <SectionContext.Provider value={{ section }}>
          <div className={`space-y-6 ${section === "overview" ? "" : "pt-4"}`}>
            {children}
          </div>
        </SectionContext.Provider>
      </main>

      <footer className="border-t py-3 text-center text-[10px]"
        style={{ borderColor: DS.colors.bg.border, color: DS.colors.text.muted, background: DS.colors.bg.DEFAULT }}>
        🤖 Híbrido | {isTestnet ? "🧪 TESTNET" : "💰 MAINNET"} | {networkName}
      </footer>
    </div>
  )
}
