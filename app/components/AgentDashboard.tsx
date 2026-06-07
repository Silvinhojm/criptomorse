"use client";

interface AgentScore {
  agentName: string;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  avgConfidence: number;
  color?: string;
  icon?: string;
}

interface VotingStats {
  totalVotes: number;
  avgConfidence: number;
  winRate: number;
}

interface AgentDashboardProps {
  agentScores: AgentScore[];
  votingStats: VotingStats;
}

export function AgentDashboard({ agentScores, votingStats }: AgentDashboardProps) {
  if (!agentScores || agentScores.length === 0) {
    return (
      <div style={{ padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '12px', textAlign: 'center', fontSize: '11px', color: '#94a3b8' }}>
        🤖 Aguardando dados dos agentes...
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
        {agentScores.map((agent, i) => (
          <div key={i} style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px' }}>{agent.icon || '🤖'}</div>
            <div style={{ fontSize: '9px', color: agent.color || '#94a3b8', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.agentName}
            </div>
            <div style={{ fontSize: '10px', color: '#4ade80' }}>{(agent.winRate ?? 0).toFixed(0)}%</div>
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>{agent.totalTrades ?? 0} trades</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', fontSize: '10px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8' }}>Votos</div>
          <div style={{ color: '#a78bfa', fontWeight: 'bold' }}>{votingStats.totalVotes}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8' }}>Conf. Média</div>
          <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>{(votingStats.avgConfidence ?? 0).toFixed(0)}%</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8' }}>Win Rate</div>
          <div style={{ color: '#4ade80', fontWeight: 'bold' }}>{(votingStats.winRate ?? 0).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}
