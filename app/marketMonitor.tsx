// app/MarketMonitor.tsx
// NOVO COMPONENTE - Não afeta o existente

'use client';

import { useState, useEffect } from 'react';

interface MarketData {
  usdcPrice: number;
  eurcPrice: number;
  spread: number;
  opportunity: boolean;
  profit: number;
}

export function MarketMonitor() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Função para simular monitoramento (sem quebrar nada)
  const checkMarket = async () => {
    try {
      // Simulação de preços (depois conectamos com API real)
      const mockUsdc = 1.00;
      const mockEurc = 0.995 + (Math.random() * 0.01); // 0.995 a 1.005
      
      const spread = Math.abs((mockEurc - mockUsdc) / mockUsdc) * 100;
      const profit = spread > 0.5 ? 50 * (spread / 100) : 0;
      
      setMarketData({
        usdcPrice: mockUsdc,
        eurcPrice: mockEurc,
        spread: spread,
        opportunity: spread > 0.5,
        profit: profit
      });
      
      if (spread > 0.5) {
        setOpportunities(prev => [{
          id: Date.now(),
          spread: spread,
          profit: profit,
          timestamp: new Date().toLocaleTimeString()
        }, ...prev.slice(0, 9)]);
      }
    } catch (error) {
      console.error('Erro no monitor:', error);
    }
  };

  // Iniciar/Parar monitoramento
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isMonitoring) {
      checkMarket(); // Executa imediatamente
      interval = setInterval(checkMarket, 30000); // A cada 30 segundos
    }
    return () => clearInterval(interval);
  }, [isMonitoring]);

  return (
    <div style={{
      marginTop: '20px',
      padding: '16px',
      border: '1px solid #333',
      borderRadius: '12px',
      background: '#1a1a1a'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>📊 Market Monitor</h3>
        <button 
          onClick={() => setIsMonitoring(!isMonitoring)}
          style={{
            padding: '6px 12px',
            background: isMonitoring ? '#ff4444' : '#44ff44',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            color: '#000'
          }}
        >
          {isMonitoring ? '⏸️ Parar' : '▶️ Iniciar'}
        </button>
      </div>
      
      {marketData && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>USDC</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold' }}>${marketData.usdcPrice.toFixed(4)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>EURC</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold' }}>${marketData.eurcPrice.toFixed(4)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>Spread</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: marketData.opportunity ? '#44ff44' : '#ffaa44' }}>
                {marketData.spread.toFixed(2)}%
              </div>
            </div>
            {marketData.opportunity && (
              <div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>💎 Lucro potencial</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#44ff44' }}>
                  ${marketData.profit.toFixed(4)} USDC
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {opportunities.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
            🎯 Últimas oportunidades ({opportunities.length})
          </div>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {opportunities.map(opp => (
              <div key={opp.id} style={{
                fontSize: '12px',
                padding: '4px',
                borderBottom: '1px solid #333',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span>{opp.timestamp}</span>
                <span>Spread: {opp.spread.toFixed(2)}%</span>
                <span style={{ color: '#44ff44' }}>Lucro: ${opp.profit.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}