"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { pregão, type OrdemExecucao, type CashBoxState } from "@/lib/pregão"
import { escriturário } from "@/lib/escriturario"
import { corretor } from "@/lib/corretor"
// Display-only constant avoids static import of pregueiro.ts (HMR bug)
const PREGUEIROS_DISPLAY = [
  { config: { nome: "Tendência", icone: "📈", cor: "#a78bfa" } },
  { config: { nome: "Volume", icone: "📊", cor: "#f97316" } },
  { config: { nome: "Sentimento", icone: "🧠", cor: "#22c55e" } },
  { config: { nome: "Tático", icone: "⚡", cor: "#fbbf24" } },
]
import { NETWORKS, realSwap, isStable } from "@/lib/real-swap-executor"
import type { NetworkKey } from "@/lib/real-swap-executor"
import { caixa } from "@/lib/caixa"
import { resumeFromPanic, setTestnetMode } from "@/lib/circuit-breaker"
import { AGENTES_NOMES, AGENTE_CORES, getPregãoAllowedBalance, setPregãoAllowedBalance } from "@/lib/agentes-do-pregão"
import { positionManager } from "@/lib/position-manager"
import { narrador } from "@/lib/narrator"

const COR_PREGÃO = "#d4a574"
const COR_FUNDO = "#0f172a"

function tempoRelativo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return `há ${Math.floor(diff / 1000)}s`
  if (diff < 3600000) return `há ${Math.floor(diff / 60000)}min`
  return `há ${Math.floor(diff / 3600000)}h`
}

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
  const [nativeBalance, setNativeBalance] = useState(0)
  const [nativeSymbol, setNativeSymbol] = useState("")
  const [allowedBalance, setAllowedBalance] = useState(() => {
    const v = getPregãoAllowedBalance()
    return v === Infinity ? 15 : v
  })
  const logRef = useRef<HTMLDivElement>(null)
  const cicloRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [cicloAtivo, setCicloAtivo] = useState(false)
  const [cicloIntervalo, setCicloIntervalo] = useState(10)
  const [openPositions, setOpenPositions] = useState(0)
  const redeRef = useRef(rede)
  const balanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`])
    if (msg.includes("✅ ORDEM CONCLUÍDA")) {
      const m = msg.match(/ORDEM CONCLUÍDA: (\S+) \|.*Lucro: \$([-\d.]+)/)
      if (m) narrador.ordemExecutada(m[1], parseFloat(m[2]))
    } else if (msg.includes("🚫 Confiança")) {
      narrador.confiançaBaixa()
    } else if (msg.includes("Saldo stable") && msg.includes("abaixo do mínimo")) {
      const m = msg.match(/Saldo stable \$([\d.]+)/)
      if (parseFloat(m?.[1] ?? "99") < 5) narrador.saldoBaixo("Polygon")
    } else if (msg.includes("Usando Caixa Livre")) {
      const m = msg.match(/Caixa Livre: \$([\d.]+)/)
      if (m) narrador.caixaLivre("testnet", parseFloat(m[1]))
    }
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

    pregão.onOrdem(async (ordem) => {
      setOrdens([...pregão.getTodasOrdens()])
      setStatus(pregão.getStatus())
      if (ordem.status === "preparando") {
        narrador.ordemGerada(ordem.par, ordem.confiancaMedia, ordem.pregueiros)
        try {
          await escriturário.prepararOrdem(ordem)
        } catch (e) {
          addLog(`❌ Erro ao preparar ordem: ${e instanceof Error ? e.message : e}`)
        }
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
    realSwap.switchNetwork(rede as NetworkKey).then(async () => {
      const walletUsdc = realSwap.getBalance("USDC")
      const eurcBal = realSwap.getBalance("EURC")
      setWalletBalance(walletUsdc)
      setNativeSymbol(netConf.nativeSymbol)
      const nativeUsd = await realSwap.refreshNativeBalance()
      setNativeBalance(nativeUsd)
      if (walletUsdc > 0) {
        setDepositAmount(Math.floor(walletUsdc).toString())
      }
      addLog(`👛 Saldo na wallet: $${walletUsdc.toFixed(2)} USDC | €${eurcBal.toFixed(2)} EURC | ⛽ $${nativeUsd.toFixed(3)} ${netConf.nativeSymbol}`)
    })

    const walletUsdc_ = realSwap.getBalance("USDC")
    const walletEurc = realSwap.getBalance("EURC")
    const walletUsdt = realSwap.getBalance("USDT")
    const walletDai  = realSwap.getBalance("DAI")
    const saldosReais: Record<string, number> = { USDC: walletUsdc_, EURC: walletEurc, USDT: walletUsdt, DAI: walletDai }
    pregão.registrarCashBox(walletUsdc_, { [rede]: saldosReais })
    setCashBox(pregão.getCashBox())
    addLog(`💼 Saldos registrados: $${walletUsdc_.toFixed(2)} USDC, €${walletEurc.toFixed(2)} EURC`)

    if (balanceTimerRef.current) clearInterval(balanceTimerRef.current)
    balanceTimerRef.current = setInterval(async () => {
      await realSwap.refreshAllBalances()
      const usdc = realSwap.getBalance("USDC")
      setWalletBalance(usdc)
      if (usdc > 0) setDepositAmount(Math.floor(usdc).toString())
      setOpenPositions(positionManager.getOpenPositions().length)
      const nativeUsd = await realSwap.refreshNativeBalance()
      setNativeBalance(nativeUsd)
      if (nativeUsd < 0.05 && nativeUsd > 0 && !netConf.isTestnet) {
        narrador.gasAlto(netConf.name, nativeUsd)
      }
      if (nativeUsd < 0.01 && !netConf.isTestnet) {
        narrador.saldoBaixo(`${netConf.name} (${netConf.nativeSymbol})`)
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
    // 🔥 Testnet (Arc) → single-network | Mainnet → multi-chain scanning
    const agenteRede = isTestnet ? redeRef.current : "all"
    resumeFromPanic()
    setTestnetMode(isTestnet)
    pregão.limparOrdensTravadas()
    addLog(`🔁 Ciclo dos Pregueiros iniciado na rede ${redeRef.current} (a cada ${cicloIntervalo}s)`)
    addLog(`🔄 Circuit breaker resetado — modo ${isTestnet ? 'testnet' : 'mainnet'}`)
    addLog(`🌐 Agentes: ${isTestnet ? `single-network (${redeRef.current})` : 'multi-chain (Base + Polygon + Arbitrum)'}`)

    try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      await executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`))
      await executarCicloAgentes(agenteRede).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`))
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
        await executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`))
        await executarCicloAgentes(agenteRede).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`))
      } catch (e) {
        addLog(`❌ Ciclo: ${e instanceof Error ? e.message : e}`)
      }
      atualizarTudo()
    }, cicloIntervalo * 1000)
  }

  const fecharPosicao = async () => {
    const posicoes = positionManager.getOpenPositions()
    if (posicoes.length === 0) {
      addLog("ℹ️ Nenhuma posição aberta para fechar")
      return
    }
    for (const pos of posicoes) {
      positionManager.closePosition(pos.id, pos.currentPrice || pos.entryPrice)
      addLog(`🔒 Posição ${pos.boughtToken} fechada manualmente`)
      const par = `${pos.boughtToken}→USDC`
      for (const nome of ["FechamentoManual", "ForcarVenda", "Cleanup"]) {
        pregão.receberOK({
          pregueiro: nome,
          rede: pos.networkKey,
          par,
          confianca: 90,
          timestamp: Date.now(),
          fromToken: pos.boughtToken,
          toToken: "USDC",
        })
      }
      addLog(`📢 3 OKs de venda injetados para ${par}`)
    }
    atualizarTudo()
  }

  const rodarUmCiclo = async () => {
    resumeFromPanic()
    pregão.limparOrdensTravadas()
    const netRede = NETWORKS[redeRef.current as NetworkKey]
    const isTestRede = netRede?.isTestnet ?? true
    const agenteRede = isTestRede ? redeRef.current : "all"
    addLog(`▶️ Ciclo manual na rede ${redeRef.current} (agentes: ${isTestRede ? redeRef.current : 'multi-chain'})`)
    try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      await executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`))
      await executarCicloAgentes(agenteRede).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`))
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
          <div style={{ fontSize: 9, color: "#94a3b8" }}>📊 Sugestões Aceitas</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#f97316" }}>{ordens.filter(o => o.status === "executando").length}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>✅ Executadas</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#22c55e" }}>{ordens.filter(o => o.status === "concluido" && o.resultado).length}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 8, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>💰 Lucro Acumulado</div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#22c55e" }}>
            ${ordens.filter(o => o.status === "concluido" && o.resultado).reduce((s, o) => s + (o.resultado?.profit ?? 0), 0).toFixed(2)}
          </div>
        </div>
      </div>

      <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>💰 SALDO DA WALLET</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, color: "#22c55e", fontWeight: "bold" }}>
              ${walletBalance.toFixed(2)} USDC
            </div>
            <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>
              {NETWORKS[rede as NetworkKey]?.name || rede}
            </div>
          </div>
          {nativeSymbol && (
            <div style={{ textAlign: "right", marginLeft: "auto" }}>
              <div style={{ fontSize: 10, color: nativeBalance < 0.05 ? "#ef4444" : "#94a3b8" }}>
                ⛽ {nativeBalance < 0.001 ? "<$0.001" : `$${nativeBalance.toFixed(3)}`} {nativeSymbol}
              </div>
              <div style={{ fontSize: 8, color: nativeBalance < 0.05 ? "#ef4444" : "#6b7280", marginTop: 1 }}>
                {nativeBalance < 0.05 ? "⚠️ Precisa recarregar gas" : "Gas disponível"}
              </div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 8 }}>
          <div style={{ fontSize: 9, color: "#d4a574", marginBottom: 4 }}>💳 SALDO PERMITIDO P/ TRADE</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" value={allowedBalance || ""}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v > 0) {
                  setAllowedBalance(v)
                  setPregãoAllowedBalance(v)
                } else {
                  setAllowedBalance(0)
                }
              }}
              placeholder="Sem limite"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 6,
                background: "#0f0f23", border: "1px solid rgba(212,165,116,0.3)",
                color: "#fff", outline: "none"
              }}
            />
            <button onClick={() => { setAllowedBalance(0); setPregãoAllowedBalance(0) }}
              style={{
                padding: "4px 10px", fontSize: 10, borderRadius: 6,
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                color: "#94a3b8", cursor: "pointer"
              }}>
              ♾️
            </button>
          </div>
          <div style={{ fontSize: 9, color: "#6b7280", marginTop: 4 }}>
            {allowedBalance > 0
                ? `Saldo máximo por sessão: $${allowedBalance.toFixed(2)} USDC`
                : "♾️ Pregão usará todo o saldo disponível (sem limite)"}
          </div>
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
        {openPositions > 0 && (
          <button onClick={fecharPosicao} style={{
            padding: "8px 12px", fontSize: 11, fontWeight: "bold",
            background: "#ef4444", color: "#fff",
            border: "none", borderRadius: 8, cursor: "pointer"
          }}>
            🔒 Fechar Posição ({openPositions})
          </button>
        )}
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
          <span>👥</span> {PREGUEIROS_DISPLAY.length + AGENTES_NOMES.length} robôs ativos
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
          {PREGUEIROS_DISPLAY.map(p => (
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
            <span>🔍</span> Robôs analisando oportunidades
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
                  {ok.total} OK{ok.total !== 1 ? "s" : ""}
                </span>
                <span style={{ color: "#6b7280", fontSize: 9 }}>
                  {ok.pregueiros.join(", ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {ordens.filter(o => o.status === "executando" || o.status === "concluido").length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <span>📜</span> Trades Executados
          </div>
          {ordens.filter(o => o.status === "executando" || o.status === "concluido").slice(-10).reverse().map((ordem, i) => {
            const fechandoPosicao = !isStable(ordem.fromToken) && isStable(ordem.toToken)
            return (
              <div key={`${ordem.id}_${i}`} style={{
                padding: "6px 8px", marginBottom: 3,
                background: ordem.status === "executando" ? "rgba(249,115,22,0.1)" : "rgba(0,0,0,0.2)",
                borderRadius: 6, fontSize: 10
              }}>
                {ordem.status === "executando" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#f97316" }}>▶️</span>
                    <span style={{ color: "#fff", fontWeight: "bold" }}>{ordem.par}</span>
                    <span style={{ color: "#f97316", fontSize: 9 }}>Sugestão aceita</span>
                    <span style={{ color: "#6b7280", fontSize: 9, marginLeft: "auto" }}>{tempoRelativo(ordem.timestamp)}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{ordem.par}</span>
                        <span style={{ color: "#6b7280", marginLeft: 6 }}>{ordem.rede}</span>
                      </div>
                    </div>
                    {ordem.resultado && (
                      <div style={{ color: ordem.resultado.profit >= 0 ? "#22c55e" : "#ef4444", fontSize: 10, marginTop: 2, fontWeight: "bold" }}>
                        {fechandoPosicao
                          ? `🔒 Fechamento · Lucro: $${ordem.resultado.profit.toFixed(4)}`
                          : `💰 ${ordem.resultado.fromAmount.toFixed(2)} executado · Lucro: $${ordem.resultado.profit.toFixed(4)}`}
                        <span style={{ color: "#6b7280", marginLeft: 8, fontWeight: "normal" }}>{tempoRelativo(ordem.timestamp)}</span>
                        {ordem.resultado.txHash && (
                          <span style={{ color: "#3b82f6", marginLeft: 6, fontWeight: "normal" }}>
                            TX: {ordem.resultado.txHash.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Item 12: Log técnico oculto por padrão */}
      <details>
        <summary style={{ fontSize: 11, color: COR_PREGÃO, marginBottom: 6, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <span>📋</span> Ver log técnico
        </summary>
        <div ref={logRef} style={{
          background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: 8,
          maxHeight: 200, overflowY: "auto", fontSize: 9, color: "#94a3b8",
          fontFamily: "monospace"
        }}>
          {logs.length === 0 ? (
            <span style={{ color: "#6b7280" }}>Aguardando atividade dos Pregueiros...</span>
          ) : (
            logs.map((log, i) => {
              const cor = log.includes("✅") || log.includes("✔️") ? "#22c55e"
                : log.includes("❌") || log.includes("⚠️") ? "#ef4444"
                : log.includes("⏳") || log.includes("⏸️") || log.includes("ℹ️") ? "#fbbf24"
                : "#94a3b8"
              return <div key={i} style={{ color: cor }}>{log}</div>
            })
          )}
        </div>
      </details>
    </div>
  )
}
