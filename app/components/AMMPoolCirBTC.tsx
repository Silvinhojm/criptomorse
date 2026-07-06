"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const POOL_ADDR = "0x8cdc84f93F6a5413667354F8fB516959D682423c"
const ARC_RPC = "https://rpc.testnet.arc.network"
const USDC = "0x3600000000000000000000000000000000000000"
const CIRBTC = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"

const POOL_ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]

type PoolState = {
  reserve0: string
  reserve1: string
  price: string
  priceLabel: string
  swapOut5: string
  loading: boolean
  error?: string
}

type RecentSwap = {
  hash: string
  from: string
  value: string
  timestamp: string
}

export default function AMMPoolCirBTC() {
  const [state, setState] = useState<PoolState>({ reserve0: "0", reserve1: "0", price: "0", priceLabel: "—", swapOut5: "—", loading: true })
  const [swaps, setSwaps] = useState<RecentSwap[]>([])

  useEffect(() => {
    let cancelled = false
    async function fetchPool() {
      try {
        const provider = new ethers.JsonRpcProvider(ARC_RPC)
        const pool = new ethers.Contract(POOL_ADDR, POOL_ABI, provider)
        const [r0, r1] = await Promise.all([pool.reserve0(), pool.reserve1()])
        const r0f = Number(ethers.formatUnits(r0, 6))
        const r1f = Number(ethers.formatUnits(r1, 8))
        const btcPrice = r0f > 0 ? (r1f > 0 ? (r0f / r1f) : 0) : 0
        let out5 = "—"
        try {
          const amtIn = ethers.parseUnits("5", 6)
          const o = await pool.getAmountOut(USDC, amtIn)
          out5 = ethers.formatUnits(o, 8)
        } catch {}
        if (!cancelled) {
          setState({
            reserve0: r0f.toFixed(2),
            reserve1: r1f.toFixed(6),
            price: btcPrice.toFixed(2),
            priceLabel: btcPrice > 0 ? `1 cirBTC ≈ $${(btcPrice).toLocaleString()}` : "—",
            swapOut5: out5,
            loading: false,
          })
        }
      } catch (e: any) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: e?.message?.slice(0, 80) }))
      }
    }

    async function fetchSwaps() {
      try {
        const res = await fetch(`https://testnet.arcscan.app/api/v2/addresses/${POOL_ADDR}/transactions?filter=to%7Cfrom&limit=5`)
        if (res.ok) {
          const data = await res.json()
          if (data.items) {
            const recent = data.items
              .filter((tx: any) => tx.method === "swap")
              .slice(0, 5)
              .map((tx: any) => ({
                hash: tx.hash,
                from: tx.from.hash.slice(0, 10),
                value: tx.value ? ethers.formatEther(tx.value) : "0",
                timestamp: tx.timestamp,
              }))
            setSwaps(recent)
            return
          }
        }
      } catch {
        /* ArcScan pode retornar 422 — fallback silencioso */
      }
      setSwaps([])
    }

    fetchPool()
    fetchSwaps()
    const t1 = setInterval(fetchPool, 15000)
    const t2 = setInterval(fetchSwaps, 30000)
    return () => { cancelled = true; clearInterval(t1); clearInterval(t2) }
  }, [])

  return (
    <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">₿</span>
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>AMM USDC→cirBTC</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,183,77,0.15)", color: "#FFB74D" }}>
          GenericAMMPair
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(0,200,83,0.15)", color: DS.colors.accent.green }}>
          NOVO
        </span>
      </div>

      {state.loading ? (
        <div className="animate-pulse flex gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-4 w-16 rounded" style={{ background: DS.colors.bg.hover }} />)}
        </div>
      ) : state.error ? (
        <div className="text-[11px]" style={{ color: DS.colors.accent.red }}>⚠️ {state.error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>USDC</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.reserve0}</div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>cirBTC</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.reserve1}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Preço implícito</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.priceLabel}</div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Swap 5 USDC →</div>
              <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.swapOut5} cirBTC</div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Contrato</div>
              <a href={`https://testnet.arcscan.app/address/${POOL_ADDR}`} target="_blank"
                style={{ color: DS.colors.accent.blue, fontFamily: DS.fonts.mono, fontSize: 10 }}>
                {POOL_ADDR.slice(0, 14)}...{POOL_ADDR.slice(-6)}
              </a>
            </div>
          </div>

          {swaps.length > 0 && (
            <div className="border-t pt-2" style={{ borderColor: DS.colors.bg.border }}>
              <div className="text-[10px] mb-1.5" style={{ color: DS.colors.text.muted }}>🔄 Swaps recentes</div>
              {swaps.map(s => (
                <div key={s.hash} className="flex items-center gap-2 text-[10px] py-0.5 font-mono" style={{ color: DS.colors.text.muted }}>
                  <span style={{ color: DS.colors.accent.green }}>●</span>
                  <a href={`https://testnet.arcscan.app/tx/${s.hash}`} target="_blank" style={{ color: DS.colors.accent.blue }}>
                    {s.hash.slice(0, 10)}...
                  </a>
                  <span>{new Date(s.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
