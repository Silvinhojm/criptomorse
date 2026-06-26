// lib/provao-ranking.ts
// Sistema de competição — Provão diário, bônus semanal, Grande Prêmio 4 semanas
// e ciclos de 10 trades para poder de voto

const STORAGE_KEY = 'arcflow_provao';

// ── Tipos ──

export interface DailyResult {
  date: string;
  winner: string | null;
  scores: { agentName: string; trades: number; wins: number; profit: number }[];
}

export interface WeeklyBonus {
  weekStart: string;
  winner: string | null;
  dailyWins: { agentName: string; count: number }[];
}

export interface GrandPrize {
  periodStart: string;
  winner: string | null;
  weeklyWins: { agentName: string; count: number }[];
}

export interface CycleVotePower {
  agentName: string;
  trades: number;
  wins: number;
  winRate: number;
  profit: number;
  power: number; // 0-1 (peso aplicado ao voto)
}

export interface ProvaoState {
  // Controle diário
  currentDay: string;
  dailyScores: Record<string, { trades: number; wins: number; profit: number }>;
  dailyHistory: DailyResult[];

  // Bônus semanais (cada semana = 7 provões)
  weeklyHistory: WeeklyBonus[];

  // Grande prêmio (a cada 4 semanas)
  grandPrizes: GrandPrize[];

  // Ciclo de 10 trades para poder de voto
  cycleTradeCount: number;
  cycleStart: number;
  cycleAgents: Record<string, { trades: number; wins: number; profit: number }>;
  cycleHistory: { agents: Record<string, { trades: number; wins: number; profit: number }>; endTime: number }[];

  // Acumulado de bônus diários (para premiação semanal)
  weeklyAccumulator: Record<string, number>;

  // Acumulado de bônus semanais (para grande prêmio)
  grandPrizeAccumulator: Record<string, number>;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function get4WeekPeriodStart(): string {
  const d = new Date();
  const weekDay = d.getDay();
  const diffToMonday = d.getDate() - weekDay + (weekDay === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  // Go back to the start of the 4-week period (weeks 1-4, 5-8, etc.)
  const weekOfYear = Math.floor((monday.getTime() - new Date(monday.getFullYear(), 0, 1).getTime()) / (7 * 86400000));
  const periodWeek = Math.floor(weekOfYear / 4) * 4;
  const periodStart = new Date(monday.getFullYear(), 0, 1 + periodWeek * 7);
  return `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}-${String(periodStart.getDate()).padStart(2, '0')}`;
}

class ProvaoRanking {
  private state: ProvaoState;
  private _onUpdate?: () => void;

  constructor() {
    this.state = this._load();
  }

  onUpdate(cb: () => void) {
    this._onUpdate = cb;
  }

  // ── Persistência ──

  private _load(): ProvaoState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return this._freshState();
  }

  private _freshState(): ProvaoState {
    return {
      currentDay: getToday(),
      dailyScores: {},
      dailyHistory: [],
      weeklyHistory: [],
      grandPrizes: [],
      cycleTradeCount: 0,
      cycleStart: Date.now(),
      cycleAgents: {},
      cycleHistory: [],
      weeklyAccumulator: {},
      grandPrizeAccumulator: {},
    };
  }

  private _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* ignore */ }
  }

  private _notify() {
    this._save();
    this._onUpdate?.();
  }

  // ── Registro de trade (chamado pelo accountant) ──

  recordTrade(agentName: string, profit: number) {
    const today = getToday();

    // Verifica se virou o dia — realiza avaliação diária
    if (this.state.currentDay !== today) {
      this._finalizeDay();
      this.state.currentDay = today;
      this.state.dailyScores = {};
    }

    // Score diário
    if (!this.state.dailyScores[agentName]) {
      this.state.dailyScores[agentName] = { trades: 0, wins: 0, profit: 0 };
    }
    this.state.dailyScores[agentName].trades++;
    if (profit > 0) this.state.dailyScores[agentName].wins++;
    this.state.dailyScores[agentName].profit += profit;

    // Ciclo de 10 trades (poder de voto)
    if (!this.state.cycleAgents[agentName]) {
      this.state.cycleAgents[agentName] = { trades: 0, wins: 0, profit: 0 };
    }
    this.state.cycleAgents[agentName].trades++;
    if (profit > 0) this.state.cycleAgents[agentName].wins++;
    this.state.cycleAgents[agentName].profit += profit;

    this.state.cycleTradeCount++;

    // A cada 10 trades, finaliza ciclo e recalcula poder de voto
    if (this.state.cycleTradeCount >= 10) {
      this._finalizeCycle();
    }

    this._notify();
  }

  // ── Finalização diária (elege o vencedor do provão) ──

  private _finalizeDay() {
    const entries = Object.entries(this.state.dailyScores);
    if (entries.length === 0) return;

    let winner: string | null = null;
    let bestScore = -Infinity;

    for (const [name, data] of entries) {
      if (data.trades === 0) continue;
      const score = data.profit + (data.wins / data.trades) * 10; // lucro + winRate ponderado
      if (score > bestScore) {
        bestScore = score;
        winner = name;
      }
    }

    // Registra resultado diário
    const result: DailyResult = {
      date: this.state.currentDay,
      winner,
      scores: entries.map(([agentName, data]) => ({
        agentName,
        trades: data.trades,
        wins: data.wins,
        profit: data.profit,
      })),
    };
    this.state.dailyHistory.push(result);

    // Se tem vencedor, acumula bônus diário
    if (winner) {
      this.state.weeklyAccumulator[winner] = (this.state.weeklyAccumulator[winner] || 0) + 1;
    }

    // Verifica se fechou a semana (7 dias de provões = segunda a domingo)
    this._checkWeeklyPrize();

    this._save();
  }

  // ── Bônus semanal (a cada 7 dias) ──

  private _checkWeeklyPrize() {
    const weekStart = getWeekStart();

    // Só avalia se já passou de 7 dias desde o início da semana
    const existingIndex = this.state.weeklyHistory.findIndex(w => w.weekStart === weekStart);
    if (existingIndex >= 0) return; // já avaliado

    // Verifica se a semana terminou (estamos em uma nova semana)
    const lastWeekResult = this.state.weeklyHistory[this.state.weeklyHistory.length - 1];
    if (lastWeekResult && lastWeekResult.weekStart === weekStart) return;

    // Se o weekStart atual é diferente do último registrado, a semana passada terminou
    if (lastWeekResult && lastWeekResult.weekStart !== weekStart) {
      return; // já foi registrado pela semana anterior
    }

    // Na primeira execução dentro de uma nova semana, finaliza a semana anterior
    if (lastWeekResult && lastWeekResult.weekStart < weekStart) {
      // Já finalizado — só registra nova se ainda não existe
      return;
    }

    // Se temos pelo menos um resultado diário nesta semana
    const thisWeekResults = this.state.dailyHistory.filter(r => r.date >= weekStart);
    if (thisWeekResults.length === 0) return;

    // Conta vitórias diárias da semana
    const dailyWinCount: Record<string, number> = {};
    for (const r of thisWeekResults) {
      if (r.winner) {
        dailyWinCount[r.winner] = (dailyWinCount[r.winner] || 0) + 1;
      }
    }

    const entries = Object.entries(dailyWinCount);
    if (entries.length === 0) return;

    entries.sort((a, b) => b[1] - a[1]);
    const weeklyWinner = entries[0][0];

    const bonus: WeeklyBonus = {
      weekStart,
      winner: weeklyWinner,
      dailyWins: entries.map(([agentName, count]) => ({ agentName, count })),
    };
    this.state.weeklyHistory.push(bonus);

    // Acumula para grande prêmio
    this.state.grandPrizeAccumulator[weeklyWinner] = (this.state.grandPrizeAccumulator[weeklyWinner] || 0) + 1;

    // Limpa acumulador semanal
    this.state.weeklyAccumulator = {};

    // Verifica grande prêmio (4 semanas)
    this._checkGrandPrize();
  }

  // ── Grande Prêmio (a cada 4 semanas) ──

  private _checkGrandPrize() {
    const periodStart = get4WeekPeriodStart();

    const existing = this.state.grandPrizes.find(g => g.periodStart === periodStart);
    if (existing) return;

    const periodWeeks = this.state.weeklyHistory.filter(w => w.weekStart >= periodStart);
    if (periodWeeks.length < 4) return;

    const winCount: Record<string, number> = {};
    for (const w of periodWeeks) {
      if (w.winner) {
        winCount[w.winner] = (winCount[w.winner] || 0) + 1;
      }
    }

    const entries = Object.entries(winCount);
    if (entries.length === 0) return;

    entries.sort((a, b) => b[1] - a[1]);
    const grandWinner = entries[0][0];

    const prize: GrandPrize = {
      periodStart,
      winner: grandWinner,
      weeklyWins: entries.map(([agentName, count]) => ({ agentName, count })),
    };
    this.state.grandPrizes.push(prize);
    this.state.grandPrizeAccumulator = {};
    this._save();
  }

  // ── Ciclo de 10 trades (poder de voto) ──

  private _finalizeCycle() {
    this.state.cycleHistory.push({
      agents: { ...this.state.cycleAgents },
      endTime: Date.now(),
    });

    // Recalcula poder de voto para o próximo ciclo
    // Zera tudo e começa fresco
    this.state.cycleTradeCount = 0;
    this.state.cycleStart = Date.now();
    this.state.cycleAgents = {};
  }

  /** Retorna o poder de voto de cada agente no ciclo atual (0-1) */
  getVotePower(): CycleVotePower[] {
    const entries = Object.entries(this.state.cycleAgents);
    if (entries.length === 0) return [];

    const maxProfit = Math.max(...entries.map(([, d]) => d.profit), 0.001);
    const maxWinRate = Math.max(...entries.map(([, d]) => (d.trades > 0 ? d.wins / d.trades : 0)), 0.001);

    const result: CycleVotePower[] = entries.map(([agentName, data]) => {
      const winRate = data.trades > 0 ? data.wins / data.trades : 0;
      const profitRatio = data.profit / maxProfit;
      const winRateRatio = winRate / maxWinRate;

      // Poder de voto = média ponderada entre lucro (60%) e win rate (40%)
      const power = Math.min(1, Math.max(0, profitRatio * 0.6 + winRateRatio * 0.4));

      return {
        agentName,
        trades: data.trades,
        wins: data.wins,
        winRate: winRate * 100,
        profit: data.profit,
        power,
      };
    });

    result.sort((a, b) => b.power - a.power);
    return result;
  }

  /** Quantos trades faltam para resetar o poder de voto */
  getTradesUntilReset(): number {
    return Math.max(0, 10 - this.state.cycleTradeCount);
  }

  /** Total de trades no ciclo atual */
  getCycleTradeCount(): number {
    return this.state.cycleTradeCount;
  }

  // ── Getters de estado ──

  getDailyWinner(): { agentName: string; profit: number } | null {
    const todayScores = Object.entries(this.state.dailyScores);
    if (todayScores.length === 0) return null;

    let best: { agentName: string; profit: number } | null = null;
    let bestScore = -Infinity;

    for (const [name, data] of todayScores) {
      const score = data.profit + (data.trades > 0 ? (data.wins / data.trades) * 10 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { agentName: name, profit: data.profit };
      }
    }

    return best;
  }

  getLastDailyResult(): DailyResult | null {
    return this.state.dailyHistory.length > 0
      ? this.state.dailyHistory[this.state.dailyHistory.length - 1]
      : null;
  }

  getWeeklyLeaderboard(): { agentName: string; wins: number }[] {
    const weekStart = getWeekStart();
    const weekResults = this.state.dailyHistory.filter(r => r.date >= weekStart && r.winner);

    const count: Record<string, number> = {};
    for (const r of weekResults) {
      if (r.winner) {
        count[r.winner] = (count[r.winner] || 0) + 1;
      }
    }

    return Object.entries(count)
      .map(([agentName, wins]) => ({ agentName, wins }))
      .sort((a, b) => b.wins - a.wins);
  }

  getLastWeeklyBonus(): WeeklyBonus | null {
    return this.state.weeklyHistory.length > 0
      ? this.state.weeklyHistory[this.state.weeklyHistory.length - 1]
      : null;
  }

  getLastGrandPrize(): GrandPrize | null {
    return this.state.grandPrizes.length > 0
      ? this.state.grandPrizes[this.state.grandPrizes.length - 1]
      : null;
  }

  getDailyHistory(): DailyResult[] {
    return [...this.state.dailyHistory];
  }

  getWeeklyHistory(): WeeklyBonus[] {
    return [...this.state.weeklyHistory];
  }

  getGrandPrizes(): GrandPrize[] {
    return [...this.state.grandPrizes];
  }

  getCurrentWeekAccumulator(): Record<string, number> {
    return { ...this.state.weeklyAccumulator };
  }

  /** Stats gerais para o dashboard */
  getStats() {
    return {
      totalCycles: this.state.cycleHistory.length + 1,
      tradesThisCycle: this.state.cycleTradeCount,
      tradesUntilReset: this.getTradesUntilReset(),
      dailyWinner: this.getDailyWinner(),
      lastDailyResult: this.getLastDailyResult(),
      weeklyLeaderboard: this.getWeeklyLeaderboard(),
      lastWeeklyBonus: this.getLastWeeklyBonus(),
      lastGrandPrize: this.getLastGrandPrize(),
      votePower: this.getVotePower(),
    };
  }
}

export const provaoRanking = new ProvaoRanking();
