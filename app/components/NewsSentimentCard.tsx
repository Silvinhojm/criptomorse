// components/NewsSentimentCard.tsx
import React from 'react';

// Definindo a interface localmente para não depender do arquivo que falta
interface NewsSentiment {
  bias: 'positive' | 'negative' | 'neutral';
  score: number;
  confidence: number;
  topStories: string[];
  timestamp: number;
  summary?: string;
}

interface NewsSentimentCardProps {
  sentiment: NewsSentiment;
  onRefresh?: () => void;
}

export const NewsSentimentCard: React.FC<NewsSentimentCardProps> = ({ sentiment, onRefresh }) => {
  const getBiasColor = (bias: string) => {
    switch(bias) {
      case 'positive': return '#4ade80';
      case 'negative': return '#ef4444';
      default: return '#fbbf24';
    }
  };

  const getBiasIcon = (bias: string) => {
    switch(bias) {
      case 'positive': return '📈';
      case 'negative': return '📉';
      default: return '📊';
    }
  };

  return (
    <div style={{ 
      padding: '16px', 
      background: 'linear-gradient(135deg, #1a1a3e 0%, #0a0a2e 100%)', 
      borderRadius: '16px',
      border: `2px solid ${getBiasColor(sentiment.bias)}`,
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px' }}>📰</span>
          <span style={{ fontWeight: 'bold', color: '#fff' }}>Análise de Sentimento</span>
          <span style={{ 
            background: getBiasColor(sentiment.bias), 
            padding: '4px 8px', 
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 'bold',
            color: '#000'
          }}>
            {getBiasIcon(sentiment.bias)} {sentiment.bias.toUpperCase()}
          </span>
        </div>
        {onRefresh && (
          <button onClick={onRefresh} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '6px 12px', color: '#fff', cursor: 'pointer' }}>
            🔄 Atualizar
          </button>
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Score de Sentimento</span>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: getBiasColor(sentiment.bias) }}>
            {sentiment.score > 0 ? `+${sentiment.score}` : sentiment.score}
          </span>
        </div>
        <div style={{ 
          width: '100%', 
          height: '8px', 
          background: '#334155', 
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            width: `${Math.abs(sentiment.score)}%`, 
            height: '100%', 
            background: getBiasColor(sentiment.bias),
            borderRadius: '4px'
          }} />
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>Confiança:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <div style={{ 
            width: '100%', 
            height: '6px', 
            background: '#334155', 
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: `${sentiment.confidence}%`, 
              height: '100%', 
              background: '#8b5cf6',
              borderRadius: '3px'
            }} />
          </div>
          <span style={{ fontSize: '11px', color: '#a78bfa' }}>{sentiment.confidence}%</span>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', display: 'block' }}>
          📰 Top Stories:
        </span>
        {sentiment.topStories.map((story: string, idx: number) => (
          <div key={idx} style={{ 
            fontSize: '11px', 
            color: '#cbd5e1', 
            padding: '6px 8px', 
            background: 'rgba(255,255,255,0.05)', 
            borderRadius: '6px',
            marginBottom: '6px'
          }}>
            {story}
          </div>
        ))}
      </div>

      <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '12px', textAlign: 'right' }}>
        Atualizado: {new Date(sentiment.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};