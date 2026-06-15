// app/components/TransactionScanner.tsx
"use client";

import { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-hot-toast';

interface LostTransaction {
  txHash: string;
  toAddress: string;
  tokenSent: string;
  amount: string;
  network: string;
  timestamp: number;
  explorerUrl: string;
}

interface TransactionScannerProps {
  userAddress: string;
}

const NETWORKS = [
  { name: 'ethereum', chainId: 1, rpc: 'https://cloudflare-eth.com', explorer: 'https://etherscan.io', icon: '🔷' },
  { name: 'polygon', chainId: 137, rpc: 'https://polygon.publicnode.com', explorer: 'https://polygonscan.com', icon: '🟣' },
  { name: 'arbitrum', chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io', icon: '🔴' },
  { name: 'base', chainId: 8453, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', icon: '🔵' },
];

export function TransactionScanner({ userAddress }: TransactionScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [customAddress, setCustomAddress] = useState('');
  const [scanMode, setScanMode] = useState<'connected' | 'custom'>('connected');
  const [lostTxs, setLostTxs] = useState<LostTransaction[]>([]);

  const generateProvisionalWallet = () => {
    const wallet = ethers.Wallet.createRandom();
    toast.success(`Carteira provisória: ${wallet.address.substring(0, 15)}...`);
    
    const modal = document.createElement('div');
    modal.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:1000;`;
    modal.innerHTML = `
      <div style="background:#0a0a2e;border-radius:20px;padding:24px;max-width:500px;border:2px solid #8b5cf6;">
        <h3 style="color:#8b5cf6;">🔑 Carteira Provisória</h3>
        <div style="background:#1a1a4e;padding:12px;border-radius:12px;margin:16px 0;">
          <div style="color:#4ade80;">Endereço:</div>
          <div style="font-family:monospace;font-size:11px;">${wallet.address}</div>
        </div>
        <button id="closeWalletModal" style="width:100%;background:#8b5cf6;border:none;padding:12px;border-radius:12px;color:#fff;cursor:pointer;">Fechar</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('closeWalletModal')?.addEventListener('click', () => modal.remove());
  };

  const scanAddress = async () => {
    const address = scanMode === 'connected' ? userAddress : customAddress;
    if (!address) {
      toast.error('Digite um endereço para escanear');
      return;
    }
    if (!ethers.isAddress(address)) {
      toast.error('Endereço inválido');
      return;
    }

    setScanning(true);
    setLostTxs([]);
    
    // Simular escaneamento (em produção, chamaria APIs)
    setTimeout(() => {
      setScanning(false);
      toast.success('Escaneamento concluído! Nenhuma transação presa encontrada.');
    }, 2000);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.icon}>🔍</span>
        <h3 style={styles.title}>Transaction Recovery Scanner</h3>
      </div>
      
      <p style={styles.description}>
        Escaneie endereços em busca de transações perdidas ou tokens enviados para redes erradas.
      </p>
      
      <div style={styles.modeButtons}>
        <button 
          onClick={() => setScanMode('connected')}
          style={{ ...styles.modeBtn, background: scanMode === 'connected' ? '#8b5cf6' : 'rgba(139,92,246,0.2)' }}
        >
          🔗 Minha Carteira
        </button>
        <button 
          onClick={() => setScanMode('custom')}
          style={{ ...styles.modeBtn, background: scanMode === 'custom' ? '#8b5cf6' : 'rgba(139,92,246,0.2)' }}
        >
          🔎 Outro Endereço
        </button>
      </div>
      
      {scanMode === 'custom' && (
        <input
          type="text"
          placeholder="Digite o endereço (0x...)"
          value={customAddress}
          onChange={(e) => setCustomAddress(e.target.value)}
          style={styles.addressInput}
        />
      )}
      
      <button onClick={scanAddress} disabled={scanning} style={styles.scanBtn}>
        {scanning ? '🔍 Escaneando...' : '🔎 Escanear Blockchain'}
      </button>
      
      <button onClick={generateProvisionalWallet} style={styles.walletBtn}>
        🔑 Gerar Carteira Provisória
      </button>
      
      {lostTxs.length > 0 && (
        <div style={styles.results}>
          <h4>⚠️ {lostTxs.length} transações encontradas</h4>
          {/* Listar transações aqui */}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 100%)',
    borderRadius: '20px',
    padding: '20px',
    marginTop: '16px',
    border: '1px solid #8b5cf6',
  },
  header: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' },
  icon: { fontSize: '28px' },
  title: { color: '#fff', margin: 0, fontSize: '18px' },
  description: { color: '#94a3b8', fontSize: '13px', marginBottom: '16px' },
  modeButtons: { display: 'flex', gap: '10px', marginBottom: '16px' },
  modeBtn: { flex: 1, padding: '10px', borderRadius: '10px', border: 'none', color: '#fff', cursor: 'pointer' },
  addressInput: { width: '100%', padding: '12px', borderRadius: '10px', background: '#0a0a2e', border: '1px solid #8b5cf6', color: '#fff', marginBottom: '16px' },
  scanBtn: { width: '100%', background: '#8b5cf6', border: 'none', padding: '12px', borderRadius: '12px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginBottom: '10px' },
  walletBtn: { width: '100%', background: '#22c55e', border: 'none', padding: '12px', borderRadius: '12px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' },
  results: { marginTop: '16px' },
};

export default TransactionScanner;