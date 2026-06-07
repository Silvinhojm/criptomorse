// app/components/LiFiAgentStatus.tsx
import { useState, useEffect } from 'react';

// ✅ USANDO require EM VEZ DE import
const lifiAgent = require('../lib/lifi-agent');
const checkTransferStatus = lifiAgent.checkTransferStatus;
const StatusResponse = lifiAgent.StatusResponse;

interface LiFiAgentStatusProps {
  txHash?: string;
  fromChain: number;
  toChain: number;
  onComplete?: (success: boolean, amount?: string) => void;
}

export function LiFiAgentStatus({ txHash, fromChain, toChain, onComplete }: LiFiAgentStatusProps) {
  const [status, setStatus] = useState<any>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    if (!txHash || isMonitoring) return;
    
    setIsMonitoring(true);
    setProgress(10);
    
    const interval = setInterval(async () => {
      try {
        const result = await checkTransferStatus(txHash, fromChain, toChain);
        if (result) {
          setStatus(result);
          
          if (result.status === 'PENDING') {
            setProgress(prev => Math.min(90, prev + 10));
          } else if (result.status === 'DONE') {
            setProgress(100);
            clearInterval(interval);
            if (onComplete) onComplete(true, result.toAmount);
          } else if (result.status === 'FAILED') {
            setProgress(0);
            clearInterval(interval);
            if (onComplete) onComplete(false);
          }
        }
      } catch (err) {
        console.error('Erro ao verificar status:', err);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [txHash]);
  
  if (!txHash) return null;
  
  let statusText = '⏳ Aguardando...';
  let statusColor = '#fbbf24';
  
  if (status?.status === 'NOT_FOUND') {
    statusText = '⏳ Aguardando confirmação...';
    statusColor = '#fbbf24';
  } else if (status?.status === 'PENDING') {
    statusText = '🔄 Processando cross-chain...';
    statusColor = '#fbbf24';
  } else if (status?.status === 'DONE') {
    statusText = '✅ Transferência concluída!';
    statusColor = '#4ade80';
  } else if (status?.status === 'FAILED') {
    statusText = '❌ Falha na transferência';
    statusColor = '#ef4444';
  }
  
  return (
    <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '14px' }}>🤖</span>
        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#8b5cf6' }}>LI.FI Agent</span>
        <span style={{ fontSize: '10px', color: statusColor }}>{statusText}</span>
      </div>
      
      <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: statusColor, transition: 'width 0.5s' }} />
      </div>
      
      {status?.substatus && (
        <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '8px' }}>
          Detalhe: {status.substatus === 'PARTIAL' ? 'Recebido token diferente' : 
                    status.substatus === 'REFUNDED' ? 'Reembolsado' : 'Completo'}
        </div>
      )}
      
      {status?.txHash && (
        <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '4px' }}>
          Tx: {status.txHash.slice(0, 10)}...{status.txHash.slice(-8)}
        </div>
      )}
      
      <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '8px' }}>
        🤖 Integrator: CriptoMorse-ARC---Main
      </div>
    </div>
  );
}