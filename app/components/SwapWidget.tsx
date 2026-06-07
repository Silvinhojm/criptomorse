// app/components/SwapWidget.tsx
"use client";

import { useState } from 'react';
import { toast } from 'react-hot-toast';

interface SwapWidgetProps {
  account: string;
  network: any;
  onClose: () => void;
}

const TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', balance: '0.00' },
  { symbol: 'EURC', name: 'Euro Coin', balance: '0.00' },
  { symbol: 'WETH', name: 'Wrapped ETH', balance: '0.00' },
  { symbol: 'WBTC', name: 'Wrapped BTC', balance: '0.00' },
];

export function SwapWidget({ account, network, onClose }: SwapWidgetProps) {
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [amount, setAmount] = useState('');

  const openJumperSwap = () => {
    const url = `https://jumper.exchange/?fromChain=${network.chainId}&fromToken=${fromToken.symbol}&toChain=${network.chainId}&toToken=${toToken.symbol}&fromAddress=${account}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast.success('Jumper Exchange aberto para swap!');
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>🔄 Swap de Tokens</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.content}>
          <div style={styles.swapContainer}>
            <div style={styles.tokenBox}>
              <label style={styles.label}>De:</label>
              <select 
                value={fromToken.symbol} 
                onChange={(e) => setFromToken(TOKENS.find(t => t.symbol === e.target.value) || TOKENS[0])}
                style={styles.select}
              >
                {TOKENS.map(t => (
                  <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                ))}
              </select>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                style={styles.input}
              />
            </div>

            <div style={styles.swapIcon}>↓</div>

            <div style={styles.tokenBox}>
              <label style={styles.label}>Para:</label>
              <select 
                value={toToken.symbol} 
                onChange={(e) => setToToken(TOKENS.find(t => t.symbol === e.target.value) || TOKENS[1])}
                style={styles.select}
              >
                {TOKENS.map(t => (
                  <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                ))}
              </select>
              <div style={styles.estimatedAmount}>
                ~{amount ? (parseFloat(amount) * 0.99).toFixed(2) : '0.00'} {toToken.symbol}
              </div>
            </div>
          </div>

          <button onClick={openJumperSwap} style={styles.swapBtn}>
            🔄 Abrir Jumper Swap
          </button>

          <p style={styles.note}>
            O Jumper Exchange será aberto em nova aba para realizar o swap.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 100%)',
    borderRadius: '24px',
    width: '90%',
    maxWidth: '400px',
    border: '1px solid #8b5cf6',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(139,92,246,0.3)',
  },
  title: {
    color: '#fff',
    margin: 0,
    fontSize: '18px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: '24px',
    cursor: 'pointer',
  },
  content: {
    padding: '20px',
  },
  swapContainer: {
    marginBottom: '20px',
  },
  tokenBox: {
    background: '#0a0a2e',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '8px',
  },
  label: {
    fontSize: '11px',
    color: '#94a3b8',
    marginBottom: '8px',
    display: 'block',
  },
  select: {
    width: '100%',
    padding: '10px',
    borderRadius: '10px',
    background: '#1a1a4e',
    color: '#fff',
    border: '1px solid #8b5cf6',
    marginBottom: '12px',
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '12px',
    borderRadius: '10px',
    background: '#1a1a4e',
    color: '#fff',
    border: '1px solid #8b5cf6',
    fontSize: '16px',
  },
  swapIcon: {
    textAlign: 'center' as const,
    fontSize: '24px',
    color: '#8b5cf6',
    margin: '8px 0',
  },
  estimatedAmount: {
    fontSize: '12px',
    color: '#94a3b8',
    marginTop: '8px',
  },
  swapBtn: {
    width: '100%',
    background: '#8b5cf6',
    border: 'none',
    padding: '14px',
    borderRadius: '12px',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  note: {
    fontSize: '11px',
    color: '#6b7280',
    textAlign: 'center' as const,
    marginTop: '16px',
  },
};

export default SwapWidget;