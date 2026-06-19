"use client"

import { useState, useEffect } from "react"
import { realSwap, NETWORKS, type NetworkKey } from "@/lib/real-swap-executor"
import { X, Copy, ExternalLink, Wallet } from "lucide-react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

type Props = {
  open: boolean
  onClose: () => void
}

export default function DrawerWallet({ open, onClose }: Props) {
  const [balances, setBalances] = useState<{ network: string; tokens: { symbol: string; balance: number }[] }[]>([])

  useEffect(() => {
    if (!open) return
    const carregar = async () => {
      const result: typeof balances = []
      for (const [key, net] of Object.entries(NETWORKS)) {
        try {
          await realSwap.switchNetwork(key as NetworkKey)
          const allBal = realSwap.getAllBalances()
          result.push({
            network: net.name,
            tokens: allBal.filter(b => b.balance > 0.001).map(b => ({ symbol: b.symbol, balance: b.balance })),
          })
        } catch { /* skip */ }
      }
      setBalances(result)
    }
    carregar()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm h-full overflow-y-auto"
        style={{ background: DS.colors.bg.DEFAULT, borderLeft: `1px solid ${DS.colors.bg.border}` }}
        onClick={e => e.stopPropagation()}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Wallet size={18} style={{ color: DS.colors.accent.blue }} />
              <span className="font-bold text-sm" style={{ color: DS.colors.text.primary }}>Cofre</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-md transition-colors hover:bg-white/10">
              <X size={16} style={{ color: DS.colors.text.secondary }} />
            </button>
          </div>

          <div className="mb-4 p-3 rounded-lg" style={{ background: DS.colors.bg.card }}>
            <div className="text-[11px] mb-1" style={{ color: DS.colors.text.muted }}>Carteira</div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono" style={{ color: DS.colors.text.primary }}>
                {realSwap.getAddress()?.slice(0, 6)}...{realSwap.getAddress()?.slice(-4)}
              </span>
              <button onClick={() => { navigator.clipboard.writeText(realSwap.getAddress() ?? "") }}
                className="p-1 rounded transition-colors hover:bg-white/10">
                <Copy size={12} style={{ color: DS.colors.text.muted }} />
              </button>
              <a href={`https://polygonscan.com/address/${realSwap.getAddress()}`} target="_blank" rel="noopener noreferrer"
                className="p-1 rounded transition-colors hover:bg-white/10">
                <ExternalLink size={12} style={{ color: DS.colors.text.muted }} />
              </a>
            </div>
          </div>

          {balances.map((net) => (
            <div key={net.network} className="mb-3 p-3 rounded-lg" style={{ background: DS.colors.bg.card }}>
              <div className="text-[11px] font-medium mb-2" style={{ color: DS.colors.text.secondary }}>
                {net.network}
              </div>
              {net.tokens.length === 0 ? (
                <div className="text-[11px]" style={{ color: DS.colors.text.muted }}>Nenhum saldo</div>
              ) : (
                net.tokens.map(t => (
                  <div key={t.symbol} className="flex items-center justify-between py-1">
                    <span className="text-xs font-mono" style={{ color: DS.colors.text.primary }}>{t.symbol}</span>
                    <span className="text-xs font-mono" style={{ color: DS.colors.accent.green }}>
                      {t.balance.toFixed(4)}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
