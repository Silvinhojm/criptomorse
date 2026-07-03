"use client"

import { useState, useEffect, useCallback } from "react"
import { backpackScanner, type BackpackSignal } from "@/lib/marketData/BackpackScanner"
import { isUSStockMarketOpen, getNYSEtatHour } from "@/lib/marketData/marketHours"
import { DESIGN_SYSTEM as DS } from "@/constants/design-system"

export function BackpackSignalsPanel() {
  const [signals, setSignals] = useState<BackpackSignal[]>([])
  const [topSignal, setTopSignal] = useState<BackpackSignal | null>(null)
  const [scanning, setScanning] = useState(false)
  const [lastUpdate, setLastUpdate] = useState("")
  const [marketOpen, setMarketOpen] = useState(isUSStockMarketOpen())
  const [nyTime, setNyTime] = useState(getNYSEtatHour())

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await backpackScanner.scan(true)
      setSignals(result)
      setTopSignal(backpackScanner.getTopSignal())
      setLastUpdate(new Date().toLocaleTimeString())
      setMarketOpen(isUSStockMarketOpen())
      setNyTime(getNYSEtatHour())
    } catch (e) {
      console.warn('[BACKPACK] Scan failed:', e)
    }
    setScanning(false)
  }, [])

  useEffect(() => {
    handleScan()
    const interval = setInterval(handleScan, 60_000)
    return () => clearInterval(interval)
  }, [handleScan])

  const cryptoSignals = signals.filter(s => s.tipo === 'crypto')
  const stockSignals = signals.filter(s => s.tipo === 'stock')

  return (
    <div className="rounded-2xl p-4" style={{ background: DS.colors.bg.card, border: `1px solid ${DS.colors.bg.border}` }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold" style={{ color: DS.colors.text.primary }}>
          🎒 Sinais Backpack Exchange
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: DS.colors.text.muted }}>
            NYSE: {nyTime}h {marketOpen ? '🟢' : '🔴'}
          </span>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-xs px-3 py-1 rounded-lg font-medium transition-all"
            style={{
              background: scanning ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.1)",
              color: scanning ? "#93c5fd" : "#3b82f6",
            }}
          >
            {scanning ? "Escaneando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {topSignal && (
        <div className="mb-4 p-4 rounded-xl" style={{
          background: `linear-gradient(135deg, ${topSignal.direcao === 'buy' ? '#065f46' : '#7f1d1d'}, ${DS.colors.bg.card})`,
          border: `1px solid ${topSignal.direcao === 'buy' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          <p className="text-xs mb-1" style={{ color: DS.colors.text.muted }}>
            🎯 Professor recomenda:
          </p>
          <p className="text-base font-bold mb-1" style={{ color: DS.colors.text.primary }}>
            {topSignal.resumo}
          </p>
          <p className="text-xs" style={{ color: DS.colors.text.muted }}>
            Preço: ${topSignal.ultimoPreco.toFixed(2)} | 24h: {topSignal.variacao24h.toFixed(2)}% | Score: {topSignal.score}/100
          </p>
        </div>
      )}

      {!topSignal && !scanning && (
        <div className="text-center py-6 text-xs" style={{ color: DS.colors.text.muted }}>
          ⏳ Escaneando mercados... aguarde
        </div>
      )}

      {signals.length > 0 && (
        <div className="space-y-4">
          {/* Crypto section */}
          {cryptoSignals.length > 0 && (
            <div>
              <p className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: '#60a5fa' }}>
                💰 Cripto
              </p>
              <SignalTable signals={cryptoSignals} topSignal={topSignal} />
            </div>
          )}

          {/* Stocks section */}
          {stockSignals.length > 0 && (
            <div>
              <p className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: '#a78bfa' }}>
                📈 Ações Tokenizadas {marketOpen ? '🟢' : '🔴'}
              </p>
              <SignalTable signals={stockSignals} topSignal={topSignal} showMarketStatus />
            </div>
          )}

          {stockSignals.length === 0 && (
            <p className="text-[10px] py-2 text-center" style={{ color: DS.colors.text.muted }}>
              {marketOpen ? 'Nenhuma ação passou no filtro de liquidez' : '🔴 Mercado fechado — ações não escaneadas'}
            </p>
          )}
        </div>
      )}

      {lastUpdate && (
        <p className="text-[10px] mt-3 text-right" style={{ color: DS.colors.text.muted }}>
          Última atualização: {lastUpdate}
        </p>
      )}
    </div>
  )
}

function SignalTable({ signals, topSignal, showMarketStatus }: { signals: BackpackSignal[]; topSignal: BackpackSignal | null; showMarketStatus?: boolean }) {
  return (
    <div className="space-y-1">
      {signals.map((s) => (
        <div key={s.symbol} className="flex items-center justify-between py-2 px-2 rounded-lg text-xs" style={{
          background: s === topSignal ? "rgba(59,130,246,0.08)" : "transparent",
          border: s === topSignal ? `1px solid rgba(59,130,246,0.2)` : `1px solid transparent`,
        }}>
          <div className="flex items-center gap-2">
            <span className="font-bold" style={{ color: DS.colors.text.primary }}>{s.baseSymbol}</span>
            {showMarketStatus && (
              <span style={{ color: s.mercadoAberto ? '#34d399' : '#f87171', fontSize: 10 }}>
                {s.mercadoAberto ? '🟢' : '🔴'}
              </span>
            )}
          </div>
          <span style={{ color: DS.colors.text.secondary }}>
            ${s.ultimoPreco >= 1 ? s.ultimoPreco.toFixed(2) : s.ultimoPreco.toFixed(6)}
          </span>
          <span style={{ color: s.direcao === 'buy' ? '#34d399' : '#f87171', fontWeight: 600 }}>
            {s.direcao === 'buy' ? 'COMPRA' : 'VENDA'}
          </span>
          <span className="font-mono" style={{ color: s.score >= 50 ? '#34d399' : s.score >= 30 ? '#fbbf24' : '#f87171' }}>
            {s.score}
          </span>
        </div>
      ))}
    </div>
  )
}
