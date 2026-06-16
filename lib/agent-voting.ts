// lib/agent-voting.ts
// Sistema de votacao: trade executa por confianca ponderada, nao maioria simples

import { accountant } from "./accountant";

export interface AgentVote {
  agentName: string;
  action: "buy" | "sell" | "hold";
  confidence: number; // 0-100
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

// ─── Thresholds configuráveis ─────────────────────────────────────────────────

/**
 * Confiança mínima PONDERADA para aprovar um trade.
 * Antes era maioria simples de votos (3/5), agora é média ponderada de confiança.
 * 35% é conservador mas permite trades quando 2 agentes têm confiança alta (>50%).
 */
const WEIGHTED_CONFIDENCE_THRESHOLD = 25; // % de confiança ponderada mínima (reduzido de 35 para funcionar em testnet)

/**
 * Mínimo de agentes que precisam concordar com a ação vencedora.
 * Reduzido de 3 para 2: se Quântico (38%) + Técnico (46%) concordam → aprova.
 */
const MIN_AGREEING_AGENTS = 2; // mínimo de agentes concordando com a ação vencedora

/**
 * Após quantos ciclos sem trade o sistema força uma execução (se houver sinal).
 */
const FORCE_TRADE_AFTER_CYCLES = 5;

// ─── Sistema de votação ────────────────────────────────────────────────────────

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

  resolve(): VoteResult {
    if (this.votes.length === 0) {
      return {
        approved: false,
        action: "hold",
        confidence: 0,
        votes: [],
        tiebreaker: "",
        reason: "Nenhum voto registrado",
      };
    }

    const buyVotes  = this.votes.filter(v => v.action === "buy");
    const sellVotes = this.votes.filter(v => v.action === "sell");
    const holdVotes = this.votes.filter(v => v.action === "hold");

    // ── Confiança ponderada por grupo ─────────────────────────────────────────
    // Soma a confiança de cada grupo e divide pelo total de agentes (não apenas
    // os que votaram naquele grupo). Isso penaliza grupos com poucos votos.
    const totalAgents = this.votes.length;

    const buyScore  = buyVotes.reduce((s, v) => s + v.confidence, 0)  / totalAgents;
    const sellScore = sellVotes.reduce((s, v) => s + v.confidence, 0) / totalAgents;
    const holdScore = holdVotes.reduce((s, v) => s + v.confidence, 0) / totalAgents;

    // ── Ação vencedora ────────────────────────────────────────────────────────
    let action: "buy" | "sell" | "hold";
    let winningScore: number;
    let winningVotes: AgentVote[];
    let tiebreaker = "";

    if (buyScore >= sellScore && buyScore >= holdScore) {
      action       = "buy";
      winningScore = buyScore;
      winningVotes = buyVotes;
    } else if (sellScore >= buyScore && sellScore >= holdScore) {
      action       = "sell";
      winningScore = sellScore;
      winningVotes = sellVotes;
    } else {
      action       = "hold";
      winningScore = holdScore;
      winningVotes = holdVotes;
    }

    // ── Critérios de aprovação ────────────────────────────────────────────────
    const agreeingCount   = winningVotes.length;
    const hasEnoughAgents = agreeingCount >= MIN_AGREEING_AGENTS;
    const hasEnoughConf   = winningScore >= WEIGHTED_CONFIDENCE_THRESHOLD;
    const isNotHold       = action !== "hold";

    // Forçar trade após muitos ciclos sem ação
    this.cyclesWithoutTrade = isNotHold ? 0 : this.cyclesWithoutTrade + 1;
    const forceTrade =
      this.cyclesWithoutTrade >= FORCE_TRADE_AFTER_CYCLES &&
      (buyVotes.length > 0 || sellVotes.length > 0);

    let approved: boolean;
    let reason: string;

    if (forceTrade) {
      // Força o melhor sinal disponível
      action   = buyScore >= sellScore ? "buy" : "sell";
      approved = true;
      reason   = `Forçado após ${this.cyclesWithoutTrade} ciclos sem trade (score: ${winningScore.toFixed(1)}%)`;
      this.cyclesWithoutTrade = 0;
    } else if (!isNotHold) {
      approved = false;
      reason   = `Hold venceu (score ponderado: ${holdScore.toFixed(1)}% vs buy: ${buyScore.toFixed(1)}% sell: ${sellScore.toFixed(1)}%)`;
    } else if (!hasEnoughAgents) {
      // Tenta desempate pelo melhor agente histórico
      const best = accountant.getBestAgent();
      if (best) {
        tiebreaker = best;
        const tieBuy  = buyVotes.some(v => v.agentName === best);
        const tieSell = sellVotes.some(v => v.agentName === best);
        if (tieBuy || tieSell) {
          action   = tieBuy ? "buy" : "sell";
          approved = true;
          reason   = `Desempatado pelo melhor agente (${best}): ${action}`;
        } else {
          approved = false;
          reason   = `Apenas ${agreeingCount} agente(s) concordam com ${action} (mín: ${MIN_AGREEING_AGENTS}) — sem desempate válido`;
        }
      } else {
        approved = false;
        reason   = `Apenas ${agreeingCount} agente(s) concordam com ${action} (mín: ${MIN_AGREEING_AGENTS})`;
      }
    } else if (!hasEnoughConf) {
      approved = false;
      reason   = `Confiança ponderada insuficiente: ${winningScore.toFixed(1)}% (mín: ${WEIGHTED_CONFIDENCE_THRESHOLD}%)`;
    } else {
      approved = true;
      reason   = `${action.toUpperCase()} aprovado: ${agreeingCount}/${totalAgents} agentes, confiança ${winningScore.toFixed(1)}%`;
    }

    const result: VoteResult = {
      approved,
      action,
      confidence: winningScore,
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