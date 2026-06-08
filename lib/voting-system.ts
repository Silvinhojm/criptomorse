// lib/voting-system.ts
// ✅ VERSÃO OTIMIZADA - Com timeouts e resiliência

export interface AgentVote {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  weight: number;
  color?: string;
  icon?: string;
}

interface VoteResult {
  action: "buy" | "sell" | "hold";
  confidence: number;
  votes: AgentVote[];
  breakdown: Record<string, number>;
  timeoutCount: number;
  failedAgents: string[];
}

class VotingSystem {
  private history: VoteResult[] = [];
  private wins = 0;
  private losses = 0;
  
  // ⏱️ Configurações de timeout
  private readonly DEFAULT_TIMEOUT_MS = 5000; // 5 segundos
  private readonly MAX_RETRIES = 2;

  /**
   * ✅ NOVO: Executa votação com timeout e resiliência
   * @param votePromises - Promessas dos votos dos agentes
   * @param timeoutMs - Tempo máximo de espera (padrão: 5s)
   */
  async voteWithTimeout(
    votePromises: Promise<AgentVote>[],
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS
  ): Promise<VoteResult> {
    const timeoutPromises = votePromises.map(p => this.withTimeout(p, timeoutMs));
    
    // Aguarda todos os votos (incluindo os que falharam/timeout)
    const settledVotes = await Promise.allSettled(timeoutPromises);
    
    // Extrai apenas os votos bem-sucedidos
    const validVotes: AgentVote[] = [];
    const failedAgents: string[] = [];
    
    for (const result of settledVotes) {
      if (result.status === 'fulfilled' && result.value !== null) {
        validVotes.push(result.value);
      } else {
        failedAgents.push('unknown-agent');
      }
    }
    
    console.log(`📊 Voting completed: ${validVotes.length}/${votePromises.length} agents responded`);
    
    if (failedAgents.length > 0) {
      console.warn(`⚠️ ${failedAgents.length} agents timed out or failed`);
    }
    
    // Se nenhum agente respondeu, decisão padrão é HOLD
    if (validVotes.length === 0) {
      console.warn('⚠️ No agents responded - defaulting to HOLD');
      return this.createDefaultResult('hold', 0, [], failedAgents.length);
    }
    
    // Executa a votação apenas com os votos válidos
    const result = this.vote(validVotes);
    
    // Adiciona metadados de timeout
    return {
      ...result,
      timeoutCount: failedAgents.length,
      failedAgents: failedAgents
    };
  }

  /**
   * ⏱️ Adiciona timeout a uma promessa
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.warn(`⏰ Vote timeout after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs)
      )
    ]);
  }

  /**
   * 🛡️ Votação síncrona original (mantida para compatibilidade)
   */
  vote(votes: AgentVote[]): VoteResult {
    const scores: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
    let totalWeight = 0;

    for (const v of votes) {
      const w = v.weight * (v.confidence / 100);
      scores[v.action] = (scores[v.action] || 0) + w;
      totalWeight += v.weight;
    }

    const action = (
      Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    ) as "buy" | "sell" | "hold";

    const confidence = totalWeight > 0
      ? Math.round((scores[action] / totalWeight) * 100)
      : 0;

    const result: VoteResult = {
      action,
      confidence,
      votes,
      breakdown: scores,
      timeoutCount: 0,
      failedAgents: []
    };
    
    this.history.push(result);
    if (this.history.length > 100) this.history.shift();
    return result;
  }

  /**
   * 📊 Cria resultado padrão (usado quando todos os agentes falham)
   */
  private createDefaultResult(
    action: "buy" | "sell" | "hold",
    confidence: number,
    votes: AgentVote[],
    failedCount: number
  ): VoteResult {
    return {
      action,
      confidence,
      votes,
      breakdown: { buy: 0, sell: 0, hold: 0 },
      timeoutCount: failedCount,
      failedAgents: Array(failedCount).fill('timeout')
    };
  }

  /**
   * 📈 Registra resultado real do trade
   */
  recordResult(won: boolean) {
    if (won) {
      this.wins++;
      console.log(`✅ Trade WIN recorded (${this.wins}/${this.wins + this.losses})`);
    } else {
      this.losses++;
      console.log(`❌ Trade LOSS recorded (${this.losses}/${this.wins + this.losses})`);
    }
  }

  /**
   * 📊 Obtém estatísticas
   */
  getStats() {
    const totalVotes = this.history.length;
    if (totalVotes === 0) {
      return { totalVotes: 0, avgConfidence: 0, winRate: 0, totalTimeouts: 0 };
    }

    const avgConfidence = Math.round(
      this.history.reduce((s, r) => s + r.confidence, 0) / totalVotes
    );

    const totalTimeouts = this.history.reduce((s, r) => s + (r.timeoutCount || 0), 0);
    
    const totalResolved = this.wins + this.losses;
    const winRate = totalResolved > 0
      ? Math.round((this.wins / totalResolved) * 100)
      : 0;

    return {
      totalVotes,
      avgConfidence,
      winRate,
      totalTimeouts,
      wins: this.wins,
      losses: this.losses
    };
  }

  /**
   * 🔄 Reset do sistema
   */
  reset() {
    this.history = [];
    this.wins = 0;
    this.losses = 0;
    console.log('🔄 Voting system reset');
  }
}

export const votingSystem = new VotingSystem();