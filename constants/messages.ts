export const TERMOS = {
  confiança: "Nível de Certeza",
  staircase: "Escada de Lucro",
  pregão: "Bolsa de Decisões",
  pregueiros: "Analistas",
  OKs: "Votos dos Robôs",
  "OKs Ativos no Pregão": "🔍 Robôs analisando oportunidades",
  "Posição Aberta": "Trade Ativo",
  stopLoss: "Trava de Segurança",
  "Sala de Aula": "Ranking dos Robôs",
  agente: "Robô Trader",
  lucro: "Resultado",
  carteira: "Cofre",
  gas: "Custo de Execução",
  spread: "Margem do Par",
  confiancaMedia: "Certeza Média",
  ordem: "Ordem de Compra/Venda",
  ordens: "Movimentações",
  concluido: "Finalizado",
  falhou: "Não Executado",
  aguardando: "Em Análise",
  executando: "Processando",
} as const

export type TermoKey = keyof typeof TERMOS

export function traduzir(texto: string): string {
  let result = texto
  for (const [key, value] of Object.entries(TERMOS)) {
    const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
    result = result.replace(regex, (match) => {
      if (match === match.toUpperCase()) return value.toUpperCase()
      if (match[0] === match[0].toUpperCase()) return value.charAt(0).toUpperCase() + value.slice(1)
      return value
    })
  }
  return result
}

export const FRASES = {
  analisando: "🔍 Robôs analisando oportunidades no mercado...",
  semSinais: "⏳ Aguardando melhor momento — os robôs estão sendo pacientes.",
  confiancaBaixa: "⏳ Aguardando melhor momento — a confiança dos robôs está abaixo do ideal.",
  tradeExecutado: (par: string) => `⚙️ Realizando trade em ${par} agora...`,
  lucroRealizado: (valor: number) => `📈 Posição subindo — travando lucro de $${valor.toFixed(2)}.`,
  perdaRealizada: (valor: number) => `🛡️ Proteção ativada — pausando trades. Perda de $${Math.abs(valor).toFixed(2)}.`,
  posicaoAberta: (token: string, valor: number) => `📂 ${token} ativo — $${valor.toFixed(2)} investidos.`,
  top3: (nomes: string[]) => `👥 ${nomes.length} robôs ativos. Os melhores: ${nomes.join(", ")}.`,
  staircaseAtivo: (token: string, degraus: number) => `📈 Escada de Lucro em ${token} — ${degraus} degrau(ns) protegendo o ganho.`,
  gasAlto: (rede: string, custo: number) => `💰 Aguardando saldo para próximo trade — gas em ${rede} está $${custo.toFixed(4)}.`,
  saldoInsuficiente: (token: string) => `💰 Aguardando saldo de ${token} para próximo trade.`,
  circuitoAtivo: "🛡️ Proteção ativada — pausando trades temporariamente.",
  tradeFalhou: "❌ Trade não concluído. Os robôs vão tentar novamente.",
} as const
