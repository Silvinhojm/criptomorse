"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { pregão, type OrdemExecucao, type CashBoxState } from "@/lib/pregão"
import { escriturário } from "@/lib/escriturario"
import { corretor } from "@/lib/corretor"
import { PREGUEIROS } from "@/lib/pregueiro"
import { NETWORKS, realSwap } from "@/lib/real-swap-executor"
import type { NetworkKey } from "@/lib/real-swap-executor"
import { caixa } from "@/lib/caixa"
import { resumeFromPanic, setTestnetMode } from "@/lib/circuit-breaker"
import { AGENTES_NOMES, AGENTE_CORES } from "@/lib/agentes-do-pregão"

const COR_PREGÃO = "#d4a574"
const COR_FUNDO = "#1a1a2e"

interface PregãoDashboardProps {
  rede: string
}

export function PregãoDashboard({ rede }: PregãoDashboardProps) {
  const [ordens, setOrdens] = useState<OrdemExecucao[]>([])
  const [oksAtivos, setOksAtivos] = useState<{ par: string; rede: string; pregueiros: string[]; total: number }[]>([])
  const [cashBox, setCashBox] = useState<CashBoxState>({ saldoUSDC: 0, saldosPorRede: {}, ultimaAtualizacao: 0 })
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState({ ordensAtivas: 0, ordensConcluidas: 0, oksPendentes: 0 })
  const [caixaAtiva, setCaixaAtiva] = useState(false)
  const [caixaSaldo, setCaixaSaldo] = useState(0)
  const [caixaDepositando, setCaixaDepositando] = useState(false)
  const [depositAmount, setDepositAmount] = useState("10")
  const [walletBalance, setWalletBalance] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const cicloRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [cicloAtivo, setCicloAtivo] = useState(false)
  const [cicloIntervalo, setCicloIntervalo] = useState(10)
  const redeRef = useRef(rede)
  const balanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    pregão.onLog(addLog)
    escriturário.onLog(addLog)
    corretor.onLog(addLog)

    pregão.onOrdem((ordem) => {
      setOrdens([...pregão.getTodasOrdens()])
      setStatus(pregão.getStatus())
      if (ordem.status === "preparando") {
        escriturário.prepararOrdem(ordem)
      }
    })

    corretor.onTrade(() => {
      setOrdens([...pregão.getTodasOrdens()])
      setStatus(pregão.getStatus())
    })

    pregão.onCashBoxChange((state) => {
      setCashBox(state)
    })
  }, [addLog])

  const atualizarCaixaSaldo = useCallback(async () => {
    const saldo = await caixa.getSaldo()
    setCaixaSaldo(saldo.totalUSD)
    pregão.atualizarUnifiedBalance(saldo.totalUSD, saldo.porRede)
  }, [])

  const initCaixa = useCallback(async () => {
    const ok = await caixa.initBrowser()
    setCaixaAtiva(ok)
    if (ok) {
      addLog("🏦 Caixa Livre (Unified Balance) conectada ao navegador")
      caixa.onLog(addLog)
      caixa.onCashBoxUpdate(atualizarCaixaSaldo)
      await atualizarCaixaSaldo()
    } else {
      addLog("ℹ️ Caixa Unified Balance não disponível — usando saldo local da wallet")
    }
  }, [addLog, atualizarCaixaSaldo])

  useEffect(() => {
    redeRef.current = rede
    const netConf = NETWORKS[rede as NetworkKey]
    if (!netConf) return

    // Trocar a rede no executor e buscar saldos reais on-chain
    realSwap.switchNetwork(rede as NetworkKey).then(() => {
      const walletUsdc = realSwap.getBalance("USDC")
      const eurcBal = realSwap.getBalance("EURC")
      setWalletBalance(walletUsdc)
      if (walletUsdc > 0) {
        setDepositAmount(Math.floor(walletUsdc).toString())
      }
      addLog(`👛 Saldo na wallet: $${walletUsdc.toFixed(2)} USDC | €${eurcBal.toFixed(2)} EURC`)
    })

    const tokens = (netConf as any).tokens || {}
    const saldos: Record<string, number> = {}
    for (const sym of Object.keys(tokens)) {
      saldos[sym] = 0
    }
    pregão.registrarCashBox(0, { [rede]: saldos })
    setCashBox(pregão.getCashBox())
    addLog(`🔗 Caixa Livre configurada para ${netConf.name} — contratos: ${Object.keys(tokens).join(", ")}`)

    if (balanceTimerRef.current) clearInterval(balanceTimerRef.current)
    balanceTimerRef.current = setInterval(async () => {
      await realSwap.refreshAllBalances()
      const usdc = realSwap.getBalance("USDC")
      if (usdc > 0) {
        setWalletBalance(usdc)
        setDepositAmount(Math.floor(usdc).toString())
      }
    }, 8000)

    initCaixa()
    return () => { if (balanceTimerRef.current) clearInterval(balanceTimerRef.current) }
  }, [rede, addLog, initCaixa])

  const depositarCaixa = async () => {
    if (caixaDepositando) return
    const amount = parseFloat(depositAmount)
    if (isNaN(amount) || amount <= 0) {
      addLog("❌ Valor inválido para depósito")
      return
    }
    setCaixaDepositando(true)
    addLog(`💳 Depositando $${amount.toFixed(2)} USDC na Caixa Livre...`)

    if (caixaAtiva) {
      const result = await caixa.depositar(redeRef.current, depositAmount)
      if (result.success) {
        addLog(`✅ Depósito concluído: ${result.txHash.slice(0, 10)}...`)
        setCaixaDepositando(false)
        await atualizarCaixaSaldo()
        return
      }
      addLog(`⚠️ Unified Balance: ${result.message}`)
    }

    addLog("💡 O saldo da wallet já está disponível — depósito no Caixa não é obrigatório")
    setCaixaDepositando(false)
  }

  const atualizarTudo = useCallback(() => {
    setOksAtivos(pregão.getOksAtivos())
    setOrdens([...pregão.getTodasOrdens()])
    setStatus(pregão.getStatus())
    setCashBox(pregão.getCashBox())
  }, [])

  const alternarCiclo = async () => {
    if (cicloAtivo) {
      if (cicloRef.current) {
        clearInterval(cicloRef.current)
        cicloRef.current = null
      }
      setCicloAtivo(false)
      addLog("⏹️ Ciclo dos Pregueiros parado")
      return
    }

    setCicloAtivo(true)
    const net = NETWORKS[redeRef.current as NetworkKey]
    const isTestnet = net?.isTestnet ?? true
    resumeFromPanic()
    setTestnetMode(isTestnet)
    pregão.limparOrdensTravadas()
    addLog(`🔁 Ciclo dos Pregueiros iniciado na rede ${redeRef.current} (a cada ${cicloIntervalo}s)`)
    addLog(`🔄 Circuit breaker resetado — modo ${isTestnet ? 'testnet' : 'mainnet'}`)

    try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      await Promise.all([
        executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`)),
        executarCicloAgentes(redeRef.current).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`)),
      ])
    } catch (e) {
      addLog(`❌ Ciclo inicial: ${e instanceof Error ? e.message : e}`)
    }
    atualizarTudo()

    cicloRef.current = setInterval(async () => {
      resumeFromPanic()
      pregão.limparOrdensTravadas()
      try {
        const { executarCicloPregueiros } = await import("@/lib/pregueiro")
        const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
        await Promise.all([
          executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`)),
          executarCicloAgentes(redeRef.current).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`)),
        ])
      } catch (e) {
        addLog(`❌ Ciclo: ${e instanceof Error ? e.message : e}`)
      }
      atualizarTudo()
    }, cicloIntervalo * 1000)
  }

  const rodarUmCiclo = async () => {
    resumeFromPanic()
    pregão.limparOrdensTravadas()
    addLog(`▶️ Ciclo manual na rede ${redeRef.current}`)
    try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      await Promise.all([
        executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`)),
        executarCicloAgentes(redeRef.current).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`)),
      ])
    } catch (e) {
      addLog(`❌ Ciclo manual: ${e instanceof Error ? e.message : e}`)
    }
    atualizarTudo()
  }

  const corStatus = (status: string) => {
    switch (status) {
      case "preparando": return "#fbbf24"
      case "pronto": return "#3b82f6"
      case "executando": return "#f97316"
      case "concluido": return "#22c55e"
      case "falhou": return "#ef4444"
      default: return "#6b7280"
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 16, background: COR_FUNDO, borderRadius: 16, border: `1px solid ${COR_PREGÃO}44` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>🏛️</span>
        <span style={{ fontWeight: "bold", color: COR_PREGÃO, fontSize: 16 }}>Pregão</span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>— Ordens</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>Ordens Ativas</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#fbbf24" }}>{status.ordensAtivas}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>Concluídas</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#22c55e" }}>{status.ordensConcluidas}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>OKs Pendentes</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: COR_PREGÃO }}>{status.oksPendentes}</div>
        </div>
      </div>

      <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>💰 SALDO DA WALLET</div>
        <div style={{ fontSize: 18, color: "#22c55e", fontWeight: "bold" }}>
          ${walletBalance.toFixed(2)} USDC
        </div>
        <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>
          {NETWORKS[rede as NetworkKey]?.name || rede}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={alternarCiclo} style={{
          flex: 1, padding: "8px 0", fontSize: 11, fontWeight: "bold",
          background: cicloAtivo ? "#ef4444" : COR_PREGÃO, color: "#fff",
          border: "none", borderRadius: 8, cursor: "pointer"
        }}>
          {cicloAtivo ? "⏹️ Parar Pregueiros" : "🏛️ Iniciar Pregueiros"}
        </button>
        <button onClick={rodarUmCiclo} style={{
          padding: "8px 12px", fontSize: 11,
          background: "rgba(255,255,255,0.1)", color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, cursor: "pointer"
        }}>
          ▶️ 1 Ciclo
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>Intervalo entre ciclos: {cicloIntervalo}s</div>
        <input type="range" min={3} max={60} step={1} value={cicloIntervalo}
          onChange={(e) => setCicloIntervalo(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span>📢</span> Pregueiros ({PREGUEIROS.length}) + Agentes ({AGENTES_NOMES.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
          {PREGUEIROS.map(p => (
            <span key={p.config.nome} style={{
              padding: "3px 8px", borderRadius: 12, fontSize: 10,
              background: `${p.config.cor}22`, color: p.config.cor,
              border: `1px solid ${p.config.cor}44`
            }}>
              {p.config.icone} {p.config.nome}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {AGENTES_NOMES.map((ag, i) => (
            <span key={ag.nome} style={{
              padding: "3px 8px", borderRadius: 12, fontSize: 10,
              background: `${AGENTE_CORES[i % AGENTE_CORES.length]}22`,
              color: AGENTE_CORES[i % AGENTE_CORES.length],
              border: `1px solid ${AGENTE_CORES[i % AGENTE_CORES.length]}44`
            }}>
              {ag.icone} {ag.nome}
            </span>
          ))}
        </div>
      </div>

      {oksAtivos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <span>👀</span> OKs Ativos no Pregão
          </div>
          {oksAtivos.map((ok, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 8px", marginBottom: 3,
              background: ok.total >= 3 ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.03)",
              borderRadius: 6, fontSize: 10
            }}>
              <div>
                <span style={{ color: "#fff", fontWeight: "bold" }}>{ok.par}</span>
                <span style={{ color: "#6b7280", marginLeft: 6 }}>{ok.rede}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: ok.total >= 3 ? "#22c55e" : COR_PREGÃO, fontWeight: "bold" }}>
                  {ok.total}/3 OK
                </span>
                <span style={{ color: "#6b7280", fontSize: 9 }}>
                  {ok.pregueiros.join(", ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {ordens.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <span>📜</span> Ordens de Execução
          </div>
          {ordens.slice(-10).reverse().map((ordem, i) => (
            <div key={`${ordem.id}_${i}`} style={{
              padding: "6px 8px", marginBottom: 3,
              background: "rgba(0,0,0,0.2)", borderRadius: 6, fontSize: 10
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ color: "#fff", fontWeight: "bold" }}>{ordem.par}</span>
                  <span style={{ color: "#6b7280", marginLeft: 6 }}>{ordem.rede}</span>
                </div>
                <span style={{
                  padding: "1px 6px", borderRadius: 8, fontSize: 9,
                  background: `${corStatus(ordem.status)}22`,
                  color: corStatus(ordem.status)
                }}>
                  {ordem.status}
                </span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 9, marginTop: 2 }}>
                {ordem.pregueiros.join(", ")} · {ordem.confiancaMedia}%
              </div>
              {ordem.resultado && (
                <div style={{ color: ordem.resultado.profit >= 0 ? "#22c55e" : "#ef4444", fontSize: 9, marginTop: 2 }}>
                  ${ordem.resultado.fromAmount.toFixed(2)} → {ordem.resultado.toAmount.toFixed(6)} · Lucro: ${ordem.resultado.profit.toFixed(4)}
                  {ordem.resultado.txHash && (
                    <span style={{ color: "#3b82f6", marginLeft: 6 }}>
                      TX: {ordem.resultado.txHash.slice(0, 8)}...
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span>📋</span> Registro do Pregão
        </div>
        <div ref={logRef} style={{
          background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: 8,
          maxHeight: 150, overflowY: "auto", fontSize: 9, color: "#94a3b8",
          fontFamily: "monospace"
        }}>
          {logs.length === 0 ? (
            <span style={{ color: "#6b7280" }}>Aguardando atividade dos Pregueiros...</span>
          ) : (
            logs.map((log, i) => <div key={i}>{log}</div>)
          )}
        </div>
      </div>
    </div>
  )
}
