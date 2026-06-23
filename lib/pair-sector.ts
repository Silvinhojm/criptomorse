import type { NetworkKey, TokenSymbol } from "./real-swap-executor"

export interface AvaliacaoPar {
  par: string
  rede: NetworkKey
  fromToken: TokenSymbol
  toToken: TokenSymbol
  roboNome: string
  direcao: "buy" | "sell"
  confianca: number
  precoNoPalpite: number
  timestamp: number
  acertou?: boolean
  pontos?: number
}

export interface ParPerformance {
  par: string
  rede: NetworkKey
  totalAvaliacoes: number
  acertos: number
  taxaAcerto: number
  ultimaAvaliacao: number
  melhoresRobos: Array<{ nome: string; acertos: number }>
}

const STORAGE_KEY = "arcflow_pair_sector"

class PairSector {
  private avaliacoes: AvaliacaoPar[] = []

  constructor() {
    this._carregar()
  }

  private _carregar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) this.avaliacoes = JSON.parse(raw)
    } catch { /* silencioso */ }
  }

  private _salvar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.avaliacoes.slice(-500)))
    } catch { /* silencioso */ }
  }

  registrarAvaliacao(av: AvaliacaoPar) {
    this.avaliacoes.push(av)
    this._salvar()
  }

  getParesPorRede(rede: NetworkKey): AvaliacaoPar[] {
    return this.avaliacoes.filter(a => a.rede === rede)
  }

  getPerformancePorPar(rede: NetworkKey): ParPerformance[] {
    const redeFiltered = this.avaliacoes.filter(a => a.rede === rede && a.acertou !== undefined)
    const porPar = new Map<string, { total: number; acertos: number; ultima: number; robos: Map<string, number> }>()

    for (const av of redeFiltered) {
      const existing = porPar.get(av.par) || { total: 0, acertos: 0, ultima: 0, robos: new Map() }
      existing.total++
      if (av.acertou) {
        existing.acertos++
        existing.robos.set(av.roboNome, (existing.robos.get(av.roboNome) || 0) + 1)
      }
      if (av.timestamp > existing.ultima) existing.ultima = av.timestamp
      porPar.set(av.par, existing)
    }

    return Array.from(porPar.entries()).map(([par, data]) => ({
      par,
      rede,
      totalAvaliacoes: data.total,
      acertos: data.acertos,
      taxaAcerto: data.total > 0 ? (data.acertos / data.total) * 100 : 0,
      ultimaAvaliacao: data.ultima,
      melhoresRobos: Array.from(data.robos.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([nome, acertos]) => ({ nome, acertos })),
    })).sort((a, b) => b.taxaAcerto - a.taxaAcerto)
  }

  getStats() {
    const todasRedes = [...new Set(this.avaliacoes.map(a => a.rede))]
    const resumo: Record<string, { total: number; avaliadas: number }> = {}
    for (const rede of todasRedes) {
      const daRede = this.avaliacoes.filter(a => a.rede === rede)
      resumo[rede] = {
        total: daRede.length,
        avaliadas: daRede.filter(a => a.acertou !== undefined).length,
      }
    }
    return {
      totalAvaliacoes: this.avaliacoes.length,
      totalAvaliadas: this.avaliacoes.filter(a => a.acertou !== undefined).length,
      porRede: resumo,
    }
  }

  limpar() {
    this.avaliacoes = []
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }
}

export const pairSector = new PairSector()
