"use client"

import { useState, useEffect } from "react"
import { contractRegistry, type ContractInfo } from "@/lib/contract-registry"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import type { NetworkKey } from "@/lib/real-swap-executor"

const ARC_RPC = "https://rpc.testnet.arc.network"

export default function ContractRegistryStatus({ network }: { network?: NetworkKey }) {
  const [contracts, setContracts] = useState<ContractInfo[]>([])
  const [reserves, setReserves] = useState<Record<string, { reserve0: string; reserve1: string; paused: boolean }>>({})

  useEffect(() => {
    const deployed = contractRegistry.getDeployed(network)
    setContracts(deployed)

    async function fetchAMMs() {
      const amms = deployed.filter(c => c.tags.includes("amm"))
      const results: Record<string, any> = {}
      for (const c of amms) {
        const r = await contractRegistry.getAMMReserves(c.address, ARC_RPC)
        if (r) {
          results[c.address] = {
            reserve0: (Number(r.reserve0) / 1e6).toFixed(2),
            reserve1: (Number(r.reserve1) / 1e6).toFixed(2),
            paused: r.paused,
          }
        }
      }
      setReserves(results)
    }

    fetchAMMs()
    const t = setInterval(fetchAMMs, 60000)
    return () => clearInterval(t)
  }, [network])

  if (contracts.length === 0) return null

  return (
    <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">📜</span>
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>
          Contratos Inteligentes
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(200,200,255,0.12)", color: DS.colors.text.muted }}>
          {contracts.length} contratos
        </span>
      </div>

      <div className="space-y-2">
        {contracts.map(c => (
          <div key={`${c.network}-${c.address}`} className="p-2.5 rounded-lg text-xs"
            style={{ background: DS.colors.bg.hover, border: `1px solid ${DS.colors.bg.border}` }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold" style={{ color: DS.colors.text.primary }}>{c.name}</span>
                <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
                  {c.symbol}
                </span>
              </div>
              {c.tags.includes("nao-deployado") ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,200,0,0.15)", color: "#f59e0b" }}>
                  ⏳ não deployado
                </span>
              ) : c.address && (
                <a href={c.explorerUrl} target="_blank"
                  className="hover:underline font-mono text-[10px]"
                  style={{ color: DS.colors.accent.blue }}>
                  {c.address.slice(0, 10)}...{c.address.slice(-4)}
                </a>
              )}
            </div>

            <div className="text-[10px] leading-relaxed mb-1" style={{ color: DS.colors.text.muted }}>
              {c.description}
            </div>

            {reserves[c.address] && (
              <div className="grid grid-cols-3 gap-2 mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${DS.colors.bg.border}` }}>
                <div>
                  <span className="text-[9px]" style={{ color: DS.colors.text.muted }}>USDC</span>
                  <div style={{ fontFamily: DS.fonts.mono, fontWeight: 600, color: DS.colors.text.primary }}>
                    {reserves[c.address].reserve0}
                  </div>
                </div>
                <div>
                  <span className="text-[9px]" style={{ color: DS.colors.text.muted }}>EURC</span>
                  <div style={{ fontFamily: DS.fonts.mono, fontWeight: 600, color: DS.colors.text.primary }}>
                    {reserves[c.address].reserve1}
                  </div>
                </div>
                <div>
                  <span className="text-[9px]" style={{ color: DS.colors.text.muted }}>Status</span>
                  <div style={{ color: reserves[c.address].paused ? DS.colors.accent.red : DS.colors.accent.green }}>
                    {reserves[c.address].paused ? "⏸️ Pausado" : "✅ Ativo"}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-1 mt-1.5 flex-wrap">
              {c.tags.filter(t => t !== c.network).map(t => (
                <span key={t} className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(200,200,255,0.08)", color: DS.colors.text.muted }}>
                  #{t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}