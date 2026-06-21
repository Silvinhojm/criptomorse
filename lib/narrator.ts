type NarratorEvent = {
  icon: string
  text: string
  timestamp: number
  type: "info" | "success" | "warn" | "error"
}

type NarratorCallback = (event: NarratorEvent) => void

class Narrador {
  private callbacks: NarratorCallback[] = []
  private history: NarratorEvent[] = []
  private maxHistory = 10

  onEvent(cb: NarratorCallback) {
    this.callbacks.push(cb)
    return () => {
      this.callbacks = this.callbacks.filter(c => c !== cb)
    }
  }

  private emit(event: NarratorEvent) {
    // Deduplica: se a última mensagem é idêntica, só atualiza o timestamp
    const last = this.history[0]
    if (last && last.text === event.text && last.type === event.type) {
      last.timestamp = event.timestamp
      for (const cb of this.callbacks) cb(last)
      return
    }
    this.history.unshift(event)
    if (this.history.length > this.maxHistory) this.history.pop()
    for (const cb of this.callbacks) cb(event)
  }

  getHistory(): NarratorEvent[] {
    return [...this.history]
  }

  ordemGerada(par: string, confianca: number, agentes: string[]) {
    const temAgente = agentes.some(a => a.startsWith("Agente:"))
    const label = temAgente ? "agentes" : "analistas"
    const nomes = agentes.map(a => a.replace("Agente:", ""))
    this.emit({
      icon: "📦",
      text: `Ordem gerada: ${par} com ${confianca}% de confiança pelos ${label} ${nomes.join(", ")}.`,
      timestamp: Date.now(),
      type: "info",
    })
  }

  ordemExecutada(par: string, lucro: number) {
    if (lucro >= 0) {
      this.emit({
        icon: "✅",
        text: `Trade ${par} concluído com lucro de $${lucro.toFixed(2)}!`,
        timestamp: Date.now(),
        type: "success",
      })
    } else {
      this.emit({
        icon: "⚠️",
        text: `Trade ${par} fechou com prejuízo de $${Math.abs(lucro).toFixed(2)}. Stop loss ajustado.`,
        timestamp: Date.now(),
        type: "warn",
      })
    }
  }

  ordemFalhou(par: string, motivo: string) {
    this.emit({
      icon: "❌",
      text: `${par} não foi executado: ${motivo}.`,
      timestamp: Date.now(),
      type: "error",
    })
  }

  confiançaBaixa() {
    this.emit({
      icon: "🤔",
      text: `Agentes sem convicção suficiente para mainnet (abaixo de 40%). Aguardando melhores oportunidades.`,
      timestamp: Date.now(),
      type: "info",
    })
  }

  saldoBaixo(rede: string) {
    this.emit({
      icon: "💰",
      text: `Saldo USDC em ${rede} abaixo do mínimo operacional. Precisa depositar para continuar.`,
      timestamp: Date.now(),
      type: "warn",
    })
  }

  circuitoAtivado() {
    this.emit({
      icon: "🛡️",
      text: `Circuit breaker ativou modo pânico! Trades pausados por segurança.`,
      timestamp: Date.now(),
      type: "error",
    })
  }

  staircaseVendendo(token: string, lucro: number) {
    this.emit({
      icon: "🪜",
      text: `Staircase realizando lucro de ${lucro.toFixed(1)}% em ${token}. Saída gradual ativa.`,
      timestamp: Date.now(),
      type: "success",
    })
  }

  gasAlto(rede: string, gasCost: number) {
    this.emit({
      icon: "⛽",
      text: `Gas em ${rede} está alto ($${gasCost.toFixed(4)}). Sistema aguardando queda para executar.`,
      timestamp: Date.now(),
      type: "warn",
    })
  }

  top3Vazio() {
    this.emit({
      icon: "🏆",
      text: `Top 3 agentes sem consenso — todos com streak negativo. Fallback usando agentes secundários.`,
      timestamp: Date.now(),
      type: "info",
    })
  }

  caixaLivre(rede: string, saldo: number) {
    this.emit({
      icon: "🏦",
      text: `Usando Caixa Livre na ${rede}: $${saldo.toFixed(2)} USDC disponíveis para trade.`,
      timestamp: Date.now(),
      type: "info",
    })
  }

  manual(msg: string, type: NarratorEvent["type"] = "info") {
    this.emit({
      icon: "💬",
      text: msg,
      timestamp: Date.now(),
      type,
    })
  }
}

export const narrador = new Narrador()
export type { NarratorEvent }
