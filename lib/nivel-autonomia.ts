// lib/nivel-autonomia.ts
// Sistema de Mérito com Autonomia Progressiva
// Níveis 0-4: robôs conquistam independência operacional através de performance.
// Nível 0 = comportamento atual (travado). Nível 4 = autonomia financeira total.
// TUDO começa locked — o sistema se desbloqueia sozinho conforme acerta.

export type NivelAutonomia = 0 | 1 | 2 | 3 | 4

export interface NivelRule {
  nivel: NivelAutonomia
  label: string
  titulo: string
  descricao: string
  // Condições para atingir este nível
  minPalpites: number
  minTaxaAcerto: number // %
  minPontos: number
  minLucroAcumulado: number // $, lucro líquido gerado pelo agente
  minSharpe?: number       // opcional (Nível 4)
  // Autonomias concedidas
  podeEscolherPar: boolean          // nível 3+: escolhe qualquer par disponível
  podeDefinirTamanho: boolean       // nível 2+: define amount dentro de limite
  podeExecutarSolo: boolean         // nível 3+: OK direto ao CapitalController
  podeAumentarOrcamento: boolean    // nível 4+: recebe bônus de capital ao lucrar
  maxAmountUSD: number              // teto de posição ($)
  maxAmountPorRequest: number       // valor máximo por requisição autônoma
  coresDashboard: string            // cor do badge no frontend
}

export const NIVEL_RULES: Record<NivelAutonomia, NivelRule> = {
  0: {
    nivel: 0,
    label: "Estagiário",
    titulo: "🧪 Estagiário",
    descricao: "Modo padrão. Opera apenas com consenso de 2+ agentes e pares pré-definidos. Sem autonomia.",
    minPalpites: 0,
    minTaxaAcerto: 0,
    minPontos: 0,
    minLucroAcumulado: 0,
    podeEscolherPar: false,
    podeDefinirTamanho: false,
    podeExecutarSolo: false,
    podeAumentarOrcamento: false,
    maxAmountUSD: 5,
    maxAmountPorRequest: 5,
    coresDashboard: "#6b7280",
  },
  1: {
    nivel: 1,
    label: "Junior",
    titulo: "🥉 Junior",
    descricao: "50+ palpites com 60%+ acerto. Pode executar trades reais mas apenas em stablecoins com valor fixo.",
    minPalpites: 50,
    minTaxaAcerto: 60,
    minPontos: 500,
    minLucroAcumulado: 0,
    podeEscolherPar: false,
    podeDefinirTamanho: false,
    podeExecutarSolo: false,
    podeAumentarOrcamento: false,
    maxAmountUSD: 5,
    maxAmountPorRequest: 5,
    coresDashboard: "#f59e0b",
  },
  2: {
    nivel: 2,
    label: "Pleno",
    titulo: "🥈 Pleno",
    descricao: "100+ palpites, 65%+ acerto, 1500+ pontos, >$10 de lucro. Pode escolher entre até 3 pares e definir tamanho da posição.",
    minPalpites: 100,
    minTaxaAcerto: 65,
    minPontos: 1500,
    minLucroAcumulado: 10,
    podeEscolherPar: true,
    podeDefinirTamanho: true,
    podeExecutarSolo: false,
    podeAumentarOrcamento: false,
    maxAmountUSD: 20,
    maxAmountPorRequest: 20,
    coresDashboard: "#3b82f6",
  },
  3: {
    nivel: 3,
    label: "Sênior",
    titulo: "🥇 Sênior",
    descricao: "200+ palpites, 70%+ acerto, 3000+ pontos, >$50 lucro. Autonomia total: escolhe par, define posição, executa trade sem consenso.",
    minPalpites: 200,
    minTaxaAcerto: 70,
    minPontos: 3000,
    minLucroAcumulado: 50,
    podeEscolherPar: true,
    podeDefinirTamanho: true,
    podeExecutarSolo: true,
    podeAumentarOrcamento: false,
    maxAmountUSD: 50,
    maxAmountPorRequest: 50,
    coresDashboard: "#8b5cf6",
  },
  4: {
    nivel: 4,
    label: "Especialista",
    titulo: "🏆 Especialista",
    descricao: "500+ palpites, 75%+ acerto, 10000+ pontos, >$150 lucro, Sharpe >1.5. Autonomia financeira: recebe bônus de capital ao lucrar.",
    minPalpites: 500,
    minTaxaAcerto: 75,
    minPontos: 10000,
    minLucroAcumulado: 150,
    minSharpe: 1.5,
    podeEscolherPar: true,
    podeDefinirTamanho: true,
    podeExecutarSolo: true,
    podeAumentarOrcamento: true,
    maxAmountUSD: 100,
    maxAmountPorRequest: 100,
    coresDashboard: "#10b981",
  },
}

export function calcularNivel(robo: {
  palpitesTotal: number
  taxaAcerto: number
  pontos: number
  lucroAcumulado?: number
  sharpeRatio?: number
}): { nivel: NivelAutonomia; rule: NivelRule; progressoProximo: number } {
  const lucro = robo.lucroAcumulado ?? 0
  const niveisOrdenados: NivelAutonomia[] = [4, 3, 2, 1, 0]

  for (const n of niveisOrdenados) {
    const rule = NIVEL_RULES[n]
    const passou =
      robo.palpitesTotal >= rule.minPalpites &&
      robo.taxaAcerto >= rule.minTaxaAcerto &&
      robo.pontos >= rule.minPontos &&
      lucro >= rule.minLucroAcumulado &&
      (!rule.minSharpe || (robo.sharpeRatio ?? 0) >= rule.minSharpe)
    if (passou) {
      // Calcular progresso para o próximo nível
      const proximoIdx = niveisOrdenados.findIndex(x => x === n) - 1
      const proximoNivel = niveisOrdenados[proximoIdx]
      if (proximoNivel === undefined) {
        return { nivel: n, rule, progressoProximo: 100 }
      }
      const proxRule = NIVEL_RULES[proximoNivel]
      const progresso = Math.min(100, Math.round(
        ((robo.palpitesTotal / proxRule.minPalpites) * 0.25 +
         (robo.taxaAcerto / proxRule.minTaxaAcerto) * 0.25 +
         (robo.pontos / proxRule.minPontos) * 0.25 +
         (lucro / proxRule.minLucroAcumulado) * 0.25) * 100
      ))
      return { nivel: n, rule, progressoProximo: progresso }
    }
  }

  // Nível 0 padrão
  return { nivel: 0, rule: NIVEL_RULES[0], progressoProximo: 0 }
}

export function getPaiversPorNivel(nivel: NivelAutonomia): string[] {
  if (nivel < 2) return ["USDC→EURC", "EURC→USDC"]
  if (nivel < 3) return ["USDC→EURC", "EURC→USDC", "USDC→DAI", "DAI→USDC"]
  return [] // Todos disponíveis
}

export function getMaxAmount(nivel: NivelAutonomia): number {
  return NIVEL_RULES[nivel].maxAmountUSD
}