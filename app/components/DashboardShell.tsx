"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Header from "./layout/Header"
import DrawerWallet from "./layout/DrawerWallet"
import DecisionFeed from "./dashboard/DecisionFeed"
import AgentGrid from "./agents/AgentGrid"
import ActiveTrades from "./positions/ActiveTrades"
import NarratorBot from "./NarratorBot"
import WelcomeScreen from "./WelcomeScreen"
import QuantumWavePanel from "./QuantumWavePanel"
import GridPerformancePanel from "./grid/GridPerformancePanel"
import AMMPoolStatus from "./AMMPoolStatus"
import AMMPoolCirBTC from "./AMMPoolCirBTC"
import ContractRegistryStatus from "./ContractRegistryStatus"
import NivelAutonomiaStatus from "./NivelAutonomiaStatus"
import TimingOptimizerStatus from "./TimingOptimizerStatus"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import type { NetworkKey } from "@/lib/real-swap-executor"
import type { IntentRecord } from "@/lib/agent-framework/intent-types"
import { frameworkIntents } from "@/lib/agent-framework/singletons"
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

const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "decisions", label: "Decisions" },
  { key: "proofs", label: "Proofs" },
  { key: "agents", label: "Agents" },
  { key: "architecture", label: "Architecture" },
  { key: "operator", label: "Operator" },
  { key: "ledger", label: "Ledger" },
  { key: "debug", label: "Debug" },
]

const FLOW = [
  "Identity",
  "Knowledge Service",
  "Intent",
  "Coordinator",
  "Policy Engine",
  "Voting Engine",
  "Adapter",
  "Execution",
  "Audit",
  "Decision Report",
  "DecisionAnchor",
]

function shortId(value?: string) {
  if (!value) return "none"
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function isReconciledSettlement(record: IntentRecord) {
  const execution = record.decisionReport?.execution
  if (!execution?.success || execution.isProvisional) return false
  return execution.settlementStatus === "reconciled"
}

function useFrameworkSnapshot() {
  const [records, setRecords] = useState<IntentRecord[]>([])
  const [stats, setStats] = useState(frameworkIntents.getStats())

  useEffect(() => {
    const refresh = () => {
      setRecords(frameworkIntents.list({ limit: 12 }))
      setStats(frameworkIntents.getStats())
    }
    refresh()
    return frameworkIntents.subscribe(refresh)
  }, [])

  return { records, stats }
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: DS.colors.text.muted }}>{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: DS.colors.text.primary }}>{value}</div>
      <div className="mt-1 text-xs" style={{ color: DS.colors.text.secondary }}>{detail}</div>
    </div>
  )
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold" style={{ color: DS.colors.text.primary }}>{title}</h2>
      <p className="mt-1 text-sm" style={{ color: DS.colors.text.secondary }}>{detail}</p>
    </div>
  )
}

function ArchitectureFlow({ compact = false }: { compact?: boolean }) {
  return (
    <section className="rounded-lg p-5" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="text-sm font-semibold mb-4" style={{ color: DS.colors.text.primary }}>Canonical Lifecycle</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {FLOW.map((item, index) => (
          <div key={item} className="rounded-lg px-3 py-3 text-sm" style={{ background: DS.colors.bg.hover, border: `1px solid ${DS.colors.bg.border}`, color: DS.colors.text.secondary }}>
            <span className="text-xs mr-2" style={{ color: DS.colors.text.muted }}>{index + 1}</span>{item}
          </div>
        ))}
      </div>
      {!compact && (
        <p className="mt-4 text-sm leading-6" style={{ color: DS.colors.text.secondary }}>
          Trading remains the first Adapter. Pregao is internal TradingAdapter machinery, not the architectural center.
        </p>
      )}
    </section>
  )
}

function AgentGroups() {
  const groups = [
    ["Scouts", "Arqueiro remains shadow/inert today and may become an Opportunity Scout later."],
    ["Analysts", "Technical, market, route and volatility agents focus candidate evaluation."],
    ["Validators", "Knowledge, Policy and Voting decide whether an action can proceed."],
    ["Executors", "Adapters dispatch only after approval; settlement is reconciled later."],
  ]

  return (
    <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {groups.map(([title, detail]) => (
        <div key={title} className="rounded-lg p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
          <div className="text-sm font-semibold" style={{ color: DS.colors.text.primary }}>{title}</div>
          <div className="mt-2 text-xs leading-5" style={{ color: DS.colors.text.secondary }}>{detail}</div>
        </div>
      ))}
    </section>
  )
}

function ClientOverview({ networkName, isTestnet }: { networkName: string; isTestnet: boolean }) {
  const { records, stats } = useFrameworkSnapshot()
  const latest = records[0]
  const verified = useMemo(() => records.filter(isReconciledSettlement), [records])
  const verifiedProfit = verified.reduce((sum, r) => sum + (r.decisionReport?.execution?.profit ?? 0), 0)
  const provisional = records.filter(r => r.decisionReport?.execution?.isProvisional).length
  const reports = records.filter(r => r.decisionReport).length
  const anchors = records.filter(r => r.decisionReport?.onChainStatus === "confirmed" && isReconciledSettlement(r)).length

  return (
    <div className="space-y-6">
      <section className="rounded-lg p-6 md:p-8" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="max-w-4xl">
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#3b82f6" }}>
            Ambiente: {isTestnet ? "Arc Testnet / test environments" : networkName}
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold leading-tight" style={{ color: DS.colors.text.primary }}>
            ArcFlow coordinates economic agents with policy, voting, audit, and proof.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6" style={{ color: DS.colors.text.secondary }}>
            Autonomous decisions enter through the Coordinator, pass Knowledge, Policy and Voting, then dispatch through an Adapter. Execution is provisional until settlement is verified.
          </p>
          <div className="mt-5 rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.25)", color: DS.colors.text.primary }}>
            ArcFlow nao comemora execucao. ArcFlow so confia em liquidacao verificada.
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="System status" value="Guarded" detail="Knowledge, Policy and Voting gates enabled" />
        <MetricCard label="Current decisions" value={stats.total} detail={`${stats.rejected} rejected, ${stats.approved} approved/executing`} />
        <MetricCard label="Lucro verificado" value={`$${verifiedProfit.toFixed(2)}`} detail="Only reconciled settlement counts" />
        <MetricCard label="Dispatched / provisional" value={provisional} detail="Awaiting settlement reconciliation" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg p-5" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: DS.colors.text.primary }}>Current Decision</div>
          {latest ? (
            <div className="space-y-2 text-sm" style={{ color: DS.colors.text.secondary }}>
              <div className="flex justify-between gap-4"><span>Intent</span><span>{shortId(latest.intent.id)}</span></div>
              <div className="flex justify-between gap-4"><span>Action</span><span>{latest.intent.action}</span></div>
              <div className="flex justify-between gap-4"><span>Status</span><span>{latest.status}</span></div>
              <div className="flex justify-between gap-4"><span>Settlement</span><span>{latest.decisionReport?.execution?.settlementStatus ?? "not available"}</span></div>
            </div>
          ) : (
            <div className="text-sm" style={{ color: DS.colors.text.muted }}>Waiting for the next autonomous proposal.</div>
          )}
        </div>

        <div className="rounded-lg p-5" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: DS.colors.text.primary }}>Proofs Preview</div>
          <div className="space-y-2 text-sm" style={{ color: DS.colors.text.secondary }}>
            <div className="flex justify-between gap-4"><span>Decision Reports</span><span>{reports}</span></div>
            <div className="flex justify-between gap-4"><span>Canonical anchors</span><span>{anchors}</span></div>
            <div className="flex justify-between gap-4"><span>Anchor rule</span><span>final report hash only</span></div>
            <div className="text-xs pt-2" style={{ color: DS.colors.text.muted }}>
              Synthetic or provisional dispatches are not presented as verified settlement.
            </div>
          </div>
        </div>
      </section>

      <ArchitectureFlow compact />
      <AgentGroups />
    </div>
  )
}

function ProofsSection() {
  const { records } = useFrameworkSnapshot()

  return (
    <div className="space-y-4">
      <SectionHeader title="Proofs" detail="Decision Reports and DecisionAnchor are proof layers. Provisional dispatch is not final settlement proof." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard label="Reports tracked" value={records.filter(r => r.decisionReport).length} detail="Runtime DecisionReport records" />
        <MetricCard label="Canonical anchors" value={records.filter(r => r.decisionReport?.onChainStatus === "confirmed" && isReconciledSettlement(r)).length} detail="Anchored reconciled reports only" />
        <MetricCard label="Pending settlement" value={records.filter(r => r.decisionReport?.execution?.isProvisional).length} detail="Dispatched but not reconciled" />
      </div>
    </div>
  )
}

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
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 pt-4 pb-8">
        <SectionContext.Provider value={{ section }}>
          {section === "overview" && <ClientOverview networkName={networkName} isTestnet={isTestnet} />}

          {section === "decisions" && (
            <div className="space-y-4">
              <SectionHeader title="Decisions" detail="Autonomous proposals, rejections and provisional dispatches flowing through the Coordinator." />
              <DecisionFeed />
            </div>
          )}

          {section === "proofs" && <ProofsSection />}

          {section === "agents" && (
            <div className="space-y-4">
              <SectionHeader title="Agents" detail="Agent groups and current coordination roles without exposing full builder internals." />
              <AgentGroups />
            </div>
          )}

          {section === "architecture" && (
            <div className="space-y-4">
              <SectionHeader title="Architecture" detail="The canonical ArcFlow lifecycle and component boundaries." />
              <ArchitectureFlow />
            </div>
          )}

          {section === "operator" && (
            <div className="space-y-6">
              <SectionHeader title="Operator" detail="Runtime operations, wallet tools, active orders and manual controls." />
              <ActiveTrades />
              {children}
            </div>
          )}

          {section === "ledger" && (
            <div className="space-y-6">
              <SectionHeader title="Local Ledger" detail="Local and legacy records. These are not reconciled settlement, verified profit, or on-chain proof." />
              <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.28)", color: DS.colors.text.primary }}>
                Dados locais/legados. Nao representam settlement reconciliado, lucro verificado ou prova on-chain.
              </div>
              {children}
            </div>
          )}

          {section === "debug" && (
            <div className="space-y-6">
              <SectionHeader title="Debug" detail="Raw builder internals, pool state, registry details and technical diagnostics." />
              <QuantumWavePanel />
              <GridPerformancePanel currentNetworkKey={currentNetworkKey} />
              {currentNetworkKey === "arc" && <AMMPoolStatus />}
              {currentNetworkKey === "arc" && <AMMPoolCirBTC />}
              <ContractRegistryStatus network={currentNetworkKey} />
              <AgentGrid />
              <NivelAutonomiaStatus />
              <TimingOptimizerStatus />
              {children}
            </div>
          )}
        </SectionContext.Provider>
      </main>

      <footer className="border-t py-3 text-center text-[10px]"
        style={{ borderColor: DS.colors.bg.border, color: DS.colors.text.muted, background: DS.colors.bg.DEFAULT }}>
        ArcFlow | Ambiente: {isTestnet ? "Testnet" : "Production network"} | {networkName}
      </footer>
    </div>
  )
}
