import { applyCircleProxyFix } from './circle-proxy-fix'
applyCircleProxyFix()
import { UnifiedBalanceKit } from "@circle-fin/unified-balance-kit"
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2"

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
  private kit: UnifiedBalanceKit | null = null
  private initialized = false
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
    try {
      if (typeof window === "undefined" || !window.ethereum) {
        this.log("MetaMask não disponível — Caixa em modo offline")
        return false
      }
      this.kit = new UnifiedBalanceKit()
      this.initialized = true
      this.log("Caixa Livre (Unified Balance) inicializada via navegador")
      return true
    } catch (err: any) {
      this.log(`Erro ao inicializar Caixa: ${err.message}`)
      return false
    }
  }

  isInitialized(): boolean {
    return this.initialized && this.kit !== null
  }

  async getSaldo(networkType?: UbNetworkType): Promise<SaldoCaixa> {
    if (!this.initialized || !this.kit) {
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

    try {
      const result = await this.kit.getBalances({
        token: "USDC",
        sources: [{ adapter: await createViemAdapterFromProvider({ provider: window.ethereum }) }],
        includePending: false,
        networkType: networkType ?? "testnet",
      })

      const total = parseFloat(result.totalConfirmedBalance ?? "0")
      const porRede: Record<string, number> = {}

      for (const entry of result.breakdown ?? []) {
        for (const chain of entry.breakdown ?? []) {
          const bal = parseFloat(chain.confirmedBalance ?? "0")
          porRede[chain.chain] = (porRede[chain.chain] ?? 0) + bal
        }
      }

      this.log(`Saldo Unified Balance: $${total.toFixed(2)} USDC`)
      return {
        totalUSD: total,
        porRede,
        ultimaAtualizacao: Date.now(),
        raw: result,
      }
    } catch (err: any) {
      this.log(`Erro ao consultar Unified Balance: ${err.message}`)
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
  }

  async depositar(chain: string, amount: string, adapter?: any): Promise<ResultadoCaixa> {
    if (!this.initialized || !this.kit) {
      return { success: false, txHash: "", message: "Caixa não inicializada" }
    }

    try {
      const fromAdapter = adapter ?? (await createViemAdapterFromProvider({ provider: window.ethereum }))
      const ubChain = UB_CHAIN[chain]

      if (!ubChain) {
        return { success: false, txHash: "", message: `Rede "${chain}" não suportada pelo Unified Balance` }
      }

      const result = await this.kit.deposit({
        from: { adapter: fromAdapter, chain: ubChain as any },
        amount,
        token: "USDC",
      })

      this.log(`Depositado ${amount} USDC em ${chain}: ${result.txHash}`)
      return {
        success: true,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        message: `${amount} USDC depositado em ${chain}`,
      }
    } catch (err: any) {
      this.log(`Erro no depósito: ${err.message}`)
      return { success: false, txHash: "", message: err.message }
    }
  }

  async estimarGasto(
    destChain: string,
    recipient: string,
    amount: string
  ): Promise<EstimativaGasto | null> {
    if (!this.initialized || !this.kit) {
      this.log("Caixa não inicializada — não é possível estimar")
      return null
    }

    try {
      const ubChain = UB_CHAIN[destChain]
      if (!ubChain) return null

      const result = await (this.kit as any).estimateSpend({
        from: { sourceAccount: recipient },
        to: { chain: ubChain, recipientAddress: recipient, useForwarder: true },
        amount,
        token: "USDC",
      })

      const fees = (result.fees ?? []) as { type: string; amount: string; token: string; recipientAddress?: string }[]
      const totalFeesUsd = fees.reduce((sum: number, f: any) => sum + parseFloat(f.amount ?? "0"), 0)
      const valorLiquido = parseFloat(amount) - totalFeesUsd

      return {
        totalFeesUsd,
        breakdown: fees,
        valorLiquido: Math.max(0, valorLiquido),
        raw: result,
      }
    } catch (err: any) {
      this.log(`Erro ao estimar gasto: ${err.message}`)
      return null
    }
  }

  async verificarDelegacao(chain: string): Promise<"none" | "pending" | "ready" | "unknown"> {
    if (!this.initialized || !this.kit) return "unknown"
    try {
      const ubChain = UB_CHAIN[chain]
      if (!ubChain) return "unknown"
      const adapter = await createViemAdapterFromProvider({ provider: window.ethereum })
      const status = await (this.kit as any).getDelegateStatus({
        adapter,
        chain: ubChain,
      })
      return status as "none" | "pending" | "ready"
    } catch {
      return "unknown"
    }
  }

  async getCadeiasSuportadas(options?: {
    forwarderSupported?: "source" | "destination"
  }): Promise<{ name: string; type: string; forwarderSupported?: any }[]> {
    if (!this.initialized || !this.kit) return []
    try {
      const context = (this.kit as any).context ?? (this.kit as any)._context
      if (!context) return []
      const { getSupportedChains: getChains } = await import("@circle-fin/unified-balance-kit")
      return getChains(context, "USDC", options) as any[]
    } catch {
      return []
    }
  }

  async validarRota(destChain: string, amount: string): Promise<LiquidityState> {
    if (!this.initialized || !this.kit) {
      return { status: "rota_indisponivel", motivo: "Caixa não inicializada", forwarderDisponivel: false }
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return { status: "rota_indisponivel", motivo: "Valor inválido", forwarderDisponivel: false }
    }

    const ubChain = UB_CHAIN[destChain]
    if (!ubChain) {
      return { status: "rota_indisponivel", motivo: `Rede "${destChain}" não suportada`, forwarderDisponivel: false }
    }

    const saldo = await this.getSaldoManual()
    if (saldo < amountNum) {
      return { status: "saldo_insuficiente", saldoDisponivel: saldo, necessario: amountNum }
    }

    const cadeias = await this.getCadeiasSuportadas({ forwarderSupported: "destination" })
    const forwarderDisponivel = cadeias.some(c => c.name === ubChain || c.type === ubChain)

    // Fallback: se não tem forwarding, usa alocação explícita
    if (!forwarderDisponivel) {
      const saldoRede = await this.getSaldoPorRede(destChain)
      if (saldoRede < amountNum) {
        return {
          status: "fallback",
          route: `${destChain} (saldo: $${saldoRede.toFixed(2)})`,
          forwarderDisponivel: false,
        }
      }
    }

    return {
      status: "ok",
      route: forwarderDisponivel ? `auto-allocation → ${destChain}` : `explicit → ${destChain}`,
      podeUsarForwarder: forwarderDisponivel,
    }
  }

  async gastar(
    destChain: string,
    recipient: string,
    amount: string,
    adapter?: any
  ): Promise<ResultadoCaixa> {
    if (!this.initialized || !this.kit) {
      return { success: false, txHash: "", message: "Caixa não inicializada" }
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      const errMsg = `Invalid amount '${amount}': Amount must be a positive numeric string`
      this.log(errMsg)
      return { success: false, txHash: "", message: errMsg }
    }
    const amountStr = amountNum.toFixed(6).replace(/\.?0+$/, '')

    const ubChain = UB_CHAIN[destChain]
    if (!ubChain) {
      return { success: false, txHash: "", message: `Rede "${destChain}" não suportada` }
    }

    // 1. Validar delegação (SCA)
    try {
      const delegateStatus = await this.verificarDelegacao(destChain)
      if (delegateStatus === "none") {
        return { success: false, txHash: "", message: `Delegação não encontrada para ${destChain}. Adicione delegação antes de gastar.` }
      }
      if (delegateStatus === "pending") {
        this.log(`⏳ Delegação em ${destChain} está pendente — aguardando confirmação...`)
        return { success: false, txHash: "", message: `Delegação pendente em ${destChain}. Tente novamente em alguns segundos.` }
      }
    } catch {
      this.log("⚠️ Não foi possível verificar delegação — prosseguindo mesmo assim")
    }

    // 2. Validar rota (três estados de liquidez)
    const rota = await this.validarRota(destChain, amountStr)
    if (rota.status === "saldo_insuficiente") {
      return {
        success: false,
        txHash: "",
        message: `Saldo insuficiente: $${rota.saldoDisponivel.toFixed(2)} disponível, $${rota.necessario.toFixed(2)} necessário.`,
      }
    }
    if (rota.status === "rota_indisponivel") {
      return {
        success: false,
        txHash: "",
        message: `Rota indisponível para ${destChain}: ${rota.motivo}`,
      }
    }
    this.log(`📍 Rota: ${rota.route}`)

    // 3. Validar via estimateSpend antes de executar
    try {
      const estimativa = await this.estimarGasto(destChain, recipient, amountStr)
      if (estimativa) {
        const percentualTaxa = estimativa.totalFeesUsd / parseFloat(amountStr)
        if (percentualTaxa > 0.5) {
          this.log(`⚠️ Taxa muito alta (${(percentualTaxa * 100).toFixed(1)}% do valor) — abortando`)
          return {
            success: false,
            txHash: "",
            message: `Taxa de $${estimativa.totalFeesUsd.toFixed(4)} (${(percentualTaxa * 100).toFixed(1)}%) é muito alta. Valor líquido seria $${estimativa.valorLiquido.toFixed(4)}.`,
          }
        }
        if (estimativa.valorLiquido <= 0) {
          return { success: false, txHash: "", message: "Valor líquido após taxas é zero ou negativo. Aumente o valor." }
        }
        this.log(`✅ Estimativa: $${estimativa.totalFeesUsd.toFixed(4)} em taxas, líquido $${estimativa.valorLiquido.toFixed(4)}`)
      }
    } catch (err: any) {
      this.log(`⚠️ Erro ao estimar (prosseguindo): ${err.message}`)
    }

    const fromAdapter = adapter ?? (await createViemAdapterFromProvider({ provider: window.ethereum }))
    const spendParams: any = {
      from: { adapter: fromAdapter, sourceAccount: recipient },
      to: { chain: ubChain, recipientAddress: recipient, useForwarder: true },
      amount: amountStr,
      token: "USDC",
    }

    // 4. Fallback: usar alocação explícita quando forwarding não disponível
    if (rota.status === "fallback") {
      this.log(`🔁 Forwarding não suportado em ${destChain} — usando alocação explícita`)
      spendParams.from.sourceAccount = undefined
      spendParams.from.allocations = [
        { adapter: fromAdapter, chain: ubChain },
      ]
    }

    // 5. Tentar retry armazenado
    try {
      const retryData = this._loadRetry(amountStr, destChain, recipient)
      if (retryData && Date.now() - retryData.timestamp < 600_000) { // 10 min expiry
        this.log("🔄 Retry detectado — reenviando com attestation salvo")
        spendParams.config = { retry: { attestation: retryData.attestation, signature: retryData.signature } }
      }
    } catch {
      // retry expirado ou inválido
      this._clearRetry()
    }

    try {
      const result = await this.kit.spend(spendParams)
      this._clearRetry()
      this.log(`Gasto ${amount} USDC para ${recipient.slice(0, 6)}... em ${destChain}: ${result.txHash}`)
      return {
        success: true,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        message: `${amount} USDC gasto em ${destChain}`,
      }
    } catch (err: any) {
      // 6. KitError handling com recoverability
      if (isKitError(err) && (err.recoverability === "RESUMABLE" || err.recoverability === "RETRYABLE") && err.cause?.trace) {
        const { attestation, signature } = err.cause.trace
        if (attestation && signature) {
          this._saveRetry({ attestation, signature, params: { destChain, recipient, amount: amountStr }, timestamp: Date.now() })
          this.log(`🔄 Falha recuperável (${err.recoverability}) — attestation salvo para retry`)
          return {
            success: false,
            txHash: "",
            message: `Falha na rede de destino. Deseja tentar novamente? (código: ${err.name ?? err.code ?? "desconhecido"})`,
          }
        }
      }
      // Falha fatal
      this._clearRetry()
      this.log(`Erro ao gastar: ${err.message}`)
      return { success: false, txHash: "", message: `Falha: ${err.message}` }
    }
  }

  private _saveRetry(state: RetryState) {
    try { localStorage.setItem(RETRY_KEY, JSON.stringify(state)) } catch {}
  }

  private _loadRetry(amount: string, destChain: string, recipient: string): RetryState | null {
    try {
      const raw = localStorage.getItem(RETRY_KEY)
      if (!raw) return null
      const state: RetryState = JSON.parse(raw)
      if (state.params.amount !== amount || state.params.destChain !== destChain || state.params.recipient !== recipient) return null
      return state
    } catch { return null }
  }

  private _clearRetry() {
    try { localStorage.removeItem(RETRY_KEY) } catch {}
  }

  async getSaldoPorRede(chain: string, _nt?: UbNetworkType): Promise<number> {
    const saldo = await this.getSaldo()
    const ubChain = UB_CHAIN[chain]
    return ubChain ? (saldo.porRede[ubChain] ?? 0) : 0
  }

  async getSaldoManual(): Promise<number> {
    const saldo = await this.getSaldo()
    return saldo.totalUSD
  }

  async temSaldo(amount: number, _networkType?: UbNetworkType): Promise<boolean> {
    const total = await this.getSaldoManual()
    return total >= amount
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
