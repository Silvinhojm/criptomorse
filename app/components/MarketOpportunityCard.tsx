// components/MarketOpportunityCard.tsx
import React from 'react';
import { enhancedMarketAnalyzer, NewsSentiment } from '../../lib/news-agent'; // Caminho corrigido para a raiz

interface MarketOpportunityCardProps {
  sentiment: NewsSentiment;
  onTrade?: (action: 'buy' | 'sell' | 'wait') => void;
}

export const MarketOpportunityCard: React.FC<MarketOpportunityCardProps> = ({ sentiment, onTrade }) => {
  const [analysis, setAnalysis] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const loadAnalysis = async () => {
      try {
        const result = await enhancedMarketAnalyzer.getCompleteMarketAnalysis();
        setAnalysis(result);
      } catch (error) {
        console.error('Erro ao analisar mercado:', error);
      } finally {
        setLoading(false);
      }
    };
    loadAnalysis();
  }, [sentiment]);

  if (loading || !analysis) {
    return <div style={{ padding: '16px', textAlign: 'center' }}>Analisando oportunidades...</div>;
  }

  const getActionColor = (action: string) => {
    switch(action) {
      case 'buy': return '#22c55e';
      case 'sell': return '#ef4444';
      default: return '#fbbf24';
    }
  };

  return (
    <div style={{ 
      padding: '16px', 
      background: 'linear-gradient(135deg, #1a1a3e 0%, #0a0a2e 100%)', 
      borderRadius: '16px',
      border: `2px solid ${getActionColor(analysis.recommendation)}`,
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '20px' }}>🎯</span>
        <span style={{ fontWeight: 'bold', color: '#fff' }}>Oportunidade de Mercado</span>
        <span style={{ 
          background: getActionColor(analysis.recommendation), 
          padding: '4px 12px', 
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#fff'
        }}>
          {analysis.recommendation.toUpperCase()}
        </span>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Confiança:</span>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#a78bfa' }}>{analysis.confidence}%</span>
        </div>
        <div style={{ 
          width: '100%', 
          height: '6px', 
          background: '#334155', 
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            width: `${analysis.confidence}%`, 
            height: '100%', 
            background: '#8b5cf6',
            borderRadius: '3px'
          }} />
        </div>
      </div>

      <div style={{ 
        background: 'rgba(0,0,0,0.3)', 
        padding: '12px', 
        borderRadius: '12px',
        marginBottom: '12px'
      }}>
        <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>📊 Análise:</span>
        <span style={{ fontSize: '12px', color: '#cbd5e1' }}>{analysis.reason}</span>
      </div>

      {analysis.metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Preço</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#4ade80' }}>
              ${analysis.metrics.price.toFixed(2)}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Var. 24h</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: analysis.metrics.priceChange24h >= 0 ? '#4ade80' : '#ef4444' }}>
              {analysis.metrics.priceChange24h >= 0 ? '+' : ''}{analysis.metrics.priceChange24h.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {onTrade && analysis.recommendation !== 'wait' && (
        <button 
          onClick={() => onTrade(analysis.recommendation)}
          style={{
            width: '100%',
            padding: '12px',
            background: getActionColor(analysis.recommendation),
            border: 'none',
            borderRadius: '12px',
            color: '#fff',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {analysis.recommendation === 'buy' ? '🟢 COMPRAR AGORA' : '🔴 VENDER AGORA'}
        </button>
      )}
    </div>
  );
};