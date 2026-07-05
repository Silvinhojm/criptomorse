"use client"

import { useState, useEffect, useCallback } from "react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { SOLANA_CONFIG } from "@/lib/solana/config"
import type { PoolInfo, WalletSummary } from "@/lib/solana/pools"
import type { SwapQuote } from "@/lib/solana/trader"

export default function SolanaPanel() {
  const [key, setKey] = useState("")
  const [address, setAddress] = useState("")
  const [wallet, setWallet] = useState<WalletSummary | null>(null)
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [bpPrice, setBpPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState("")

  const connect = useCallback(() => {
    const trimmed = key.trim()
    if (!trimmed) { setError("Cole a private key da Solana"); return }
    try {
      const { SolanaClient } = require("@/lib/solana/client")
      setAddress("Conectado via private key")
      setConnected(true)
      setError("")
      loadData(trimmed)
    } catch {
      setError("Chave inválida")
    }
  }, [key])

  async function loadData(pk?: string) {
    setLoading(true)
    try {
      const res = await fetch("/api/solana-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "getBalance", params: [pk ? "placeholder" : SOLANA_CONFIG.tokens.USDC.address] }),
      })
      const data = await res.json()
      setPools([])
      setBpPrice(0.26)
      setWallet({ sol: 0, usdc: 0, bp: 0 })
    } catch { setError("Erro ao carregar dados Solana") }
    setLoading(false)
  }

  useEffect(() => {
    const saved = localStorage.getItem("arcflow_solana_key")
    if (saved) { setKey(saved); setConnected(true); loadData(saved) }
  }, [])

  useEffect(() => {
    if (connected) localStorage.setItem("arcflow_solana_key", key)
    else localStorage.removeItem("arcflow_solana_key")
  }, [connected, key])

  if (!connected) {
    return (
      <div className="p-4 rounded-xl max-w-md mx-auto" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">☀️</span>
          <span className="text-sm font-semibold" style={{ color: DS.colors.text.primary }}>Solana — Departamento Separado</span>
        </div>
        <div className="text-[11px] mb-3" style={{ color: DS.colors.text.muted }}>
          Módulo auto-contido. Não interfere no trading EVM.
        </div>
        <input
          type="password"
          placeholder="Private Key Solana (Base58)"
          value={key}
          onChange={e => setKey(e.target.value)}
          className="w-full p-2 rounded text-xs mb-2 font-mono"
          style={{ background: DS.colors.bg.hover, color: DS.colors.text.primary, border: `1px solid ${DS.colors.bg.border}` }}
        />
        {error && <div className="text-xs mb-2" style={{ color: DS.colors.accent.red }}>{error}</div>}
        <button
          onClick={connect}
          className="w-full py-2 rounded text-xs font-semibold"
          style={{ background: "#9945FF", color: "#fff" }}
        >
          ☀️ Conectar Solana
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">☀️</span>
          <span className="text-sm font-semibold" style={{ color: DS.colors.text.primary }}>Solana — BP/USDC</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF" }}>
            NOVO
          </span>
          <button
            onClick={() => { setConnected(false); setKey(""); setWallet(null) }}
            className="ml-auto text-[10px] px-2 py-1 rounded"
            style={{ background: DS.colors.bg.hover, color: DS.colors.text.muted }}
          >
            Desconectar
          </button>
        </div>

        {!wallet ? (
          <div className="animate-pulse h-4 w-32 rounded" style={{ background: DS.colors.bg.hover }} />
        ) : (
          <div className="grid grid-cols-3 gap-3 text-xs mb-3">
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>◎ SOL</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                {wallet.sol.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>USDC</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                ${wallet.usdc.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>BP</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                {wallet.bp.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {bpPrice && (
          <div className="text-[11px] mb-2" style={{ color: DS.colors.text.muted }}>
            BP ≈ <span style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono }}>${bpPrice.toFixed(4)}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "#9945FF", color: "#fff" }}
            onClick={async () => {
              setLoading(true)
              const q = await getSwapQuote(SOLANA_CONFIG.tokens.USDC.address, SOLANA_CONFIG.tokens.BP.address, 1000000)
              setQuote(q)
              setLoading(false)
            }}
          >
            {loading ? "..." : "Cotar swap USDC→BP"}
          </button>
        </div>

        {quote && (
          <div className="mt-3 p-2 rounded text-xs font-mono" style={{ background: DS.colors.bg.hover }}>
            <div style={{ color: DS.colors.text.muted }}>1 USDC → {quote.outAmount.toFixed(4)} BP</div>
            <div style={{ color: DS.colors.text.muted }}>Rota: {quote.route}</div>
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="text-xs font-semibold mb-2" style={{ color: DS.colors.text.primary }}>📋 Pools Disponíveis</div>
        {SOLANA_CONFIG.pools.map(p => (
          <div key={p.label} className="text-xs py-1 flex justify-between" style={{ color: DS.colors.text.muted }}>
            <span>{p.label}</span>
            <span style={{ color: DS.colors.text.primary }}>{p.dex}</span>
          </div>
        ))}
        <div className="text-[10px] mt-2" style={{ color: DS.colors.text.muted }}>
          ⚡ Criar pool via Jupiter/Raydium em breve
        </div>
      </div>
    </div>
  )
}

async function getSwapQuote(input: string, output: string, amount: number): Promise<SwapQuote> {
  try {
    const res = await fetch(`/api/solana-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jupiter: `quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=50` }),
    })
    const data = await res.json()
    return { inAmount: amount, outAmount: Number(data.outAmount) / 1e6, route: "Jupiter", priceImpact: data.priceImpactPct ?? 0 }
  } catch {
    return { inAmount: amount, outAmount: 0, route: "erro", priceImpact: 0 }
  }
}
