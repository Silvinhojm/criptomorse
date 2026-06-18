// lib/accountant.ts
// Contador que gera relatorios de trades e rankeia agentes por acertos
// O robo contador desempata votacoes concordando com o melhor rankeado

import { saveTradeHistory, loadTradeHistory } from "./persistence";

export interface TradeReport {
  id: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  fromToken: string;
  toToken: string;
  amount: number;
  toAmount: number;
  profit: number;
  profitPercent: number;
  entryPrice: number;
  exitPrice: number;
  status: "completed" | "failed" | "open";
  duration: number;
  timestamp: number;
  networkKey: string;
}

export interface AgentScore {
  agentName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
  bestTrade: number;
  worstTrade: number;
  score: number;
  streak: number;
  lastDecide: "buy" | "sell" | "hold" | null;
  points: number;
}

const STORAGE_KEY = "arcflow_accountant_reports";
const TOTAL_POOL = 500;

class Accountant {
  private reports: TradeReport[] = [];
  private agentScores: Map<string, AgentScore> = new Map();

  private initPool() {
    const agents = Array.from(this.agentScores.keys());
    if (agents.length === 0) return;
    // Redistribui sempre que o número de agentes mudar
    const currentTotal = agents.reduce((s, name) => s + this.agentScores.get(name)!.points, 0);
    if (currentTotal >= TOTAL_POOL - 1 && agents.length >= 2 && agents.every(name => this.agentScores.get(name)!.points > 0)) return;
    const each = Math.floor(TOTAL_POOL / agents.length);
    let remainder = TOTAL_POOL - each * agents.length;
    for (const name of agents) {
      const a = this.agentScores.get(name)!;
      a.points = each + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
  }

  // Zero-sum competitive transfer: winners split the stake lost by losers
  // Keeps TAMANHO_PISCINA constant across all agents
  competitiveTransfer(results: { agentName: string; stake: number }[]) {
    const losers = results.filter(r => r.stake < 0);
    const winners = results.filter(r => r.stake > 0);
    if (losers.length === 0 || winners.length === 0) return;

    const totalLost = losers.reduce((s, r) => s + Math.abs(r.stake), 0);
    const eachWin = totalLost / winners.length;

    for (const w of winners) {
      const a = this.agentScores.get(w.agentName);
      if (a) a.points += eachWin;
    }
    for (const l of losers) {
      const a = this.agentScores.get(l.agentName);
      if (a) a.points = Math.max(1, a.points - Math.abs(l.stake));
    }

    // Rebalance to ensure total stays at TOTAL_POOL (fix rounding drift)
    const currentTotal = Array.from(this.agentScores.values()).reduce((s, a) => s + a.points, 0);
    if (Math.abs(currentTotal - TOTAL_POOL) > 1) {
      const diff = TOTAL_POOL - currentTotal;
      const top = this.getRanking();
      if (top.length > 0) top[0].points += diff;
    }
  }

  /** Vota em cada agente: positivo se acertou, negativo se errou */
  getPointsShare(): Map<string, number> {
    const total = Array.from(this.agentScores.values()).reduce((s, a) => s + a.points, 0);
    const map = new Map<string, number>();
    for (const [name, a] of this.agentScores) {
      map.set(name, total > 0 ? a.points / total : 1 / Math.max(1, this.agentScores.size));
    }
    return map;
  }

  constructor() {
    this._load();
  }

  private _load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.reports = JSON.parse(data);
        // Reconstrói scores dos agentes a partir dos reports carregados
        for (const r of this.reports) {
          this._updateAgentScore(r);
        }
      }
    } catch {}
  }

  private _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.reports.slice(-1000)));
    } catch {}
  }

  addReport(report: TradeReport) {
    this.reports.push(report);
    this._updateAgentScore(report);
    this._save();
  }

  private _updateAgentScore(report: TradeReport) {
    let score = this.agentScores.get(report.agentName);
    if (!score) {
      score = {
        agentName: report.agentName,
        totalTrades: 0, wins: 0, losses: 0, winRate: 0,
        totalProfit: 0, avgProfit: 0, bestTrade: 0, worstTrade: 0,
        score: 0, streak: 0, lastDecide: null, points: 0,
      };
      this.agentScores.set(report.agentName, score);
      this.initPool();
    }

    score.totalTrades++;
    if (report.profit > 0) {
      score.wins++;
      score.streak = Math.max(score.streak + 1, 1);
    } else {
      score.losses++;
      score.streak = Math.min(score.streak - 1, -1);
    }
    score.totalProfit += report.profit;
    score.avgProfit = score.totalProfit / score.totalTrades;
    score.winRate = (score.wins / score.totalTrades) * 100;
    if (report.profit > score.bestTrade) score.bestTrade = report.profit;
    if (report.profit < score.worstTrade) score.worstTrade = report.profit;

    // Score composto: winRate * 0.6 + lucroMedio * 0.3 + streak * 0.1
    score.score = (score.winRate * 0.6) + (Math.min(score.avgProfit, 1.0) * 30) + (Math.max(0, score.streak) * 1);
    score.score = Math.max(0, score.score);

    this.agentScores.set(report.agentName, score);
  }

  registerDecision(agentName: string, decision: "buy" | "sell" | "hold") {
    const score = this.agentScores.get(agentName);
    if (score) score.lastDecide = decision;
  }

  // Retorna o agente com melhor score para desempate
  getBestAgent(): string | null {
    let best: string | null = null;
    let bestScore = -Infinity;
    this.agentScores.forEach((s, name) => {
      if (s.totalTrades >= 3 && s.score > bestScore) {
        bestScore = s.score;
        best = name;
      }
    });
    return best;
  }

  // Voto de desempate: o contador concorda com o melhor rankeado
  getTiebreakerVote(): "buy" | "sell" | "hold" {
    const best = this.getBestAgent();
    if (!best) return "hold";
    const score = this.agentScores.get(best);
    return score?.lastDecide ?? "hold";
  }

  getRanking(): AgentScore[] {
    return Array.from(this.agentScores.values())
      .sort((a, b) => b.score - a.score);
  }

  getReports(limit = 50): TradeReport[] {
    return this.reports.slice(-limit).reverse();
  }

  getAgentScore(agentName: string): AgentScore | undefined {
    return this.agentScores.get(agentName);
  }

  // ── Sistema de graduação dos agentes ──
  static readonly GRADES = [
    { nome: "Aprendiz",      icone: "🌱", scoreMin: 0,   scoreMax: 10  },
    { nome: "Primeiro Grau", icone: "📗", scoreMin: 10,  scoreMax: 30  },
    { nome: "Segundo Grau",  icone: "📘", scoreMin: 30,  scoreMax: 50  },
    { nome: "Terceiro Grau", icone: "📙", scoreMin: 50,  scoreMax: 70  },
    { nome: "Mestrado",      icone: "🎓", scoreMin: 70,  scoreMax: 85  },
    { nome: "Doutorado",     icone: "🏆", scoreMin: 85,  scoreMax: 999 },
  ]

  getGrade(score: number): { nome: string; icone: string } {
    for (const g of Accountant.GRADES) {
      if (score >= g.scoreMin && score < g.scoreMax) return { nome: g.nome, icone: g.icone }
    }
    return Accountant.GRADES[Accountant.GRADES.length - 1]
  }

  getNextGrade(score: number): { nome: string; pontosFaltando: number } | null {
    for (const g of Accountant.GRADES) {
      if (score < g.scoreMax) return { nome: g.nome, pontosFaltando: Math.ceil(g.scoreMax - score) }
    }
    return null
  }

  // Feedback do "professor" baseado no desempenho recente
  getTeacherFeedback(agentName: string): string {
    const score = this.agentScores.get(agentName)
    if (!score || score.totalTrades < 3) return "🧪 Ainda em observação — precisa de mais avaliações."

    const grade = this.getGrade(score.score)
    const recente = this.reports.filter(r => r.agentName === agentName).slice(-5)
    const acertos = recente.filter(r => r.profit > 0).length
    const erros = recente.filter(r => r.profit <= 0).length

    let feedback = `${grade.icone} ${grade.nome} | Score: ${score.score.toFixed(1)}`
    feedback += ` | ${score.wins}V ${score.losses}D (${score.winRate.toFixed(0)}%)`

    if (score.streak >= 3) feedback += " 🔥 Racha de lucro!"
    else if (score.streak >= 1) feedback += " 👍 Sequência positiva"
    else if (score.streak <= -3) feedback += " ❄️ Precisa estudar mais"
    else if (score.streak <= -1) feedback += " 📉 Momento difícil"

    if (acertos > erros) feedback += " — Professor: 'Bom trabalho, continue assim!'"
    else if (erros > acertos) feedback += " — Professor: 'Revise suas estratégias, pode melhorar.'"
    else feedback += " — Professor: 'Regular. Identifique o que funciona e foque nisso.'"

    const next = this.getNextGrade(score.score)
    if (next) feedback += ` | Próximo: ${next.nome} (${next.pontosFaltando} pts)`
    else feedback += " | 🏆 Nível máximo atingido!"

    return feedback
  }

  getStats() {
    const completed = this.reports.filter(r => r.status === "completed");
    const profitable = completed.filter(r => r.profit > 0);
    const totalProfit = completed.reduce((s, r) => s + r.profit, 0);
    const totalVolume = completed.reduce((s, r) => s + r.amount, 0);

    return {
      totalTrades: this.reports.length,
      completedTrades: completed.length,
      winRate: completed.length > 0 ? (profitable.length / completed.length) * 100 : 0,
      totalProfit,
      totalVolume,
      avgProfit: completed.length > 0 ? totalProfit / completed.length : 0,
      bestAgent: this.getBestAgent(),
      ranking: this.getRanking(),
    };
  }

  resetScores() {
    this.reports = [];
    this.agentScores.clear();
    this.initPool();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export const accountant = new Accountant();
