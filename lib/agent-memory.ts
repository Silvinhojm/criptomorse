export interface AgentLearningStats {
  agentName: string;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  avgConfidence: number;
  lastUpdated: number;
}

class AgentMemory {
  private memory: Map<string, AgentLearningStats> = new Map();

  update(agentName: string, won: boolean, confidence: number) {
    const existing = this.memory.get(agentName) || {
      agentName,
      wins: 0,
      losses: 0,
      totalTrades: 0,
      winRate: 0,
      avgConfidence: 0,
      lastUpdated: Date.now(),
    };

    existing.wins += won ? 1 : 0;
    existing.losses += won ? 0 : 1;
    existing.totalTrades += 1;

    // winRate real baseado em resultados registrados
    existing.winRate = Math.round((existing.wins / existing.totalTrades) * 100);

    // Média móvel de confiança — evita divisão por zero
    existing.avgConfidence = existing.totalTrades > 1
      ? Math.round(
          (existing.avgConfidence * (existing.totalTrades - 1) + confidence) /
          existing.totalTrades
        )
      : Math.round(confidence);

    existing.lastUpdated = Date.now();
    this.memory.set(agentName, existing);
  }

  get(agentName: string): AgentLearningStats | null {
    return this.memory.get(agentName) || null;
  }

  getAll(): AgentLearningStats[] {
    return Array.from(this.memory.values());
  }

  /**
   * Retorna estatísticas globais de todos os agentes combinados.
   * Útil para exibir no AgentDashboard sem iterar fora da classe.
   */
  getGlobalStats(): { totalTrades: number; avgWinRate: number; bestAgent: string | null } {
    const all = this.getAll();
    if (all.length === 0) return { totalTrades: 0, avgWinRate: 0, bestAgent: null };

    const totalTrades = all.reduce((s, a) => s + a.totalTrades, 0);
    const avgWinRate = Math.round(
      all.reduce((s, a) => s + a.winRate, 0) / all.length
    );
    const bestAgent = all.reduce((best, a) =>
      a.winRate > (best?.winRate ?? -1) ? a : best
    ).agentName;

    return { totalTrades, avgWinRate, bestAgent };
  }

  /**
   * Reseta a memória de um agente específico.
   * Útil para testes ou reset manual via UI.
   */
  reset(agentName?: string) {
    if (agentName) {
      this.memory.delete(agentName);
    } else {
      this.memory.clear();
    }
  }
}

export const agentMemory = new AgentMemory();
