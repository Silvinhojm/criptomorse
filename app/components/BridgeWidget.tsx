// app/components/BridgeWidget.tsx
"use client";

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { SUPPORTED_NETWORKS, type Network, type Token, switchToNetwork } from '@/lib/networks';
import { checkLifiRoute, getBestLifiQuote, executeLifiRoute, type Route } from '@/lib/lifi';

interface BridgeWidgetProps {
  userAddress?: string;
  onBridgeComplete?: (txHash: string, amount: number, fromChain: string, toChain: string) => void;
}

// Redes que o LI.FI suporta (excluindo ARC Testnet)
const LIFI_SUPPORTED_NETWORKS = SUPPORTED_NETWORKS.filter(n => 
  n.id !== 'arc-testnet' && n.isActive
);

export function BridgeWidget({ userAddress, onBridgeComplete }: BridgeWidgetProps) {
  const [fromNetwork, setFromNetwork] = useState<Network>(LIFI_SUPPORTED_NETWORKS[0]);
  const [toNetwork, setToNetwork] = useState<Network>(LIFI_SUPPORTED_NETWORKS[1] || LIFI_SUPPORTED_NETWORKS[0]);
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [executionStep, setExecutionStep] = useState<string>('');
  
  // Inicializar tokens
  useEffect(() => {
    if (fromNetwork && fromNetwork.tokens.length > 0) {
      setFromToken(fromNetwork.tokens[0]);
    }
  }, [fromNetwork]);
  
  useEffect(() => {
    if (toNetwork && toNetwork.tokens.length > 0) {
      setToToken(toNetwork.tokens[0]);
    }
  }, [toNetwork]);
  
  // Buscar quote quando parâmetros mudam
  useEffect(() => {
    const timer = setTimeout(() => {
      if (amount && parseFloat(amount) > 0 && fromToken && toToken && userAddress) {
        fetchQuote();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fromNetwork, toNetwork, fromToken, toToken, amount, userAddress]);
  
  const fetchQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!fromToken || !toToken) return;
    if (!userAddress) {
      toast.error('Conecte sua carteira primeiro');
      return;
    }
    
    if (fromNetwork.chainId === toNetwork.chainId && fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
      toast.error('Selecione tokens diferentes para origem e destino');
      setQuote(null);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setQuote(null);
    
    try {
      const amountInWei = (parseFloat(amount) * Math.pow(10, fromToken.decimals)).toString();
      
      const result = await getBestLifiQuote({
        fromChainId: fromNetwork.chainId,
        toChainId: toNetwork.chainId,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAmount: amountInWei,
        fromAddress: userAddress,
      });
      
      if (result.success) {
        setQuote(result);
        toast.success(`💰 Bridge encontrada! Receberá ~${result.toAmount} ${result.toToken}`);
      } else {
        toast.error(result.error || 'Erro ao buscar bridge');
        setQuote(null);
      }
    } catch (error) {
      console.error('Erro ao buscar quote:', error);
      toast.error('Erro ao buscar bridge');
    } finally {
      setIsLoading(false);
    }
  };
  
  const executeBridge = async () => {
    if (!userAddress) {
      toast.error('Conecte sua carteira primeiro');
      return;
    }
    
    if (!quote) {
      toast.error('Nenhuma rota disponível. Estime uma rota primeiro.');
      return;
    }
    
    if (!window.ethereum) {
      toast.error('MetaMask não encontrada');
      return;
    }
    
    setIsExecuting(true);
    setTxHash('');
    setExecutionStep('🔄 Preparando bridge...');
    
    toast.loading('🔄 Iniciando bridge entre redes...', { id: 'bridge' });
    
    try {
      setExecutionStep(`📝 Buscando rota completa...`);
      
      const amountInWei = (parseFloat(amount) * Math.pow(10, fromToken!.decimals)).toString();
      
      const routesResult = await checkLifiRoute({
        fromChainId: fromNetwork.chainId,
        toChainId: toNetwork.chainId,
        fromToken: fromToken!.address,
        toToken: toToken!.address,
        fromAmount: amountInWei,
        fromAddress: userAddress,
      });
      
      if (!routesResult.success || !routesResult.routes?.routes.length) {
        throw new Error('Nenhuma rota disponível');
      }
      
      const bestRoute = routesResult.routes.routes[0];
      
      setExecutionStep(`🚀 Executando bridge de ${fromNetwork.shortName} → ${toNetwork.shortName}...`);
      
      const executionResult = await executeLifiRoute(bestRoute, {
        infiniteApproval: false,
      });
      
      if (executionResult.success && executionResult.txHash) {
        setTxHash(executionResult.txHash);
        setExecutionStep('');
        
        toast.success(`✅ Bridge concluído! ${amount} ${fromToken?.symbol} → ${quote.toAmount} ${toToken?.symbol}`, { id: 'bridge', duration: 8000 });
        
        if (onBridgeComplete && executionResult.txHash) {
          onBridgeComplete(executionResult.txHash, parseFloat(amount), fromNetwork.shortName, toNetwork.shortName);
        }
        
        setAmount('');
        setQuote(null);
      } else {
        throw new Error(executionResult.error || 'Erro na execução');
      }
      
    } catch (error: any) {
      console.error('Erro no bridge:', error);
      
      let errorMessage = 'Erro ao executar bridge';
      if (error.message?.includes('user rejected')) {
        errorMessage = '❌ Transação rejeitada';
      } else if (error.message?.includes('insufficient')) {
        errorMessage = '❌ Saldo insuficiente';
      } else {
        errorMessage = `❌ ${error.message?.slice(0, 100) || 'Erro desconhecido'}`;
      }
      
      toast.error(errorMessage, { id: 'bridge', duration: 5000 });
      setExecutionStep('');
    } finally {
      setIsExecuting(false);
    }
  };
  
  const swapNetworks = () => {
    const tempNetwork = fromNetwork;
    setFromNetwork(toNetwork);
    setToNetwork(tempNetwork);
    
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    
    setQuote(null);
  };
  
  // Verificar se a rede atual é suportada pelo LI.FI
  const isCurrentNetworkSupported = userAddress && fromNetwork && LIFI_SUPPORTED_NETWORKS.some(n => n.id === fromNetwork.id);
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>🌉 LI.FI Bridge - Cross Chain</span>
        <span style={styles.badge}>Powered by LI.FI</span>
      </div>
      
      {/* Aviso sobre ARC Testnet */}
      {fromNetwork.id === 'arc-testnet' && (
        <div style={styles.warningBox}>
          <span>⚠️</span>
          <span>ARC Testnet não é suportada pelo LI.FI. Use uma rede Mainnet como Base, Ethereum, Polygon, etc.</span>
        </div>
      )}
      
      <div style={styles.section}>
        <label style={styles.label}>De</label>
        <div style={styles.row}>
          <select
            value={fromNetwork.id}
            onChange={(e) => {
              const network = LIFI_SUPPORTED_NETWORKS.find(n => n.id === e.target.value);
              if (network) setFromNetwork(network);
            }}
            style={styles.select}
            disabled={isExecuting}
          >
            {LIFI_SUPPORTED_NETWORKS.map(network => (
              <option key={network.id} value={network.id}>
                {network.icon} {network.name}
              </option>
            ))}
          </select>
          
          <select
            value={fromToken?.symbol || ''}
            onChange={(e) => {
              const token = fromNetwork.tokens.find(t => t.symbol === e.target.value);
              if (token) setFromToken(token);
            }}
            style={styles.select}
            disabled={isExecuting}
          >
            {fromNetwork.tokens.map(token => (
              <option key={token.symbol} value={token.symbol}>
                {token.icon} {token.symbol}
              </option>
            ))}
          </select>
        </div>
        
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={styles.amountInput}
          disabled={isExecuting || isLoading}
        />
      </div>
      
      <button onClick={swapNetworks} style={styles.swapButton} disabled={isExecuting}>
        ⇅
      </button>
      
      <div style={styles.section}>
        <label style={styles.label}>Para</label>
        <div style={styles.row}>
          <select
            value={toNetwork.id}
            onChange={(e) => {
              const network = LIFI_SUPPORTED_NETWORKS.find(n => n.id === e.target.value);
              if (network) setToNetwork(network);
            }}
            style={styles.select}
            disabled={isExecuting}
          >
            {LIFI_SUPPORTED_NETWORKS.map(network => (
              <option key={network.id} value={network.id}>
                {network.icon} {network.name}
              </option>
            ))}
          </select>
          
          <select
            value={toToken?.symbol || ''}
            onChange={(e) => {
              const token = toNetwork.tokens.find(t => t.symbol === e.target.value);
              if (token) setToToken(token);
            }}
            style={styles.select}
            disabled={isExecuting}
          >
            {toNetwork.tokens.map(token => (
              <option key={token.symbol} value={token.symbol}>
                {token.icon} {token.symbol}
              </option>
            ))}
          </select>
        </div>
        
        {quote && (
          <div style={styles.quoteBox}>
            <div style={styles.quoteRow}>
              <span>Você envia:</span>
              <span>{amount} {fromToken?.symbol}</span>
            </div>
            <div style={styles.quoteRow}>
              <span>Você recebe:</span>
              <span style={styles.quoteValue}>
                {quote.toAmount} {quote.toToken}
              </span>
            </div>
            <div style={styles.quoteRow}>
              <span>Taxa estimada:</span>
              <span style={styles.feeValue}>{quote.fee} {fromToken?.symbol} ({((parseFloat(quote.fee) / parseFloat(amount)) * 100).toFixed(2)}%)</span>
            </div>
            <div style={styles.quoteRow}>
              <span>Tempo estimado:</span>
              <span>~{quote.estimatedTime} segundos</span>
            </div>
          </div>
        )}
      </div>
      
      {executionStep && (
        <div style={styles.executionStatus}>
          <span>{executionStep}</span>
        </div>
      )}
      
      <button
        onClick={executeBridge}
        disabled={isExecuting || isLoading || !amount || parseFloat(amount) <= 0 || !userAddress || !quote || fromNetwork.id === 'arc-testnet'}
        style={{
          ...styles.executeButton,
          ...((isExecuting || isLoading || !amount || parseFloat(amount) <= 0 || !userAddress || !quote || fromNetwork.id === 'arc-testnet') ? styles.disabled : {})
        }}
      >
        {isExecuting ? '🔄 EXECUTANDO BRIDGE...' :
         isLoading ? '🔄 BUSCANDO ROTA...' :
         !userAddress ? '🔌 CONECTE SUA CARTEIRA' :
         fromNetwork.id === 'arc-testnet' ? '⚠️ REDE NÃO SUPORTADA' :
         !quote ? '📡 ESTIME UMA ROTA' :
         `🌉 BRIDGE ${fromToken?.symbol} → ${toToken?.symbol}`}
      </button>
      
      {txHash && (
        <div style={styles.txHash}>
          <span>✅ Bridge concluída!</span>
          <code style={styles.hashCode}>{txHash.slice(0, 10)}...{txHash.slice(-8)}</code>
          <button onClick={() => navigator.clipboard.writeText(txHash)} style={styles.copyButton}>
            📋
          </button>
        </div>
      )}
      
      <div style={styles.networksFooter}>
        <span style={styles.footerTitle}>🌐 Redes suportadas pelo LI.FI:</span>
        <div style={styles.networkIcons}>
          {LIFI_SUPPORTED_NETWORKS.map(network => (
            <span key={network.id} title={network.name} style={{ fontSize: '14px' }}>
              {network.icon}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    background: 'rgba(0, 0, 0, 0.3)',
    backdropFilter: 'blur(10px)',
    borderRadius: '20px',
    padding: '20px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    marginBottom: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#fff',
  },
  badge: {
    fontSize: '10px',
    background: '#3a6cc8',
    padding: '4px 8px',
    borderRadius: '12px',
    color: '#fff',
  },
  warningBox: {
    background: 'rgba(255, 100, 100, 0.2)',
    border: '1px solid #ff6b6b',
    borderRadius: '10px',
    padding: '10px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: '#ff6b6b',
  },
  section: {
    marginBottom: '16px',
  },
  label: {
    fontSize: '11px',
    color: '#94a3b8',
    marginBottom: '8px',
    display: 'block',
  },
  row: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
  },
  select: {
    flex: 1,
    padding: '10px',
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer',
  },
  amountInput: {
    width: '100%',
    padding: '12px',
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
  },
  swapButton: {
    display: 'block',
    margin: '8px auto',
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#fff',
  },
  quoteBox: {
    marginTop: '12px',
    padding: '12px',
    background: 'rgba(58, 108, 200, 0.1)',
    borderRadius: '12px',
    border: '1px solid rgba(58, 108, 200, 0.3)',
  },
  quoteRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    marginBottom: '6px',
    color: '#94a3b8',
  },
  quoteValue: {
    color: '#4ade80',
    fontWeight: 'bold',
  },
  feeValue: {
    color: '#fbbf24',
  },
  executionStatus: {
    marginTop: '12px',
    padding: '10px',
    background: 'rgba(58, 108, 200, 0.2)',
    borderRadius: '8px',
    fontSize: '11px',
    color: '#3a6cc8',
    textAlign: 'center',
  },
  executeButton: {
    width: '100%',
    padding: '14px',
    background: '#3a6cc8',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    marginTop: '16px',
  },
  disabled: {
    background: '#666',
    cursor: 'not-allowed',
  },
  txHash: {
    marginTop: '12px',
    padding: '10px',
    background: 'rgba(74, 222, 128, 0.1)',
    borderRadius: '8px',
    fontSize: '11px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#4ade80',
    flexWrap: 'wrap',
  },
  hashCode: {
    fontFamily: 'monospace',
    fontSize: '10px',
  },
  copyButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
  },
  networksFooter: {
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  footerTitle: {
    fontSize: '10px',
    color: '#94a3b8',
  },
  networkIcons: {
    display: 'flex',
    gap: '8px',
  },
};

export default BridgeWidget;