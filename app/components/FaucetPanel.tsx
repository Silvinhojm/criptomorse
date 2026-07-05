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

const TOKENS = [
  { key: "usdc", label: "USDC", default: true },
  { key: "eurc", label: "EURC", default: true },
  { key: "cirbtc", label: "cirBTC", default: true },
] as const

export default function FaucetPanel({ rede }: { rede: string }) {
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [faucetInfo, setFaucetInfo] = useState<{ configured: boolean; publicFaucet: boolean; faucetUrl: string } | null>(null)
  const [selectedTokens, setSelectedTokens] = useState<Record<string, boolean>>({
    usdc: true, eurc: true, cirbtc: true,
  })

  const cfg = FAUCET_NETWORKS[rede]

  useEffect(() => {
    fetch("/api/faucet")
      .then(r => r.json().then(setFaucetInfo))
      .catch(() => {})
  }, [])

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

  const toggleToken = (key: string) => {
    setSelectedTokens(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const claimTokens = useCallback(async () => {
    if (claiming || !cfg || !address) return
    setClaiming(true)
    setResult(null)

    // Se não tem API key mainnet, abre o faucet público direto
    if (faucetInfo && !faucetInfo.configured) {
      window.open("https://faucet.circle.com/", "_blank")
      setResult("🔄 Faucet público aberto no navegador. Selecione os tokens e resolva o captcha.")
      setClaiming(false)
      return
    }

    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          blockchain: cfg.blockchain,
          usdc: selectedTokens.usdc,
          eurc: selectedTokens.eurc,
          cirbtc: selectedTokens.cirbtc,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResult(`✅ Tokens solicitados via ${data.method === 'circle-api' ? 'API Circle' : 'faucet público'}! Chegam em segundos.`)
      } else {
        // Fallback: abre o faucet público
        window.open("https://faucet.circle.com/", "_blank")
        setResult(`⚠️ API indisponível. Faucet público aberto no navegador — resolva o captcha manualmente.`)
      }
    } catch (e: any) {
      window.open("https://faucet.circle.com/", "_blank")
      setResult(`⚠️ Erro de rede. Faucet público aberto no navegador.`)
    } finally {
      setClaiming(false)
    }
  }, [claiming, cfg, address, faucetInfo, selectedTokens])

  const claimSingle = useCallback(async (token: string) => {
    if (!cfg || !address) return
    setResult(`🔄 Solicitando ${token}...`)
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          blockchain: cfg.blockchain,
          usdc: token === 'USDC',
          eurc: token === 'EURC',
          cirbtc: token === 'CIRBTC',
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResult(`✅ ${token} solicitado!`)
      } else {
        window.open("https://faucet.circle.com/", "_blank")
        setResult(`⚠️ Abrindo faucet público para ${token}...`)
      }
    } catch {
      window.open("https://faucet.circle.com/", "_blank")
    }
  }, [cfg, address])

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

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Tokens:</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TOKENS.map(t => (
            <label key={t.key} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 4,
              background: selectedTokens[t.key] ? '#1e3a5f' : '#1e293b',
              border: `1px solid ${selectedTokens[t.key] ? '#3b82f6' : '#334155'}`,
              cursor: 'pointer', fontSize: 12,
            }}>
              <input
                type="checkbox"
                checked={selectedTokens[t.key]}
                onChange={() => toggleToken(t.key)}
                style={{ accentColor: '#3b82f6' }}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={claimTokens} disabled={claiming || !address}
          style={{
            padding: '10px 16px', borderRadius: 6,
            background: DS.colors.accent.blue ?? '#3b82f6', color: '#fff',
            textAlign: 'center', fontWeight: 500, fontSize: 13,
            border: 'none', cursor: claiming ? 'wait' : 'pointer',
            opacity: !address ? 0.5 : 1,
          }}>
          {claiming ? 'Reivindicando...' : 'Reivindicar Todos'}
        </button>

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => claimSingle('USDC')} disabled={!address}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6,
              border: '1px solid #2775CA', background: 'transparent',
              color: '#2775CA', cursor: 'pointer', fontWeight: 500, fontSize: 12,
            }}>+ USDC</button>
          <button onClick={() => claimSingle('EURC')} disabled={!address}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6,
              border: '1px solid #6CAC4B', background: 'transparent',
              color: '#6CAC4B', cursor: 'pointer', fontWeight: 500, fontSize: 12,
            }}>+ EURC</button>
          <button onClick={() => claimSingle('CIRBTC')} disabled={!address}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6,
              border: '1px solid #F7931A', background: 'transparent',
              color: '#F7931A', cursor: 'pointer', fontWeight: 500, fontSize: 12,
            }}>+ cirBTC</button>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: '#1e293b', fontSize: 12 }}>
          {result}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: DS.colors.text.secondary ?? '#64748b' }}>
        Limite: 20 USDC / 20 EURC / 20 cirBTC a cada 2h por par (endereço + rede).
        <br />
        {faucetInfo?.configured
          ? `✅ API Circle configurada (mainnet).`
          : `🔑 API key sandbox detectada. Faucet público abrirá automaticamente no navegador.`}
        <br />
        <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer"
          style={{ color: DS.colors.accent.blue ?? '#3b82f6' }}>
          Abrir Faucet Público ↗
        </a>
      </div>
    </div>
  )
}
