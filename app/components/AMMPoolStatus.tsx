"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

const POOL_ADDR = "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb"
const ARC_RPC = "https://rpc.testnet.arc.network"

const AMM_ABI = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]

type PoolState = {
  reserve0: string
  reserve1: string
  price: number
  slippage5: number
  loading: boolean
  error?: string
}

export default function AMMPoolStatus() {
  const [state, setState] = useState<PoolState>({ reserve0: "0", reserve1: "0", price: 0, slippage5: 0, loading: true })

  useEffect(() => {
    let cancelled = false
    async function fetchPool() {
      try {
        const provider = new ethers.JsonRpcProvider(ARC_RPC)
        const pool = new ethers.Contract(POOL_ADDR, AMM_ABI, provider)
        const r0 = await pool.reserve0()
        const r1 = await pool.reserve1()
        const price = Number(r1) / Number(r0)
        const out5 = await pool.getAmountOut("0x3600000000000000000000000000000000000000", "5000000")
        const slippage5 = ((5000000 - Number(out5)) / 5000000) * 100
        if (!cancelled) {
          setState({
            reserve0: (Number(r0) / 1e6).toFixed(2),
            reserve1: (Number(r1) / 1e6).toFixed(2),
            price,
            slippage5,
            loading: false,
          })
        }
      } catch (e: any) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: e?.message?.slice(0, 80) }))
      }
    }
    fetchPool()
    const t = setInterval(fetchPool, 15000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <div className="p-4 rounded-xl" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🔄</span>
        <span className="text-xs font-semibold" style={{ color: DS.colors.text.primary }}>AMM USDC→EURC</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(0,200,83,0.15)", color: DS.colors.accent.green }}>
          GenericAMMPair
        </span>
      </div>

      {state.loading ? (
        <div className="animate-pulse flex gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-4 w-16 rounded" style={{ background: DS.colors.bg.hover }} />)}
        </div>
      ) : state.error ? (
        <div className="text-[11px]" style={{ color: DS.colors.accent.red }}>⚠️ {state.error}</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>USDC</div>
            <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.reserve0}</div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>EURC</div>
            <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>{state.reserve1}</div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Preço</div>
            <div style={{ color: DS.colors.text.primary, fontFamily: DS.fonts.mono, fontWeight: 600 }}>
              {state.price.toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Slippage $5</div>
            <div style={{
              fontFamily: DS.fonts.mono, fontWeight: 600,
              color: state.slippage5 < 1 ? DS.colors.accent.green : DS.colors.accent.red,
            }}>
              {state.slippage5.toFixed(2)}%
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-[10px]" style={{ color: DS.colors.text.muted }}>Contrato</div>
            <a href={`https://testnet.arcscan.app/address/${POOL_ADDR}`} target="_blank"
              style={{ color: DS.colors.accent.blue, fontFamily: DS.fonts.mono, fontSize: 10 }}>
              {POOL_ADDR.slice(0, 14)}...{POOL_ADDR.slice(-6)}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
