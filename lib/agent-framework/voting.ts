import type { AgentProposal } from "./IAgent"

export interface VoteRecord {
  agentId: string
  proposalId: string
  approved: boolean
  confidence: number
  reputationWeight: number
  knowledgeWeight: number
  reason: string
  timestamp: number
}

export interface VoteResult {
  proposalId: string
  approved: boolean
  confidence: number
  votes: VoteRecord[]
  reason: string
}

export class Voting {
  readonly name: string
  private votes: VoteRecord[] = []
  private minVotes: number
  private minConfidence: number

  constructor(name: string, minVotes = 2, minConfidence = 25) {
    this.name = name
    this.minVotes = minVotes
    this.minConfidence = minConfidence
  }

  recordVote(vote: VoteRecord): void {
    this.votes.push({
      ...vote,
      reputationWeight: vote.reputationWeight ?? 1.0,
      knowledgeWeight: vote.knowledgeWeight ?? 1.0,
    })
  }

  computeWeightedConfidence(confidence: number, repWeight: number, knowWeight: number): number {
    return (confidence / 100) * repWeight * knowWeight
  }

  resolve(proposal: AgentProposal): VoteResult {
    const relevant = this.votes.filter(v => v.proposalId === proposal.id)

    if (relevant.length === 0) {
      return {
        proposalId: proposal.id,
        approved: false,
        confidence: 0,
        votes: [],
        reason: "No votes recorded",
      }
    }

    const approved = relevant.filter(v => v.approved)

    const weightedSum = approved.reduce((s, v) => {
      return s + this.computeWeightedConfidence(v.confidence, v.reputationWeight, v.knowledgeWeight)
    }, 0)

    const weightedConfidence = (weightedSum / Math.max(1, relevant.length)) * 100

    const hasEnoughVotes = approved.length >= this.minVotes
    const hasEnoughConf = weightedConfidence >= this.minConfidence

    if (hasEnoughVotes && hasEnoughConf) {
      return {
        proposalId: proposal.id,
        approved: true,
        confidence: weightedConfidence,
        votes: relevant,
        reason: `Approved: ${approved.length}/${relevant.length} votes, ${weightedConfidence.toFixed(1)}% effective confidence (weighted by reputation and knowledge, diluted by total voters)`,
      }
    }

    let reason = ""
    if (!hasEnoughVotes) {
      reason = `Not enough votes: ${approved.length} approved (min: ${this.minVotes})`
    } else {
      reason = `Weighted confidence too low: ${weightedConfidence.toFixed(1)}% (min: ${this.minConfidence}%)`
    }

    return {
      proposalId: proposal.id,
      approved: false,
      confidence: weightedConfidence,
      votes: relevant,
      reason,
    }
  }

  clearVotes(proposalId?: string): void {
    if (proposalId) {
      this.votes = this.votes.filter(v => v.proposalId !== proposalId)
    } else {
      this.votes = []
    }
  }

  getPendingVotes(proposalId: string): VoteRecord[] {
    return this.votes.filter(v => v.proposalId === proposalId)
  }

  getAllVotes(): VoteRecord[] {
    return [...this.votes]
  }
}
