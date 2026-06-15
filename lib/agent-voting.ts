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

const MIN_VOTES = 2;
const MIN_CONFIDENCE = 20;

class AgentVotingSystem {
  private votes: AgentVote[] = [];

  registerVote(vote: AgentVote) {
    this.votes.push(vote);
    accountant.registerDecision(vote.agentName, vote.action);
  }

  clearVotes() {
    this.votes = [];
  }

  // Processar votacao e decidir
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

    if (buyWeight > sellWeight && buyWeight > holdWeight) {
      action = "buy";
      reason = `Compra venceu (${buyVotes.length}/${this.votes.length} votos, confianca ${((buyWeight / total) * 100).toFixed(0)}%)`;
    } else if (sellWeight > buyWeight && sellWeight > holdWeight) {
      action = "sell";
      reason = `Venda venceu (${sellVotes.length}/${this.votes.length} votos, confianca ${((sellWeight / total) * 100).toFixed(0)}%)`;
    } else if (holdWeight > buyWeight && holdWeight > sellWeight) {
      action = "hold";
      reason = `Espera venceu (${holdVotes.length}/${this.votes.length} votos, confianca ${((holdWeight / total) * 100).toFixed(0)}%)`;
    } else {
      // Empate: contador desempata
      const best = accountant.getBestAgent();
      tiebreaker = best || "contador";
      const tieVote = accountant.getTiebreakerVote();
      action = tieVote;
      reason = `Empate resolvido pelo ${tiebreaker} (melhor rankeado): ${tieVote}`;
    }

    // Verificar maioria simples (pelo menos MIN_VOTES concordando)
    const agreeingVotes = action === "buy" ? buyVotes.length
                        : action === "sell" ? sellVotes.length
                        : holdVotes.length;

    const approved = agreeingVotes >= MIN_VOTES &&
                     (buyWeight / total) * 100 >= MIN_CONFIDENCE;

    const result: VoteResult = {
      approved,
      action,
      confidence: (action === "buy" ? buyWeight : action === "sell" ? sellWeight : holdWeight) / total * 100,
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
