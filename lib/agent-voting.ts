// lib/agent-voting.ts
// Sistema de votacao: trade so executa se maioria concordar
// Empate e resolvido pelo contador (melhor rankeado)

import { accountant } from "./accountant";

export interface AgentVote {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
}

export interface VoteResult {
  approved: boolean;
  action: "buy" | "sell" | "hold";
  confidence: number;
  votes: AgentVote[];
  tiebreaker: string;
  reason: string;
}

const TOTAL_AGENTS = 5;
const MAJORITY = Math.floor(TOTAL_AGENTS / 2) + 1; // 3/5 = 60%

class AgentVotingSystem {
  private votes: AgentVote[] = [];
  private cyclesWithoutTrade = 0;

  registerVote(vote: AgentVote) {
    this.votes.push(vote);
    accountant.registerDecision(vote.agentName, vote.action);
  }

  clearVotes() {
    this.votes = [];
  }

  // Processar votacao e decidir por maioria simples
  resolve(): VoteResult {
    const buyVotes = this.votes.filter(v => v.action === "buy");
    const sellVotes = this.votes.filter(v => v.action === "sell");
    const holdVotes = this.votes.filter(v => v.action === "hold");

    const buyWeight = buyVotes.reduce((s, v) => s + v.confidence, 0);
    const sellWeight = sellVotes.reduce((s, v) => s + v.confidence, 0);
    const holdWeight = holdVotes.reduce((s, v) => s + v.confidence, 0);

    const total = buyWeight + sellWeight + holdWeight;

    let action: "buy" | "sell" | "hold";
    let reason: string;
    let tiebreaker = "";

    // MAIORIA SIMPLES: precisa de 3/5 votos (nao peso)
    if (buyVotes.length >= MAJORITY) {
      action = "buy";
      reason = `Compra venceu (${buyVotes.length}/${this.votes.length} votos, maioria simples)`;
      this.cyclesWithoutTrade = 0;
    } else if (sellVotes.length >= MAJORITY) {
      action = "sell";
      reason = `Venda venceu (${sellVotes.length}/${this.votes.length} votos, maioria simples)`;
      this.cyclesWithoutTrade = 0;
    } else if (holdVotes.length >= MAJORITY) {
      action = "hold";
      reason = `Espera venceu (${holdVotes.length}/${this.votes.length} votos, maioria simples)`;
    } else {
      // Sem maioria: forca trade se ja passaram 3 ciclos sem acao
      this.cyclesWithoutTrade++;
      if (this.cyclesWithoutTrade >= 3 && buyVotes.length + sellVotes.length > 0) {
        action = buyVotes.length > sellVotes.length ? "buy" : "sell";
        reason = `Forcado apos ${this.cyclesWithoutTrade} ciclos sem acao: ${action}`;
        this.cyclesWithoutTrade = 0;
      } else {
        // Empate: contador desempata
        const best = accountant.getBestAgent();
        tiebreaker = best || "contador";
        const tieVote = accountant.getTiebreakerVote();
        action = tieVote;
        reason = `Empate resolvido pelo ${tiebreaker} (melhor rankeado): ${tieVote}`;
      }
    }

    const approved = action !== "hold";

    const result: VoteResult = {
      approved,
      action,
      confidence: total > 0 ? (action === "buy" ? buyWeight : action === "sell" ? sellWeight : holdWeight) / total * 100 : 0,
      votes: [...this.votes],
      tiebreaker,
      reason,
    };

    this.clearVotes();
    return result;
  }

  getVotes(): AgentVote[] {
    return [...this.votes];
  }
}

export const agentVoting = new AgentVotingSystem();
