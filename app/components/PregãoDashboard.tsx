"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { applyCircleProxyFix } from "@/lib/circle-proxy-fix"
applyCircleProxyFix()
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
import { AGENTES_NOMES, AGENTE_CORES, getPregãoAllowedBalance, setPregãoAllowedBalance, isPaperMode, setPaperMode } from "@/lib/agentes-do-pregão"
import { positionManager } from "@/lib/position-manager"
import { narrador } from "@/lib/narrator"
import { contratante } from "@/lib/contratante"
import { modoGrao } from "@/lib/modo-grão"
import { poolScannerExecutor } from "@/lib/pool-scanner-executor"
import { escolaRobos, MIN_JOBS_PROVA, type RoboEscolar } from "@/lib/escola-robos"
import { professor } from "@/lib/professor"
import { pairSector } from "@/lib/pair-sector"
import { StableOpportunities } from "./StableOpportunities"
import { PiEngineMonitor } from "./PiEngineMonitor"
import { ArcTrainingPanel } from "./ArcTrainingPanel"

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
  const [status, setStatus] = useState({ ordensAtivas: 0, ordensConcluidas: 0, oksPendentes: 0, sessionTrades: 0, sessionWins: 0, sessionLosses: 0, sessionProfit: 0 })
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
  const [isLoading, setIsLoading] = useState(false)
  const [stressTestKey, setStressTestKey] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("arcflow_stress_test_key") || ""
    return ""
  })
  const [stressTestResult, setStressTestResult] = useState<{ success: boolean; details?: string; results?: any[] } | null>(null)
  const [stressTestRunning, setStressTestRunning] = useState(false)
  const stressTestIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const cicloRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [cicloAtivo, setCicloAtivo] = useState(false)
  const [cicloIntervalo, setCicloIntervalo] = useState(10)
  const [openPositions, setOpenPositions] = useState(0)
  const [openPositionsData, setOpenPositionsData] = useState<ReturnType<typeof positionManager.getOpenPositions>>([])
  const [recentTrades, setRecentTrades] = useState<ReturnType<typeof positionManager.getRecentTrades>>([])
  const [contratanteState, setContratanteState] = useState(contratante.getState())
  const [contratanteAtivo, setContratanteAtivo] = useState(false)
  const [modoGraoState, setModoGraoState] = useState(modoGrao.getState())
  const [kitKey, setKitKey] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("arcflow_kit_key") ?? ""
    return ""
  })
  const contratanteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [escolaRobosData, setEscolaRobosData] = useState<RoboEscolar[]>([])
  const [professorStats, setProfessorStats] = useState({ totalPalpites: 0, pendentes: 0, ultimaAvaliacao: 0 })
  const redeRef = useRef(rede)
  const balanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processedArcTrades = useRef<Set<string>>(new Set())

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
    const AUTO_CYCLE_KEY = "arcflow_auto_ciclo"
    const disabled = localStorage.getItem(AUTO_CYCLE_KEY) === "false"
    if (disabled) return

    const addr = realSwap.getAddress()
    const pk = typeof window !== "undefined"
      ? (localStorage.getItem("arcflow_private_key") || localStorage.getItem("arcflow_stress_test_key"))
      : null
    const hasPrivateKey = !!pk && pk.length >= 64
    if (hasPrivateKey && !realSwap.getSigner()) {
      const ok = realSwap.setSignerFromPrivateKey(pk!)
      if (ok) addLog(`🔑 Auto-sign ativado via private key — transações não precisam de MetaMask`)
    }
    if (!addr && !hasPrivateKey) return

    const net = NETWORKS[rede as NetworkKey]
    const isArc = net?.name?.includes("Arc") && net?.isTestnet

    if (isArc) {
      setCicloIntervalo(3)
      addLog(`🧪 Arc Lab Mode: ciclo ultra-rápido a cada 3s, parâmetros agressivos ativos`)
    }

    const t = setTimeout(() => {
      if (!cicloRef.current && !cicloAtivo) {
        alternarCiclo()
      }
    }, isArc ? 1000 : 3000)

    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const unsubLog1 = pregão.onLog(addLog)
    const unsubLog2 = escriturário.onLog(addLog)
    const unsubLog3 = corretor.onLog(addLog)

    const unsubOrdem = pregão.onOrdem(async (ordem) => {
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
      if (ordem.rede === "arc" && ordem.resultado && !processedArcTrades.current.has(ordem.id)) {
        processedArcTrades.current.add(ordem.id)
        const { registrarResultadoArc } = await import("@/lib/pregao-arc")
        registrarResultadoArc(ordem.par, ordem.resultado.profit)
      }
    })

    const unsubTrade = corretor.onTrade(() => {
      setOrdens([...pregão.getTodasOrdens()])
      setStatus(pregão.getStatus())
    })

    const unsubCashBox = pregão.onCashBoxChange((state) => {
      setCashBox(state)
    })

    return () => {
      unsubLog1()
      unsubLog2()
      unsubLog3()
      unsubOrdem()
      unsubTrade()
      unsubCashBox()
    }
  }, [addLog])

  const atualizarCaixaSaldo = useCallback(async () => {
    const saldo = await caixa.getSaldo()
    setCaixaSaldo(saldo.totalUSD)
    pregão.atualizarUnifiedBalance(saldo.totalUSD, saldo.porRede)
  }, [])

  const caixaUnsubRef = useRef<Array<() => void>>([])

  const initCaixa = useCallback(async () => {
    const ok = await caixa.initBrowser()
    setCaixaAtiva(ok)
    if (ok) {
      addLog("🏦 Caixa Livre (Unified Balance) conectada ao navegador")
      caixaUnsubRef.current.push(caixa.onLog(addLog))
      caixaUnsubRef.current.push(caixa.onCashBoxUpdate(atualizarCaixaSaldo))
      await atualizarCaixaSaldo()
    } else {
      addLog("ℹ️ Caixa Unified Balance não disponível — usando saldo local da wallet")
    }
  }, [addLog, atualizarCaixaSaldo])

  useEffect(() => {
    redeRef.current = rede
    const netConf = NETWORKS[rede as NetworkKey]
    if (!netConf) return

    realSwap.switchNetwork(rede as NetworkKey).then(async () => {
      const walletUsdc = realSwap.getBalance("USDC")
      const eurcBal = realSwap.getBalance("EURC")
      const walletUsdt = realSwap.getBalance("USDT")
      const walletDai  = realSwap.getBalance("DAI")
      setWalletBalance(walletUsdc)
      setNativeSymbol(netConf.nativeSymbol)
      const nativeUsd = await realSwap.refreshNativeBalance()
      setNativeBalance(nativeUsd)
      if (walletUsdc > 0) {
        setDepositAmount(Math.floor(walletUsdc).toString())
      }
      addLog(`👛 Saldo na wallet: $${walletUsdc.toFixed(2)} USDC | €${eurcBal.toFixed(2)} EURC | ⛽ $${nativeUsd.toFixed(3)} ${netConf.nativeSymbol}`)
      const saldosReais: Record<string, number> = { USDC: walletUsdc, EURC: eurcBal, USDT: walletUsdt, DAI: walletDai }
      pregão.registrarCashBox(walletUsdc, { [rede]: saldosReais })
      setCashBox(pregão.getCashBox())
      addLog(`💼 Saldos registrados: $${walletUsdc.toFixed(2)} USDC, €${eurcBal.toFixed(2)} EURC`)
    })

    const startBalanceTimer = () => {
      if (balanceTimerRef.current) clearInterval(balanceTimerRef.current)
      balanceTimerRef.current = setInterval(async () => {
        await realSwap.refreshAllBalances()
        const usdc = realSwap.getBalance("USDC")
        setWalletBalance(usdc)
        if (usdc > 0) setDepositAmount(Math.floor(usdc).toString())
        const redeAtiva = redeRef.current
        setOpenPositions(positionManager.getOpenPositions().filter(p => p.networkKey === redeAtiva).length)
        setOpenPositionsData(positionManager.getOpenPositions().filter(p => p.networkKey === redeAtiva))
        setRecentTrades(positionManager.getRecentTrades(10).filter(t => t.networkKey === redeAtiva).slice(0, 5))
        const nativeUsd = await realSwap.refreshNativeBalance()
        setNativeBalance(nativeUsd)
        if (nativeUsd < 0.05 && nativeUsd > 0 && !netConf.isTestnet) {
          narrador.gasAlto(netConf.name, nativeUsd)
        }
        if (nativeUsd < 0.01 && !netConf.isTestnet) {
          narrador.saldoBaixo(`${netConf.name} (${netConf.nativeSymbol})`)
        }
        pregão.verificarShiftRotacao()
        setEscolaRobosData(escolaRobos.getAll())
        setProfessorStats(professor.getStats())
      }, 8000)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (balanceTimerRef.current) {
          clearInterval(balanceTimerRef.current)
          balanceTimerRef.current = null
        }
      } else {
        startBalanceTimer()
      }
    }

    startBalanceTimer()
    document.addEventListener("visibilitychange", onVisibilityChange)

    initCaixa()
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (balanceTimerRef.current) clearInterval(balanceTimerRef.current)
      for (const unsub of caixaUnsubRef.current) unsub()
      caixaUnsubRef.current = []
    }
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

  const cicloVisRef = useRef<(() => void) | null>(null)

  const alternarCiclo = async () => {
    if (cicloAtivo) {
      if (cicloRef.current) {
        clearInterval(cicloRef.current)
        cicloRef.current = null
      }
      if (cicloVisRef.current) {
        cicloVisRef.current()
        cicloVisRef.current = null
      }
      setCicloAtivo(false)
      poolScannerExecutor.stop()
      if (NETWORKS[redeRef.current as NetworkKey]?.isTestnet) {
        import("@/lib/pregao-arc").then(m => m.parar())
      }
      addLog("⏹️ Ciclo dos Pregueiros parado")
      return
    }

    setCicloAtivo(true)
    const net = NETWORKS[redeRef.current as NetworkKey]
    const isTestnet = net?.isTestnet ?? true
    const agenteRede = redeRef.current
    pregão.setRedeAtiva(agenteRede)
    resumeFromPanic()
    setTestnetMode(isTestnet)
    pregão.limparOrdensTravadas()
    poolScannerExecutor.connect(pregão)
    poolScannerExecutor.start()

    if (isTestnet) {
      const { iniciar } = await import("@/lib/pregao-arc")
      iniciar()
    }
    addLog(`🔁 Ciclo dos Pregueiros iniciado na rede ${redeRef.current} (a cada ${cicloIntervalo}s)`)
    addLog(`🔄 Circuit breaker resetado — modo ${isTestnet ? 'testnet' : 'mainnet'}`)
    addLog(`🌐 Agentes: ${isTestnet ? 'single-network' : `single-network (${redeRef.current})`}`)

    atualizarTudo()

    let primeiroCiclo = true
    const runCycle = async () => {
      if (document.hidden && !primeiroCiclo) return
      primeiroCiclo = false
      resumeFromPanic()
      pregão.limparOrdensTravadas()
      try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      const { professor } = await import("@/lib/professor")
      await executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`))
      await executarCicloAgentes(agenteRede).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`))
      if (!isTestnet) {
        await professor.gerarPacotes().catch(e => addLog(`❌ Professor: ${e?.message ?? e}`))
        await pregão.executarPacotes().catch(e => addLog(`❌ Pacote: ${e?.message ?? e}`))
      }
      if (isTestnet) {
        const { executarCiclo: executarArc } = await import("@/lib/pregao-arc")
        await executarArc()
      }
      } catch (e) {
        addLog(`❌ Ciclo: ${e instanceof Error ? e.message : e}`)
      }
      atualizarTudo()
    }

    cicloRef.current = setInterval(runCycle, cicloIntervalo * 1000)
    const onVisChange = () => {
      if (document.hidden && cicloRef.current) {
        clearInterval(cicloRef.current)
        cicloRef.current = null
      } else if (!document.hidden && !cicloRef.current && cicloAtivo) {
        cicloRef.current = setInterval(runCycle, cicloIntervalo * 1000)
      }
    }
    document.addEventListener("visibilitychange", onVisChange)
    cicloVisRef.current = () => document.removeEventListener("visibilitychange", onVisChange)
  }

  const fecharPosicao = async () => {
    const redeAtual = rede
    const posicoes = positionManager.getOpenPositions().filter(p => p.networkKey === redeAtual)
    if (posicoes.length === 0) {
      addLog(`ℹ️ Nenhuma posição aberta em ${redeAtual} para fechar`)
      return
    }
    for (const pos of posicoes) {
      const profitPct = pos.currentProfitPercent ?? ((pos.currentPrice && pos.entryPrice) ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : -100)
      const isDeadPosition = profitPct < -99
      if (isDeadPosition) {
        // Posição com entry price corrompido (PRICE_DIVIDER bug): fecha local sem tentar vender
        positionManager.closePosition(pos.id, 0)
        addLog(`🔒 Posição ${pos.boughtToken} fechada (dead position - entry corrompido, sem venda on-chain)`)
      } else {
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
    }
    atualizarTudo()
  }

  const rodarUmCiclo = async () => {
    resumeFromPanic()
    pregão.limparOrdensTravadas()
    const netRede = NETWORKS[redeRef.current as NetworkKey]
    const isTestRede = netRede?.isTestnet ?? true
    const agenteRede = redeRef.current
    pregão.setRedeAtiva(agenteRede)
    addLog(`▶️ Ciclo manual na rede ${redeRef.current}`)
    try {
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      await executarCicloPregueiros(redeRef.current).catch(e => addLog(`❌ Pregoeiros: ${e?.message ?? e}`))
      await executarCicloAgentes(agenteRede).catch(e => addLog(`❌ Agentes: ${e?.message ?? e}`))
      if (isTestRede) {
        const { executarCiclo } = await import("@/lib/pregao-arc")
        await executarCiclo()
      }
    } catch (e) {
      addLog(`❌ Ciclo manual: ${e instanceof Error ? e.message : e}`)
    }
    atualizarTudo()
  }

  // ─── STRESS TEST ─────────────────────────────────────────────────────────────

  const runStressTestWithKey = async () => {
    if (!stressTestKey) {
      alert("❌ Digite a private key primeiro")
      return
    }

    try {
      setIsLoading(true)
      setStressTestResult(null)
      addLog("🧪 Iniciando Stress Test na Arc Testnet...")
      
      const response = await fetch('/api/stress-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKey: stressTestKey })
      })
      
      const data = await response.json()
      
      if (data.success) {
        const { result } = data
        setStressTestResult({
          success: true,
          details: `Total: ${result.total}, Sucesso: ${result.success}, Falhas: ${result.failed}`,
          results: result.results
        })
        addLog(`✅ Stress Test: ${result.success}/${result.total} sucesso`)
        result.results.forEach((r: any, i: number) => {
          addLog(`  ${i+1}. ${r.operation} → ${r.success ? '✅' : '❌'} ${r.duration}ms${r.error ? ' - ' + r.error : ''}`)
        })
      } else {
        setStressTestResult({
          success: false,
          details: data.error || "Erro desconhecido"
        })
        addLog(`❌ Stress Test falhou: ${data.error}`)
      }
    } catch (error) {
      setStressTestResult({
        success: false,
        details: error instanceof Error ? error.message : String(error)
      })
      addLog(`❌ Erro no Stress Test: ${error}`)
      alert(`❌ Erro: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  const startStressTestLoop = async () => {
    if (!stressTestKey) {
      alert("❌ Digite a private key primeiro")
      return
    }

    if (stressTestRunning) {
      alert("⚠️ Stress Test já está rodando")
      return
    }

    setStressTestRunning(true)
    setStressTestResult(null)
    addLog("🔄 Iniciando Stress Test em loop na Arc Testnet...")

    // Executa imediatamente o primeiro ciclo
    await runStressTestWithKey()

    // Configura o intervalo
    stressTestIntervalRef.current = setInterval(async () => {
      if (document.hidden) return
      await runStressTestWithKey()
    }, 30000) // 30 segundos entre ciclos
  }

  const stopStressTestLoop = () => {
    if (stressTestIntervalRef.current) {
      clearInterval(stressTestIntervalRef.current)
      stressTestIntervalRef.current = null
    }
    setStressTestRunning(false)
    addLog("⏹️ Stress Test em loop parado")
  }

  // ─── CLEANUP ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (stressTestIntervalRef.current) {
        clearInterval(stressTestIntervalRef.current)
        stressTestIntervalRef.current = null
      }
    }
  }, [])

  // ─── Contratante (JobRobot) ─────────────────────────────────────────────────

  useEffect(() => {
    const unsub = contratante.onChange(() => setContratanteState(contratante.getState()))
    const netRede = NETWORKS[redeRef.current as NetworkKey]
    if (netRede?.isTestnet) {
      const pk = localStorage.getItem("arcflow_private_key")
      if (pk) {
        contratante.setPrivateKey(pk)
        setContratanteAtivo(true)
        addLog("🤖 Contratante auto-iniciado — executando jobs na Arc testnet")
      }
    }
    return () => unsub()
  }, [addLog])

  useEffect(() => {
    if (!contratanteAtivo) {
      if (contratanteTimerRef.current) clearInterval(contratanteTimerRef.current)
      return
    }
    const netRede = NETWORKS[redeRef.current as NetworkKey]
    if (netRede?.isTestnet !== true) {
      addLog("⚠️ Contratante só funciona em testnet (Arc)")
      setContratanteAtivo(false)
      return
    }
    const run = async () => {
      if (document.hidden) return
      const { ok, msg } = await contratante.tryExecuteCycle()
      addLog(msg)
    }
    run()
    contratanteTimerRef.current = setInterval(run, 15000)
    const onVis = () => {
      if (document.hidden && contratanteTimerRef.current) {
        clearInterval(contratanteTimerRef.current)
        contratanteTimerRef.current = null
      } else if (!document.hidden && !contratanteTimerRef.current) {
        contratanteTimerRef.current = setInterval(run, 15000)
      }
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      if (contratanteTimerRef.current) clearInterval(contratanteTimerRef.current)
    }
  }, [contratanteAtivo, rede])

  const alternarContratante = () => {
    const netRede = NETWORKS[redeRef.current as NetworkKey]
    if (netRede?.isTestnet !== true) {
      addLog("⚠️ Contratante só funciona em testnet (Arc)")
      return
    }
    if (!contratanteAtivo) {
      const pk = localStorage.getItem("arcflow_private_key")
      if (!pk) {
        addLog("❌ Contratante: private key não encontrada no localStorage")
        return
      }
      contratante.setPrivateKey(pk)
      addLog("🤖 Contratante iniciado — executando swaps USDC/EURC a cada 60s na Arc testnet")
    } else {
      addLog("⏹️ Contratante parado")
    }
    setContratanteAtivo(!contratanteAtivo)
  }

  // ─── Modo Grão ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = modoGrao.onChange(() => setModoGraoState(modoGrao.getState()))
    return () => unsub()
  }, [])

  const alternarModoGrao = () => {
    if (modoGraoState.ativo) {
      modoGrao.stop()
      addLog("⏹️ Modo Grão parado")
    } else {
      modoGrao.start()
      addLog("🌾 Modo Grão iniciado — microtrades a cada 30s")
    }
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 6, textAlign: "center" }}>
          <div style={{ fontSize: 8, color: "#64748b" }}>🔄 Sessão Trades</div>
          <div style={{ fontSize: 16, fontWeight: "bold" }}>{status.sessionTrades}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 6, textAlign: "center" }}>
          <div style={{ fontSize: 8, color: "#64748b" }}>✅ Wins</div>
          <div style={{ fontSize: 16, fontWeight: "bold", color: "#22c55e" }}>{status.sessionWins}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 6, textAlign: "center" }}>
          <div style={{ fontSize: 8, color: "#64748b" }}>❌ Losses</div>
          <div style={{ fontSize: 16, fontWeight: "bold", color: "#ef4444" }}>{status.sessionLosses}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 6, textAlign: "center" }}>
          <div style={{ fontSize: 8, color: "#64748b" }}>📈 Lucro Sessão</div>
          <div style={{ fontSize: 16, fontWeight: "bold", color: status.sessionProfit >= 0 ? "#22c55e" : "#ef4444" }}>
            ${status.sessionProfit.toFixed(2)}
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

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
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
        <button
          onClick={() => {
            const novo = !isPaperMode()
            setPaperMode(novo)
            addLog(`📝 Modo Papel ${novo ? "ativado" : "desativado"} — trades serão ${novo ? "simulados sem gas" : "executados na rede"}`)
          }}
          style={{
            padding: "8px 12px", fontSize: 11, fontWeight: "bold",
            background: isPaperMode() ? "#f59e0b" : "rgba(255,255,255,0.1)",
            color: "#fff", border: isPaperMode() ? "1px solid #f59e0b" : "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8, cursor: "pointer"
          }}>
          📝 Papel
        </button>
      </div>

      {/* 🧪 STRESS TEST COM PRIVATE KEY - APENAS NA ARC */}
      {NETWORKS[redeRef.current as NetworkKey]?.isTestnet && (
        <div style={{ marginBottom: 12, background: "rgba(124,58,237,0.08)", borderRadius: 12, padding: 12, border: "1px solid rgba(124,58,237,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>🧪</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: "bold" }}>Stress Test — Arc Testnet</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>
                Execute transações em lote para testar a capacidade da rede
                {stressTestRunning && (
                  <span style={{ color: "#22c55e", marginLeft: 8 }}>🟢 RODANDO</span>
                )}
              </div>
            </div>
          </div>
          
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="password"
              placeholder="Private Key (0x...)"
              value={stressTestKey}
              onChange={(e) => {
                setStressTestKey(e.target.value)
                localStorage.setItem("arcflow_stress_test_key", e.target.value)
              }}
              disabled={stressTestRunning}
              style={{
                flex: 1,
                minWidth: "150px",
                padding: "6px 10px",
                fontSize: 10,
                fontFamily: "monospace",
                borderRadius: 6,
                background: stressTestRunning ? "#1a1a2e" : "#0f172a",
                border: "1px solid rgba(124,58,237,0.3)",
                color: "#e2e8f0",
                outline: "none"
              }}
            />
            
            {!stressTestRunning ? (
              <button
                onClick={startStressTestLoop}
                disabled={!stressTestKey}
                style={{
                  padding: "6px 16px",
                  fontSize: 11,
                  fontWeight: "bold",
                  borderRadius: 6,
                  border: "none",
                  background: (!stressTestKey) ? "#6b7280" : "#22c55e",
                  color: "#fff",
                  cursor: (!stressTestKey) ? "not-allowed" : "pointer"
                }}
              >
                ▶️ Iniciar Loop
              </button>
            ) : (
              <button
                onClick={stopStressTestLoop}
                style={{
                  padding: "6px 16px",
                  fontSize: 11,
                  fontWeight: "bold",
                  borderRadius: 6,
                  border: "none",
                  background: "#ef4444",
                  color: "#fff",
                  cursor: "pointer"
                }}
              >
                ⏹️ Parar Loop
              </button>
            )}
          </div>
          
          {stressTestKey && !stressTestRunning && (
            <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
              🔑 Private Key carregada {stressTestKey.length > 0 ? `(${stressTestKey.slice(0, 6)}...${stressTestKey.slice(-4)})` : ""}
            </div>
          )}
          {stressTestRunning && (
            <div style={{ fontSize: 8, color: "#22c55e", marginTop: 4 }}>
              🔄 Executando a cada 30 segundos. Clique em "Parar Loop" para interromper.
            </div>
          )}
          {stressTestResult && (
            <div style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 6,
              background: stressTestResult.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              border: `1px solid ${stressTestResult.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`
            }}>
              <div style={{ fontSize: 10, color: stressTestResult.success ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                {stressTestResult.success ? "✅ Stress Test concluído!" : "❌ Stress Test falhou"}
              </div>
              {stressTestResult.details && (
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                  {stressTestResult.details}
                </div>
              )}
              {stressTestResult.results && (
                <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4, maxHeight: 80, overflowY: "auto" }}>
                  {stressTestResult.results.map((r: any, i: number) => (
                    <div key={i} style={{ color: r.success ? "#22c55e" : "#ef4444" }}>
                      {i+1}. {r.operation} → {r.success ? "✅" : "❌"} {r.duration}ms{r.error ? ` - ${r.error}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

      {/* 🤖 Contratante — Job Robot (Arc testnet only) */}
      {NETWORKS[redeRef.current as NetworkKey]?.isTestnet && (
        <div style={{ marginBottom: 12, background: "rgba(59,130,246,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(59,130,246,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: "bold" }}>Contratante — Job Robot</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>
                {contratanteState.swapsExecutados > 0
                  ? `${contratanteState.swapsSucesso} swaps OK • ${contratanteState.swapsFalha} falhas • ${contratanteState.totalTxs} transações`
                  : "Executa swaps USDC/EURC na Arc testnet via Circle App Kit"}
              </div>
            </div>
            <button onClick={alternarContratante} style={{
              padding: "6px 12px", fontSize: 10, fontWeight: "bold",
              background: contratanteAtivo ? "#ef4444" : "#3b82f6", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer"
            }}>
              {contratanteAtivo ? "⏹️ Parar" : "▶️ Iniciar"}
            </button>
          </div>
          {contratanteState.ultimoResultado && (
            <div style={{ fontSize: 9, color: contratanteState.ultimoError ? "#ef4444" : "#94a3b8", padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 6 }}>
              {contratanteState.ultimoResultado}
              {contratanteState.ultimoError && (
                <div style={{ color: "#ef4444", marginTop: 2 }}>⚠️ {contratanteState.ultimoError}</div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#64748b", whiteSpace: "nowrap" }}>🔑 Kit Key</span>
            <input
              type="password"
              value={kitKey}
              onChange={(e) => {
                setKitKey(e.target.value)
                localStorage.setItem("arcflow_kit_key", e.target.value)
              }}
              placeholder="KIT_KEY:keyId:keySecret"
              style={{ flex: 1, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "4px 8px", color: "#e2e8f0", fontSize: 10, fontFamily: "monospace" }}
            />
            {kitKey && (
              <button onClick={() => { setKitKey(""); localStorage.removeItem("arcflow_kit_key") }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 10 }}>✕</button>
            )}
          </div>
          {contratanteState.cicloAtual > 0 && (
            <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
              Ciclo {contratanteState.cicloAtual} • {contratanteState.swapsSucesso} sucesso / {contratanteState.swapsFalha} falhas
            </div>
          )}
          {contratanteState.reports.length > 0 && (
            <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 4, maxHeight: 60, overflowY: "auto" }}>
              {contratanteState.reports.slice(0, 5).map((r, i) => (
                <div key={i} style={{ color: r.success ? "#22c55e" : "#ef4444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.success ? "✅" : "❌"} {r.pair} ${r.amountIn} {r.txHash ? `• ${r.txHash.slice(0, 8)}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 🌾 Stable Micro-Trades — Oportunidades em pares stablecoin */}
      <div style={{ marginBottom: 12 }}>
        <StableOpportunities />
      </div>

      {/* 🌾 Modo Grão — Microtrades */}
      <div style={{ marginBottom: 12, background: "rgba(34,197,94,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(34,197,94,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>🌾</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#4ade80", fontWeight: "bold" }}>Modo Grão — Microtrades</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>
              {modoGraoState.totalTrades > 0
                ? `${modoGraoState.wins} wins • ${modoGraoState.losses} losses • $${modoGraoState.totalProfitUSD} lucro`
                : "$3/trade • AND gate (MR+MM) • target $0.02 1:1"}
            </div>
          </div>
          <button onClick={alternarModoGrao} style={{
            padding: "6px 12px", fontSize: 10, fontWeight: "bold",
            background: modoGraoState.ativo ? "#ef4444" : "#22c55e", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer"
          }}>
            {modoGraoState.ativo ? "⏹️ Parar" : "🌾 Iniciar"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <label style={{ fontSize: 9, color: "#64748b", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={modoGraoState.testMode}
              onChange={(e) => modoGrao.setTestMode(e.target.checked)}
              disabled={modoGraoState.ativo}
              style={{ accentColor: "#f59e0b" }} />
            🧪 Test mode (Sepolia — volatilidade mock)
          </label>
        </div>
        {modoGraoState.lastSignal && (
          <div style={{ fontSize: 9, color: modoGraoState.lastError ? "#ef4444" : "#94a3b8", padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 6 }}>
            {modoGraoState.lastSignal}
            {modoGraoState.lastError && (
              <div style={{ color: "#ef4444", marginTop: 2 }}>⚠️ {modoGraoState.lastError}</div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9, color: "#64748b" }}>
          <span>📊 Ciclo {modoGraoState.cycleCount}</span>
          <span>🟢 {modoGraoState.openPositions} abertas</span>
          <span>⏳ {modoGraoState.pendingSignals} sinais</span>
          <span>{modoGraoState.winRate}% acerto</span>
        </div>
      </div>

      {/* π Monitor de Microestrutura Pi-Engine */}
      <PiEngineMonitor logs={logs} network={redeRef.current} />

      {/* 🎓 Arc Training */}
      <ArcTrainingPanel network={redeRef.current} />

      {/* 📦 Carteira — Posições Abertas + Últimas Operações */}
      <div style={{ marginBottom: 12, background: "rgba(212,165,116,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(212,165,116,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <div>
            <div style={{ fontSize: 11, color: "#fff", fontWeight: "bold" }}>Olá! Aqui está sua carteira</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>
              {openPositions > 0
                ? `Você tem ${openPositions} posição${openPositions > 1 ? "ões" : ""} aberta${openPositions > 1 ? "s" : ""} — veja os detalhes abaixo`
                : "Nenhuma posição aberta no momento. O bot vai comprar quando encontrar uma oportunidade viável."}
            </div>
          </div>
        </div>

        {/* Posições abertas */}
        {openPositionsData.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#d4a574", marginBottom: 6, fontWeight: "bold" }}>📦 POSIÇÕES ABERTAS</div>
            {openPositionsData.map((pos, i) => {
              const profitPct = pos.currentProfitPercent ?? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
              const profitColor = profitPct >= 0 ? "#22c55e" : "#ef4444"
              return (
                <div key={pos.id} style={{
                  background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 10px", marginBottom: 4,
                  borderLeft: `3px solid ${profitColor}`
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{pos.boughtToken === "WETH" ? "ETH" : pos.boughtToken}</span>
                      <span style={{ fontSize: 9, color: "#6b7280" }}>{pos.networkKey}</span>
                    </div>
                    <span style={{ color: profitColor, fontWeight: "bold", fontSize: 12 }}>
                      {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 9, color: "#94a3b8" }}>
                    <span>💰 {pos.amountBought.toFixed(6)} {pos.boughtToken}</span>
                    <span>📊 Entry: ${pos.entryPrice.toFixed(2)}</span>
                    <span>💵 Investido: ${pos.amountPaid.toFixed(2)}</span>
                    <span>⏱️ {tempoRelativo(pos.entryTimestamp)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Últimas 5 operações */}
        <div>
          <div style={{ fontSize: 10, color: "#d4a574", marginBottom: 6, fontWeight: "bold" }}>🕐 ÚLTIMAS OPERAÇÕES</div>
          {recentTrades.length === 0 ? (
            <div style={{ fontSize: 9, color: "#6b7280", padding: "4px 0" }}>
              Nenhuma operação registrada ainda. Os trades aparecerão aqui conforme forem executados.
            </div>
          ) : (
            recentTrades.map((t, i) => {
              const isClosed = t.status === "closed"
              const profitPct = isClosed ? (t.profitPercent ?? 0) : (t.currentProfitPercent ?? ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100)
              const profitColor = profitPct >= 0 ? "#22c55e" : "#ef4444"
              return (
                <div key={t.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "5px 8px", marginBottom: 2,
                  background: isClosed ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.03)",
                  borderRadius: 6, fontSize: 9
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{isClosed ? "✅" : "🔄"}</span>
                    <span style={{ color: "#fff", fontWeight: "bold" }}>{t.paidToken}→{t.boughtToken}</span>
                    <span style={{ color: "#6b7280" }}>{t.networkKey}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#6b7280" }}>${t.amountPaid.toFixed(2)}</span>
                    <span style={{ color: profitColor, fontWeight: "bold" }}>
                      {isClosed
                        ? `${profitPct >= 0 ? "+" : ""}$${(t.profitUsd ?? 0).toFixed(4)}`
                        : `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`}
                    </span>
                    <span style={{ color: "#6b7280" }}>{tempoRelativo(isClosed ? (t.closeTimestamp ?? t.entryTimestamp) : t.entryTimestamp)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 📋 Job Proof — candidatos da Escola de Robôs */}
      {NETWORKS[redeRef.current as NetworkKey]?.isTestnet && (
        <div style={{ marginBottom: 12, background: "rgba(59,130,246,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(59,130,246,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: "bold" }}>Prova de Jobs — Escola de Robôs</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>
                {contratanteAtivo ? "Contratante rodando — jobs sendo distribuídos" : "Robôs precisam completar jobs como prova para serem verificados"}
              </div>
            </div>
            <span style={{ fontSize: 9, color: contratanteAtivo ? "#22c55e" : "#6b7280", fontWeight: "bold" }}>
              {contratanteAtivo ? "🟢 Ativo" : "⏸️ Parado"}
            </span>
          </div>
          {escolaRobos.getCandidatosProva().length > 0 && (
            <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
              🎯 Candidatos: {escolaRobos.getCandidatosProva().map(r => `${r.nome} (${r.jobsCompletos}/${MIN_JOBS_PROVA} jobs)`).join(", ")}
            </div>
          )}
          {escolaRobos.getAll().filter(r => r.jobsCompletos >= MIN_JOBS_PROVA).length > 0 && (
            <div style={{ fontSize: 8, color: "#22c55e", marginTop: 2 }}>
              ✅ Verificados: {escolaRobos.getAll().filter(r => r.jobsCompletos >= MIN_JOBS_PROVA).map(r => r.nome).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* 📚 Escola de Robôs — Turnos + Promoção via Professor */}
      <div style={{ marginBottom: 12, background: "rgba(34,197,94,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(34,197,94,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>📚</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#22c55e", fontWeight: "bold" }}>Escola de Robôs — Turno {escolaRobos.getShiftState().turno}</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>
              {professorStats.pendentes > 0
                ? `${professorStats.pendentes} palpites aguardando avaliação`
                : `${escolaRobosData.filter(r => r.pontos > 0).length} robôs com pontuação · ${escolaRobosData.filter(r => r.status === "promovido").length} promovidos · ${escolaRobosData.filter(r => r.jobsCompletos >= MIN_JOBS_PROVA).length} verificados`}
            </div>
          </div>
        </div>
        {/* Turno atual */}
        {escolaRobos.getShiftState().robosAtivos.length > 0 && (
          <div style={{ marginBottom: 10, padding: "6px 10px", background: "rgba(34,197,94,0.1)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)" }}>
            <div style={{ fontSize: 9, color: "#22c55e", fontWeight: "bold", marginBottom: 4 }}>
              🎓 EM TURNO AGORA ({escolaRobos.getShiftState().robosAtivos.length}/3)
            </div>
            <div style={{ display: "flex", gap: 8, fontSize: 10, flexWrap: "wrap" }}>
              {escolaRobos.getShiftState().robosAtivos.map(nome => {
                const robo = escolaRobos.getRobo(nome)
                const promovido = robo.status === "promovido"
                const verified = robo.jobsCompletos >= MIN_JOBS_PROVA
                const badge = promovido ? "🏆" : verified ? "🎓" : "📚"
                const cor = promovido ? "#FFD700" : verified ? "#22c55e" : "#fff"
                return (
                  <span key={nome} style={{
                    background: promovido ? "rgba(255,215,0,0.2)" : verified ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.1)",
                    padding: "2px 8px", borderRadius: 12, color: cor
                  }}>
                    {badge} {nome} ({robo.pontos}pts)
                  </span>
                )
              })}
            </div>
            <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
              Expira em {Math.max(0, Math.floor((escolaRobos.getShiftState().expira - Date.now()) / 60000))}min
            </div>
          </div>
        )}
        {escolaRobosData.length === 0 ? (
          <div style={{ fontSize: 9, color: "#6b7280", padding: "8px 0", textAlign: "center" }}>
            ⏳ Aguardando robôs acumularem palpites para avaliação do Professor...
          </div>
        ) : (
          escolaRobosData.map((robo, i) => {
            const noTurno = escolaRobos.isOnShift(robo.nome)
            const promovido = robo.status === "promovido"
            const verified = robo.jobsCompletos >= MIN_JOBS_PROVA
            const badge = promovido ? "🏆" : verified ? "🎓" : noTurno ? "📋" : "📚"
            const corBorda = promovido ? "#FFD700" : verified ? "#22c55e" : noTurno ? "#d4a574" : "#6b7280"
            const ultimoFeedback = robo.historicoFeedback.length > 0 ? robo.historicoFeedback[robo.historicoFeedback.length - 1] : ""
            const progPalpites = Math.min(100, (robo.palpitesTotal / 50) * 100)
            const progTaxa = Math.min(100, (robo.taxaAcerto / 60) * 100)
            const progPontos = Math.min(100, (robo.pontos / 500) * 100)
            return (
              <div key={robo.nome} style={{
                background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 10px", marginBottom: 4,
                borderLeft: `3px solid ${corBorda}`
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{badge}</span>
                    <span style={{ color: "#fff", fontWeight: "bold", fontSize: 11 }}>{robo.nome}</span>
                    {promovido && <span style={{ fontSize: 8, color: "#FFD700", background: "rgba(255,215,0,0.2)", padding: "1px 5px", borderRadius: 8 }}>promovido</span>}
                    {verified && !promovido && <span style={{ fontSize: 8, color: "#22c55e", background: "rgba(34,197,94,0.2)", padding: "1px 5px", borderRadius: 8 }}>verificado</span>}
                    {noTurno && !verified && !promovido && <span style={{ fontSize: 8, color: "#d4a574", background: "rgba(212,165,116,0.2)", padding: "1px 5px", borderRadius: 8 }}>em prova</span>}
                  </div>
                  <span style={{ color: promovido ? "#FFD700" : "#22c55e", fontWeight: "bold", fontSize: 11 }}>
                    {robo.pontos}pts
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 9, color: "#94a3b8" }}>
                  <span>✅ {robo.acertos}/{robo.palpitesTotal} ({robo.taxaAcerto.toFixed(0)}%)</span>
                  {!promovido && <span>📋 jobs {robo.jobsCompletos}/{MIN_JOBS_PROVA}</span>}
                </div>
                {!promovido && (
                  <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 3 }}>
                      <div style={{ width: `${progPalpites}%`, height: 3, borderRadius: 4, background: "#60a5fa", transition: "width 0.5s" }} />
                    </div>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 3 }}>
                      <div style={{ width: `${progTaxa}%`, height: 3, borderRadius: 4, background: "#22c55e", transition: "width 0.5s" }} />
                    </div>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 3 }}>
                      <div style={{ width: `${progPontos}%`, height: 3, borderRadius: 4, background: "#FFD700", transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 7, color: "#6b7280" }}>palp/taxa/pts</span>
                  </div>
                )}
                {ultimoFeedback && (
                  <div style={{ fontSize: 8, color: "#6b7280", marginTop: 4, fontStyle: "italic" }}>
                    💬 {ultimoFeedback}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 📊 Relatório Pair-Sector — desempenho por rede */}
      <div style={{ marginBottom: 12, background: "rgba(139,92,246,0.05)", borderRadius: 12, padding: 12, border: "1px solid rgba(139,92,246,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: "bold" }}>Setor de Pares — por rede</div>
            <div style={{ fontSize: 9, color: "#94a3b8" }}>
              {pairSector.getStats().totalAvaliacoes > 0
                ? `${pairSector.getStats().totalAvaliacoes} avaliações • ${Object.keys(pairSector.getStats().porRede).length} redes`
                : "Aguardando palpites dos robôs para avaliar pares"}
            </div>
          </div>
        </div>
        {Object.entries(pairSector.getStats().porRede).length > 0 ? (
          (Object.entries(pairSector.getStats().porRede) as [string, { total: number; avaliadas: number }][]).map(([rede, info]) => {
            const pares = professor.getPairSectorReport(rede as NetworkKey)
            return (
              <div key={rede} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#a78bfa", fontWeight: "bold", marginBottom: 4, textTransform: "uppercase" }}>
                  🌐 {NETWORKS[rede as NetworkKey]?.name || rede} ({info.total} avals, {info.avaliadas} avaliadas)
                </div>
                {pares.length === 0 ? (
                  <div style={{ fontSize: 9, color: "#6b7280", padding: "2px 8px" }}>
                    Nenhum par avaliado ainda nesta rede
                  </div>
                ) : (
                  pares.slice(0, 5).map((par, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "5px 8px", marginBottom: 2,
                      background: par.taxaAcerto >= 60 ? "rgba(34,197,94,0.08)" : par.taxaAcerto >= 40 ? "rgba(251,191,36,0.08)" : "rgba(239,68,68,0.05)",
                      borderRadius: 6, fontSize: 9
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{par.par}</span>
                        <span style={{ color: par.taxaAcerto >= 60 ? "#22c55e" : par.taxaAcerto >= 40 ? "#fbbf24" : "#ef4444", fontWeight: "bold" }}>
                          {par.taxaAcerto.toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280" }}>
                        <span>{par.acertos}/{par.totalAvaliacoes}</span>
                        {par.melhoresRobos.length > 0 && (
                          <span>🏆 {par.melhoresRobos.slice(0, 2).map(r => r.nome).join(", ")}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          })
        ) : (
          <div style={{ fontSize: 9, color: "#6b7280", padding: "8px 0", textAlign: "center" }}>
            ⏳ Nenhuma avaliação registrada ainda — os dados aparecerão após o primeiro ciclo de palpites
          </div>
        )}
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