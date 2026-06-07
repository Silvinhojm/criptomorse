// app/components/NetworkSelector.tsx
"use client";

import { useState } from 'react';
import { SUPPORTED_NETWORKS, type Network, switchToNetwork } from '@/lib/networks';
import { toast } from 'react-hot-toast';

interface NetworkSelectorProps {
  currentNetwork: Network;
  onNetworkChange: (network: Network) => void;
  compact?: boolean;
}

export function NetworkSelector({ currentNetwork, onNetworkChange, compact = false }: NetworkSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  
  const mainnets = SUPPORTED_NETWORKS.filter(n => !n.isTestnet && n.isActive);
  const testnets = SUPPORTED_NETWORKS.filter(n => n.isTestnet && n.isActive);
  
  const handleNetworkSelect = async (network: Network) => {
    if (network.id === currentNetwork.id) {
      setIsOpen(false);
      return;
    }
    
    setSwitching(true);
    toast.loading(`🔄 Trocando para ${network.name}...`, { id: 'switch-network' });
    
    try {
      const success = await switchToNetwork(network);
      if (success) {
        onNetworkChange(network);
        toast.success(`✅ Conectado à ${network.name}`, { id: 'switch-network' });
      } else {
        toast.error(`❌ Erro ao conectar à ${network.name}`, { id: 'switch-network' });
      }
    } catch (error) {
      toast.error(`❌ Erro ao trocar de rede`, { id: 'switch-network' });
    } finally {
      setSwitching(false);
      setIsOpen(false);
    }
  };
  
  if (compact) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={switching}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255,255,255,0.15)',
            border: '0.5px solid rgba(255,255,255,0.3)',
            borderRadius: '20px',
            padding: '4px 12px',
            fontSize: '11px',
            color: '#fff',
            cursor: switching ? 'not-allowed' : 'pointer',
            opacity: switching ? 0.6 : 1,
          }}
        >
          <span>{currentNetwork.icon}</span>
          <span>{currentNetwork.shortName}</span>
          {currentNetwork.isTestnet && <span style={{ fontSize: '8px' }}>🧪</span>}
          <span style={{ fontSize: '10px' }}>▼</span>
        </button>
        
        {isOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            background: '#1e1e3a',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '8px',
            minWidth: '180px',
            zIndex: 100,
            backdropFilter: 'blur(10px)',
          }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              🌐 MAINNETS
            </div>
            {mainnets.map(network => (
              <button
                key={network.id}
                onClick={() => handleNetworkSelect(network)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: currentNetwork.id === network.id ? 'rgba(58,108,200,0.3)' : 'none',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: '#fff',
                  textAlign: 'left',
                }}
              >
                <span>{network.icon}</span>
                <span style={{ flex: 1 }}>{network.name}</span>
                {currentNetwork.id === network.id && <span>✓</span>}
              </button>
            ))}
            
            <div style={{ fontSize: '10px', color: '#94a3b8', padding: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px' }}>
              🧪 TESTNETS
            </div>
            {testnets.map(network => (
              <button
                key={network.id}
                onClick={() => handleNetworkSelect(network)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: currentNetwork.id === network.id ? 'rgba(58,108,200,0.3)' : 'none',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: '#fff',
                  textAlign: 'left',
                }}
              >
                <span>{network.icon}</span>
                <span style={{ flex: 1 }}>{network.name}</span>
                {currentNetwork.id === network.id && <span>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>🌐 Rede Atual</span>
        <div style={styles.currentNetwork}>
          <span style={{ fontSize: '24px' }}>{currentNetwork.icon}</span>
          <div>
            <div style={styles.networkName}>{currentNetwork.name}</div>
            <div style={styles.networkType}>
              {currentNetwork.isTestnet ? '🧪 Testnet' : '🌐 Mainnet'}
            </div>
          </div>
        </div>
      </div>
      
      <div style={styles.networkList}>
        <div style={styles.sectionTitle}>Mainnets</div>
        {mainnets.map(network => (
          <button
            key={network.id}
            onClick={() => handleNetworkSelect(network)}
            disabled={switching}
            style={{
              ...styles.networkItem,
              ...(currentNetwork.id === network.id ? styles.networkItemActive : {}),
            }}
          >
            <span style={{ fontSize: '20px' }}>{network.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={styles.networkItemName}>{network.name}</div>
              <div style={styles.networkItemChain}>{network.shortName}</div>
            </div>
            {currentNetwork.id === network.id && <span>✓</span>}
          </button>
        ))}
        
        <div style={styles.sectionTitle}>Testnets</div>
        {testnets.map(network => (
          <button
            key={network.id}
            onClick={() => handleNetworkSelect(network)}
            disabled={switching}
            style={{
              ...styles.networkItem,
              ...(currentNetwork.id === network.id ? styles.networkItemActive : {}),
            }}
          >
            <span style={{ fontSize: '20px' }}>{network.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={styles.networkItemName}>{network.name}</div>
              <div style={styles.networkItemChain}>{network.shortName}</div>
            </div>
            {currentNetwork.id === network.id && <span>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    background: 'rgba(0,0,0,0.3)',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '16px',
  },
  header: {
    marginBottom: '16px',
  },
  currentNetwork: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '8px',
    padding: '12px',
    background: 'rgba(58,108,200,0.2)',
    borderRadius: '12px',
  },
  networkName: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#fff',
  },
  networkType: {
    fontSize: '10px',
    color: '#94a3b8',
  },
  sectionTitle: {
    fontSize: '10px',
    color: '#94a3b8',
    marginTop: '12px',
    marginBottom: '8px',
    paddingLeft: '4px',
  },
  networkList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  networkItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '10px',
    background: 'none',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#fff',
    textAlign: 'left',
    transition: 'all 0.2s',
  },
  networkItemActive: {
    background: 'rgba(58,108,200,0.3)',
  },
  networkItemName: {
    fontSize: '12px',
    fontWeight: 500,
  },
  networkItemChain: {
    fontSize: '9px',
    color: '#94a3b8',
  },
};

export default NetworkSelector;