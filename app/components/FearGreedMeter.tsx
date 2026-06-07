// components/FearGreedMeter.tsx
import React, { useEffect, useState } from 'react';
import newsAgent from '../../lib/news-agent';

interface FearGreedData {
  value: number;
  classification: string;
}

export const FearGreedMeter: React.FC = () => {
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const fearGreed = await newsAgent.getFearGreedScore();
      setData(fearGreed);
    } catch (error) {
      console.error('Erro ao buscar Fear & Greed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // Atualiza a cada 5 minutos
    return () => clearInterval(interval);
  }, []);

  const getColor = (value: number) => {
    if (value <= 25) return '#ef4444';
    if (value <= 45) return '#f97316';
    if (value <= 55) return '#fbbf24';
    if (value <= 75) return '#22c55e';
    return '#10b981';
  };

  const getIcon = (classification: string) => {
    if (classification.includes('Fear')) return '😨';
    if (classification.includes('Greed')) return '💰';
    return '😐';
  };

  if (loading || !data) {
    return <div style={{ padding: '16px', textAlign: 'center' }}>Carregando Fear & Greed...</div>;
  }

  return (
    <div style={{ 
      padding: '16px', 
      background: 'linear-gradient(135deg, #1a1a3e 0%, #0a0a2e 100%)', 
      borderRadius: '16px',
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px' }}>{getIcon(data.classification)}</span>
          <span style={{ fontWeight: 'bold', color: '#fff' }}>Fear & Greed Index</span>
        </div>
        <span style={{ 
          background: getColor(data.value), 
          padding: '4px 12px', 
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#fff'
        }}>
          {data.value}
        </span>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{ 
          width: '100%', 
          height: '12px', 
          background: 'linear-gradient(90deg, #ef4444, #f97316, #fbbf24, #22c55e, #10b981)', 
          borderRadius: '6px',
          position: 'relative'
        }}>
          <div style={{ 
            position: 'absolute', 
            left: `${data.value}%`, 
            top: '-4px', 
            transform: 'translateX(-50%)',
            width: '20px', 
            height: '20px', 
            background: '#fff', 
            borderRadius: '50%',
            border: `2px solid ${getColor(data.value)}`,
            boxShadow: '0 0 8px rgba(0,0,0,0.3)'
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', marginBottom: '12px' }}>
        <span>Extreme Fear</span>
        <span>Fear</span>
        <span>Neutral</span>
        <span>Greed</span>
        <span>Extreme Greed</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: getColor(data.value) }}>
        {data.classification}
      </div>
    </div>
  );
};
