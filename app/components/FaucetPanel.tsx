"use client"

import { useState, useEffect, useCallback } from "react"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

type NetworkConfig = {
  label: string
  faucetUrl: string
  tokens: string
  blockchain: string
}

const FAUCET_NETWORKS: Record<string, NetworkConfig> = {
  arc: {
    label: "Arc Testnet",
    faucetUrl: "https://faucet.circle.com",
    tokens: "ARC (gás), USDC, EURC, cirBTC",
    blockchain: "ARC-TESTNET",
  },
  sepolia: {
    label: "Ethereum Sepolia",
    faucetUrl: "https://faucet.circle.com",
    tokens: "ETH (gás), USDC, EURC",
    blockchain: "ETH-SEPOLIA",
  },
}

export default function FaucetPanel({ rede }: { rede: string }) {
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)

  const cfg = FAUCET_NETWORKS[rede]

  useEffect(() => {
    fetch("/api/faucet")
      .then(r => r.json().then(d => { if (d.configured) setHasApiKey(true) }))
      .catch(() => {})
  }, [])

  // try to read wallet address from common sources
  const [address, setAddress] = useState("")
  useEffect(() => {
    const stored = localStorage.getItem("arcflow_wallet_address")
    if (stored) setAddress(stored)
  }, [])

  const copyAddress = useCallback(() => {
    if (!address) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [address])

  const claimTokens = useCallback(async () => {
    if (claiming || !cfg || !address) return
    setClaiming(true)
    setResult(null)
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, blockchain: cfg.blockchain }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResult("✅ Tokens solicitados! Chegam em segundos.")
      } else {
        setResult(`❌ ${data.error || "Erro desconhecido"}`)
      }
    } catch (e: any) {
      setResult(`❌ Erro de rede: ${e.message}`)
    } finally {
      setClaiming(false)
    }
  }, [claiming, cfg, address])

  if (!rede || !FAUCET_NETWORKS[rede]) {
    return (
      <div style={{ padding: 16, color: DS.colors?.text?.secondary ?? '#94a3b8', fontSize: 13 }}>
        🚰 Faucet disponível apenas em redes testnet (Arc, Sepolia).
      </div>
    )
  }

  return (
    <div style={{
      padding: 16,
      borderRadius: 8,
      border: `1px solid ${DS.colors.bg.border ?? '#1e293b'}`,
      background: DS.colors.bg.card ?? '#0f172a',
      fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
        🚰 Faucet — {cfg.label}
      </div>

      <div style={{ marginBottom: 12, color: DS.colors.text.secondary ?? '#94a3b8' }}>
        {cfg.tokens}
      </div>

      {address && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <code style={{
            background: '#1e293b', padding: '4px 8px', borderRadius: 4,
            fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{address}</code>
          <button onClick={copyAddress} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            color: DS.colors.accent.blue ?? '#3b82f6',
          }}>
            {copied ? '✅' : '📋'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a href={cfg.faucetUrl} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'block', padding: '10px 16px', borderRadius: 6,
            background: DS.colors.accent.blue ?? '#3b82f6', color: '#fff',
            textAlign: 'center', fontWeight: 500, fontSize: 13,
            textDecoration: 'none',
          }}>
          Abrir Faucet Público ↗
        </a>

        <button onClick={claimTokens} disabled={claiming || !address}
          style={{
            padding: '10px 16px', borderRadius: 6, border: `1px solid ${DS.colors.bg.border ?? '#334155'}`,
            background: claiming ? '#1e293b' : 'transparent', color: '#fff',
            cursor: claiming ? 'wait' : 'pointer', fontWeight: 500, fontSize: 13,
            opacity: !address ? 0.5 : 1,
          }}>
          {claiming ? 'Reivindicando...' : hasApiKey ? 'Reivindicar Automático' : 'API Key não configurada'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: '#1e293b', fontSize: 12 }}>
          {result}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: DS.colors.text.secondary ?? '#64748b' }}>
        Limite: 20 USDC / 20 EURC / nativo a cada 2h por par (endereço + rede).
        <br />
        Para recargas frequentes, configure <code style={{ fontSize: 10 }}>CIRCLE_API_KEY</code> no .env.local.
      </div>
    </div>
  )
}
