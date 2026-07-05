"use client"

import { useState, useEffect, useCallback } from "react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"
import { SOLANA_CONFIG } from "@/lib/solana/config"
import type { SwapQuote } from "@/lib/solana/trader"

const proxyFetch = async (method: string, params: unknown[]) => {
  const res = await fetch("/api/solana-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  })
  return res.json()
}

async function fetchTokenBalance(address: string, mint: string): Promise<number> {
  try {
    const data = await proxyFetch("getTokenAccountsByOwner", [
      address, { mint }, { encoding: "jsonParsed" },
    ])
    if (!data?.result?.value?.length) return 0
    const info = data.result.value[0].account.data.parsed.info
    return Number(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals)
  } catch { return 0 }
}

async function fetchSolBalance(address: string): Promise<number> {
  try {
    const data = await proxyFetch("getBalance", [address])
    return (data?.result ?? 0) / 1e9
  } catch { return 0 }
}

async function fetchJupiterQuote(input: string, output: string, amountRaw: number): Promise<SwapQuote | null> {
  try {
    const res = await fetch(`/api/solana-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jupiter: `quote?inputMint=${input}&outputMint=${output}&amount=${amountRaw}&slippageBps=50` }),
    })
    const data = await res.json()
    if (!data?.outAmount) return null
    return {
      inAmount: amountRaw,
      outAmount: Number(data.outAmount) / 1e6,
      route: data.routePlan?.map((r: any) => r.swapInfo?.label ?? "?").join(" → ") ?? "Jupiter",
      priceImpact: data.priceImpactPct ?? 0,
    }
  } catch { return null }
}

export default function SolanaPanel() {
  const [address, setAddress] = useState("")
  const [inputAddr, setInputAddr] = useState("")
  const [solBal, setSolBal] = useState<number | null>(null)
  const [usdcBal, setUsdcBal] = useState<number | null>(null)
  const [bpBal, setBpBal] = useState<number | null>(null)
  const [bpPrice, setBpPrice] = useState<number | null>(null)
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const loadBalances = useCallback(async (addr: string) => {
    setLoading(true)
    setError("")
    try {
      const [sol, usdc, bp] = await Promise.all([
        fetchSolBalance(addr),
        fetchTokenBalance(addr, SOLANA_CONFIG.tokens.USDC.address),
        fetchTokenBalance(addr, SOLANA_CONFIG.tokens.BP.address),
      ])
      setSolBal(sol)
      setUsdcBal(usdc)
      setBpBal(bp)
      // Tenta cotar BP price (1 USDC → BP)
      const q = await fetchJupiterQuote(SOLANA_CONFIG.tokens.USDC.address, SOLANA_CONFIG.tokens.BP.address, 1_000_000)
      if (q && q.outAmount > 0) setBpPrice(1 / q.outAmount)
    } catch {
      setError("Erro ao consultar saldos Solana")
    }
    setLoading(false)
  }, [])

  const connect = useCallback(() => {
    const trimmed = inputAddr.trim()
    if (!trimmed || trimmed.length < 32) {
      setError("Endereço Solana inválido — deve ter ~44 caracteres Base58")
      return
    }
    setAddress(trimmed)
    localStorage.setItem("arcflow_solana_address", trimmed)
    loadBalances(trimmed)
  }, [inputAddr, loadBalances])

  useEffect(() => {
    const saved = localStorage.getItem("arcflow_solana_address")
    if (saved) { setAddress(saved); setInputAddr(saved); loadBalances(saved) }
  }, [loadBalances])

  if (!address) {
    return (
      <div className="p-4 rounded-xl max-w-md mx-auto" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">☀️</span>
          <span className="text-sm font-semibold" style={{ color: DS.colors.text.primary }}>Solana — BP/USDC</span>
        </div>
        <div className="text-[11px] mb-3 space-y-1" style={{ color: DS.colors.text.muted }}>
          <p>Cole seu endereço público Solana para consultar saldos e cotações.</p>
          <p>Token BP: <code style={{ fontSize: 9 }}>{SOLANA_CONFIG.tokens.BP.address.slice(0, 8)}...{SOLANA_CONFIG.tokens.BP.address.slice(-4)}</code></p>
        </div>
        <input
          type="text"
          placeholder="Endereço Solana (ex: GxT7...)"
          value={inputAddr}
          onChange={e => setInputAddr(e.target.value)}
          className="w-full p-2 rounded text-xs mb-2 font-mono"
          style={{ background: DS.colors.bg.hover, color: DS.colors.text.primary, border: `1px solid ${DS.colors.bg.border}` }}
        />
        {error && <div className="text-xs mb-2" style={{ color: DS.colors.accent.red }}>{error}</div>}
        <button onClick={connect} className="w-full py-2 rounded text-xs font-semibold" style={{ background: "#9945FF", color: "#fff" }}>
          ☀️ Consultar Carteira
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
          <button onClick={() => { setAddress(""); localStorage.removeItem("arcflow_solana_address") }}
            className="ml-auto text-[10px] px-2 py-1 rounded" style={{ background: DS.colors.bg.hover, color: DS.colors.text.muted }}>
            Desconectar
          </button>
        </div>

        <div className="text-[10px] font-mono mb-3 truncate" style={{ color: DS.colors.text.muted }}>
          {address.slice(0, 8)}...{address.slice(-4)}
        </div>

        {loading ? (
          <div className="animate-pulse h-12 rounded" style={{ background: DS.colors.bg.hover }} />
        ) : (
          <div className="grid grid-cols-3 gap-3 text-xs mb-3">
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>◎ SOL</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                {solBal !== null ? solBal.toFixed(4) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>USDC</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                {usdcBal !== null ? `$${usdcBal.toFixed(2)}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>BP</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
                {bpBal !== null ? bpBal.toFixed(2) : "—"}
              </div>
            </div>
          </div>
        )}

        {bpPrice !== null && (
          <div className="text-[11px] mb-2" style={{ color: DS.colors.text.muted }}>
            BP ≈ <span style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono }}>${bpPrice.toFixed(4)}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "#9945FF", color: "#fff" }}
            onClick={async () => {
              setLoading(true)
              setQuote(await fetchJupiterQuote(SOLANA_CONFIG.tokens.USDC.address, SOLANA_CONFIG.tokens.BP.address, 1_000_000))
              setLoading(false)
            }}
          >
            {loading ? "..." : "Cotar swap 1 USDC → BP"}
          </button>
          <button className="py-2 px-3 rounded text-xs" style={{ background: DS.colors.bg.hover, color: DS.colors.text.primary }}
            onClick={() => loadBalances(address)}>
            🔄
          </button>
        </div>

        {quote && (
          <div className="mt-3 p-2 rounded text-xs font-mono" style={{ background: DS.colors.bg.hover }}>
            <div style={{ color: DS.colors.text.muted }}>1 USDC → <span style={{ color: "#22c55e" }}>{quote.outAmount.toFixed(4)} BP</span></div>
            <div style={{ color: DS.colors.text.muted }}>Rota: {quote.route}</div>
            {quote.priceImpact > 0 && (
              <div style={{ color: quote.priceImpact > 5 ? "#ef4444" : "#94a3b8" }}>
                Impacto: {quote.priceImpact.toFixed(2)}%
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
        <div className="text-xs font-semibold mb-2" style={{ color: DS.colors.text.primary }}>📋 Pool USDC/BP</div>
        <div className="text-xs space-y-1" style={{ color: DS.colors.text.muted }}>
          <p>DEX: Jupiter agregador (Raydium + Orca)</p>
          <p>BP: <code style={{ fontSize: 9 }}>{SOLANA_CONFIG.tokens.BP.address.slice(0, 12)}...</code></p>
          <p>USDC Solana: <code style={{ fontSize: 9 }}>{SOLANA_CONFIG.tokens.USDC.address.slice(0, 12)}...</code></p>
        </div>
        <div className="text-[10px] mt-2" style={{ color: "#94a3b8" }}>
          ⚡ Para executar swap real, será necessário adicionar private key (em breve)
        </div>
      </div>
    </div>
  )
}
