import type { AgentProposal } from "./IAgent"

export interface VoteRecord {
  agentId: string
  proposalId: string
  approved: boolean
  confidence: number
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
    this.votes.push(vote)
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
    const rejected = relevant.filter(v => !v.approved)

    const avgConfidence = approved.reduce((s, v) => s + v.confidence, 0) / Math.max(1, approved.length)

    const hasEnoughVotes = approved.length >= this.minVotes
    const hasEnoughConf = avgConfidence >= this.minConfidence

    if (hasEnoughVotes && hasEnoughConf) {
      return {
        proposalId: proposal.id,
        approved: true,
        confidence: avgConfidence,
        votes: relevant,
        reason: `Approved: ${approved.length}/${relevant.length} votes, ${avgConfidence.toFixed(1)}% confidence`,
      }
    }

    let reason = ""
    if (!hasEnoughVotes) {
      reason = `Not enough votes: ${approved.length} approved (min: ${this.minVotes})`
    } else {
      reason = `Confidence too low: ${avgConfidence.toFixed(1)}% (min: ${this.minConfidence}%)`
    }

    return {
      proposalId: proposal.id,
      approved: false,
      confidence: avgConfidence,
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
