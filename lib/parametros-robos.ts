const STORAGE_KEY = "arcflow_parametros_robos"

export interface ParametrosRobo {
  confiancaMinima: number
  thresholdEntrada: number
  thresholdSpread: number
  thresholdLiquidez: number
  thresholdProbabilidade: number
  rsiCompra: number
  rsiVenda: number
  ultimoAjuste: number
  motivo: string
}

const DEFAULTS: ParametrosRobo = {
  confiancaMinima: 30,
  thresholdEntrada: 0.005,
  thresholdSpread: 0.001,
  thresholdLiquidez: 0.1,
  thresholdProbabilidade: 10,
  rsiCompra: 35,
  rsiVenda: 65,
  ultimoAjuste: 0,
  motivo: "padrão",
}

class ParametrosRobos {
  private params: Map<string, ParametrosRobo> = new Map()

  constructor() {
    this._carregar()
  }

  private _carregar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as Record<string, ParametrosRobo>
        this.params = new Map(Object.entries(data))
      }
    } catch {
      // silencioso
    }
  }

  private _salvar() {
    try {
      const obj: Record<string, ParametrosRobo> = {}
      this.params.forEach((v, k) => { obj[k] = v })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // silencioso
    }
  }

  get(nome: string): ParametrosRobo {
    let p = this.params.get(nome)
    if (!p) {
      p = { ...DEFAULTS, ultimoAjuste: Date.now() }
      this.params.set(nome, p)
    }
    return { ...p }
  }

  ajustar(
    nome: string,
    ajustes: Partial<ParametrosRobo>,
    motivo: string
  ): ParametrosRobo {
    const atuais = this.get(nome)
    const novos: ParametrosRobo = {
      ...atuais,
      ...ajustes,
      ultimoAjuste: Date.now(),
      motivo,
    }
    this.params.set(nome, novos)
    this._salvar()
    return { ...novos }
  }

  reset(nome: string): ParametrosRobo {
    const p = { ...DEFAULTS, ultimoAjuste: Date.now(), motivo: "reset pelo Professor" }
    this.params.set(nome, p)
    this._salvar()
    return { ...p }
  }

  getTodos(): Record<string, ParametrosRobo> {
    const obj: Record<string, ParametrosRobo> = {}
    this.params.forEach((v, k) => { obj[k] = v })
    return obj
  }
}

export const parametrosRobos = new ParametrosRobos()
