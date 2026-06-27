import { realSwap } from "./real-swap-executor"
import type { TokenSymbol, NetworkKey } from "./real-swap-executor"

export interface TradeIntent {
  fromToken: TokenSymbol
  toToken: TokenSymbol
  amount: number
  agentes: string[]
  confianca: number
  expectedProfit: number
  ordemId?: string
}

export interface Pacote {
  id: string
  rede: NetworkKey
  trades: TradeIntent[]
  expectedProfitTotal: number
  confiancaMedia: number
  timestamp: number
  expiraEm: number
  attempts?: number
}

export interface PacoteInfo {
  id: string
  rede: NetworkKey
  qtdTrades: number
  totalAmount: number
  expectedProfitTotal: number
  confiancaMedia: number
  idade: number
}

const EXPIRACAO_MS = 60_000

class SetorPacotes {
  private pacotes: Map<string, Pacote[]> = new Map()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this._iniciarTimer()
  }

  registrarPacote(pacote: Pacote): void {
    const rede = pacote.rede
    const redeAtiva = realSwap.getNetworkKey()
    if (rede !== redeAtiva) {
      console.log(`[SETOR] ⛔ Pacote ${pacote.id} para ${rede} descartado — rede ativa é ${redeAtiva}`)
      return
    }
    if (!this.pacotes.has(rede)) {
      this.pacotes.set(rede, [])
    }
    this.pacotes.get(rede)!.push(pacote)
    console.log(`[SETOR] 📦 Pacote ${pacote.id} registrado: ${pacote.trades.length} trades em ${rede} (lucro esperado: $${pacote.expectedProfitTotal.toFixed(2)})`)
  }

  getPacotePorRede(rede: NetworkKey): Pacote | null {
    const fila = this.pacotes.get(rede)
    if (!fila || fila.length === 0) return null
    const pacote = fila[0]
    if (Date.now() > pacote.expiraEm) {
      fila.shift()
      console.log(`[SETOR] ⏰ Pacote ${pacote.id} expirado — removido`)
      return this.getPacotePorRede(rede)
    }
    fila.shift()
    return pacote
  }

  getPacotesPendentes(): PacoteInfo[] {
    const agora = Date.now()
    const resultado: PacoteInfo[] = []
    for (const [rede, fila] of this.pacotes.entries()) {
      for (const pacote of fila) {
        if (agora > pacote.expiraEm) continue
        resultado.push({
          id: pacote.id,
          rede: pacote.rede,
          qtdTrades: pacote.trades.length,
          totalAmount: pacote.trades.reduce((s, t) => s + t.amount, 0),
          expectedProfitTotal: pacote.expectedProfitTotal,
          confiancaMedia: pacote.confiancaMedia,
          idade: agora - pacote.timestamp,
        })
      }
    }
    return resultado
  }

  getStats() {
    return {
      totalPacotes: Array.from(this.pacotes.values()).reduce((s, f) => s + f.length, 0),
      porRede: Array.from(this.pacotes.entries()).map(([rede, fila]) => ({
        rede,
        quantidade: fila.length,
        tradesPendentes: fila.reduce((s, p) => s + p.trades.length, 0),
      })),
    }
  }

  limpar(): void {
    this.pacotes.clear()
  }

  flush(): void {
    this._limparExpirados()
  }

  private _limparExpirados(): void {
    const agora = Date.now()
    for (const [rede, fila] of this.pacotes.entries()) {
      const validos = fila.filter(p => agora <= p.expiraEm)
      if (validos.length === 0) {
        this.pacotes.delete(rede)
      } else {
        this.pacotes.set(rede, validos)
      }
    }
  }

  private _iniciarTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => this._limparExpirados(), 15_000)
  }
}

export const setorPacotes = new SetorPacotes()
