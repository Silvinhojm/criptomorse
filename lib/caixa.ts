import { UnifiedBalanceKit } from "@circle-fin/unified-balance-kit"
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2"

type UbChain = "Arc_Testnet" | "Base" | "Polygon" | "Ethereum" | "Arbitrum"
type UbNetworkType = "mainnet" | "testnet"

const UB_CHAIN: Record<string, UbChain> = {
  arc: "Arc_Testnet",
  base: "Base",
  polygon: "Polygon",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
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

const SALDO_VAZIO: SaldoCaixa = {
  totalUSD: 0,
  porRede: {},
  ultimaAtualizacao: 0,
  raw: null,
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

class Caixa {
  private kit: UnifiedBalanceKit | null = null
  private initialized = false
  private onLogCallback: ((msg: string) => void) | null = null
  private onCashBoxUpdateCallback: (() => void) | null = null

  onLog(cb: (msg: string) => void) {
    this.onLogCallback = cb
  }

  onCashBoxUpdate(cb: () => void) {
    this.onCashBoxUpdateCallback = cb
  }

  private log(msg: string) {
    console.log(`[CAIXA] ${msg}`)
    this.onLogCallback?.(msg)
  }

  updatePregãoCashBox() {
    this.onCashBoxUpdateCallback?.()
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
      // Fallback for live balance (set by user)
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

  async gastar(
    destChain: string,
    recipient: string,
    amount: string,
    adapter?: any
  ): Promise<ResultadoCaixa> {
    if (!this.initialized || !this.kit) {
      return { success: false, txHash: "", message: "Caixa não inicializada" }
    }

    // Validar amount antes de chamar o kit
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      const errMsg = `Invalid amount '${amount}': Amount must be a positive numeric string`
      this.log(errMsg)
      return { success: false, txHash: "", message: errMsg }
    }
    const amountStr = amountNum.toFixed(6).replace(/\.?0+$/, '')

    try {
      const ubChain = UB_CHAIN[destChain]
      if (!ubChain) {
        return { success: false, txHash: "", message: `Rede "${destChain}" não suportada` }
      }

      const fromAdapter = adapter ?? (await createViemAdapterFromProvider({ provider: window.ethereum }))

      const result = await this.kit.spend({
        from: { adapter: fromAdapter, sourceAccount: recipient } as any,
        to: {
          chain: ubChain as any,
          recipientAddress: recipient,
          useForwarder: true,
        },
        amount: amountStr,
        token: "USDC",
      })

      this.log(`Gasto ${amount} USDC para ${recipient.slice(0, 6)}... em ${destChain}: ${result.txHash}`)
      return {
        success: true,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        message: `${amount} USDC gasto em ${destChain}`,
      }
    } catch (err: any) {
      this.log(`Erro ao gastar: ${err.message}`)
      return { success: false, txHash: "", message: err.message }
    }
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
