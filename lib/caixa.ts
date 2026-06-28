// Unified Balance desabilitado — plano demo não suporta a API
// import { applyCircleProxyFix } from './circle-proxy-fix'
// applyCircleProxyFix()
// import { UnifiedBalanceKit } from "@circle-fin/unified-balance-kit"
// import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2"

type UbChain = "Arc_Testnet" | "Base" | "Polygon" | "Ethereum" | "Arbitrum" | "Ethereum_Sepolia"
type UbNetworkType = "mainnet" | "testnet"

export const UB_CHAIN: Record<string, UbChain> = {
  arc: "Arc_Testnet",
  base: "Base",
  polygon: "Polygon",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  sepolia: "Ethereum_Sepolia",
}

export interface SaldoCaixa {
  totalUSD: number
  porRede: Record<string, number>
  ultimaAtualizacao: number
  raw: any
}

export interface ResultadoCaixa {
  success: boolean
  txHash: string
  explorerUrl?: string
  message: string
}

export interface EstimativaGasto {
  totalFeesUsd: number
  breakdown: { type: string; amount: string; token: string; recipientAddress?: string }[]
  valorLiquido: number
  raw: any
}

export type LiquidityState =
  | { status: "ok"; route: string; podeUsarForwarder: boolean }
  | { status: "saldo_insuficiente"; saldoDisponivel: number; necessario: number }
  | { status: "rota_indisponivel"; motivo: string; forwarderDisponivel: boolean }
  | { status: "fallback"; route: string; forwarderDisponivel: boolean }

const SALDO_VAZIO: SaldoCaixa = {
  totalUSD: 0,
  porRede: {},
  ultimaAtualizacao: 0,
  raw: null,
}

const RETRY_KEY = "arcflow_spend_retry"

interface RetryState {
  attestation: string
  signature: string
  params: {
    destChain: string
    recipient: string
    amount: string
  }
  timestamp: number
}

let _liveBalance: number | null = null
let _liveBalanceChain: string | null = null

export function setLiveBalance(usdc: number, chain: string) {
  _liveBalance = usdc
  _liveBalanceChain = chain
  caixa.updatePregãoCashBox()
}

export function getLiveBalance(): { usdc: number; chain: string } | null {
  return _liveBalance !== null
    ? { usdc: _liveBalance, chain: _liveBalanceChain ?? "unknown" }
    : null
}

function isKitError(err: any): boolean {
  return err?.constructor?.name === "KitError" || err?.recoverability !== undefined
}

class Caixa {
  private initialized = false
  private kit: any = undefined
  private onLogCallbacks: Array<(msg: string) => void> = []
  private onCashBoxUpdateCallbacks: Array<() => void> = []

  onLog(cb: (msg: string) => void) {
    this.onLogCallbacks.push(cb)
    return () => { this.onLogCallbacks = this.onLogCallbacks.filter(c => c !== cb) }
  }

  onCashBoxUpdate(cb: () => void) {
    this.onCashBoxUpdateCallbacks.push(cb)
    return () => { this.onCashBoxUpdateCallbacks = this.onCashBoxUpdateCallbacks.filter(c => c !== cb) }
  }

  private log(msg: string) {
    console.log(`[CAIXA] ${msg}`)
    for (const cb of this.onLogCallbacks) cb(msg)
  }

  updatePregãoCashBox() {
    for (const cb of this.onCashBoxUpdateCallbacks) cb()
  }

  async initBrowser(): Promise<boolean> {
    this.log("Unified Balance desabilitado (plano demo) — usando saldo local da wallet")
    return false
  }

  isInitialized(): boolean {
    return false
  }

  async getSaldo(_networkType?: UbNetworkType): Promise<SaldoCaixa> {
    if (_liveBalance !== null) {
      return {
        totalUSD: _liveBalance,
        porRede: { [_liveBalanceChain ?? "unknown"]: _liveBalance },
        ultimaAtualizacao: Date.now(),
        raw: null,
      }
    }
    return SALDO_VAZIO
  }

  async depositar(_chain: string, _amount: string, _adapter?: any): Promise<ResultadoCaixa> {
    return { success: false, txHash: "", message: "Caixa não inicializada (Unified Balance desabilitado)" }
  }

  async estimarGasto(
    _destChain: string,
    _recipient: string,
    _amount: string
  ): Promise<EstimativaGasto | null> {
    return null
  }

  async verificarDelegacao(_chain: string): Promise<"none" | "pending" | "ready" | "unknown"> {
    return "unknown"
  }

  async getCadeiasSuportadas(_options?: {
    forwarderSupported?: "source" | "destination"
  }): Promise<{ name: string; type: string; forwarderSupported?: any }[]> {
    return []
  }

  async validarRota(_destChain: string, _amount: string): Promise<LiquidityState> {
    return { status: "rota_indisponivel", motivo: "Caixa não inicializada (Unified Balance desabilitado)", forwarderDisponivel: false }
  }

  async gastar(
    _destChain: string,
    _recipient: string,
    _amount: string,
    _adapter?: any
  ): Promise<ResultadoCaixa> {
    return { success: false, txHash: "", message: "Caixa não inicializada (Unified Balance desabilitado)" }
  }

  async getSaldoPorRede(_chain: string, _nt?: UbNetworkType): Promise<number> {
    return _liveBalance ?? 0
  }

  async getSaldoManual(): Promise<number> {
    return _liveBalance ?? 0
  }

  async temSaldo(amount: number, _networkType?: UbNetworkType): Promise<boolean> {
    return (_liveBalance ?? 0) >= amount
  }
}

export const caixa = new Caixa()

// Cache decorator — evita chamadas repetidas ao Circle Kit no mesmo ciclo
const saldoCache = { value: null as SaldoCaixa | null, timestamp: 0 }
const SALDO_CACHE_TTL = 10_000 // 10s
const _getSaldoOriginal = caixa.getSaldo.bind(caixa)
caixa.getSaldo = async (networkType?: UbNetworkType) => {
  const now = Date.now()
  if (saldoCache.value && now - saldoCache.timestamp < SALDO_CACHE_TTL) {
    return saldoCache.value
  }
  const result = await _getSaldoOriginal(networkType)
  saldoCache.value = result
  saldoCache.timestamp = now
  return result
}
