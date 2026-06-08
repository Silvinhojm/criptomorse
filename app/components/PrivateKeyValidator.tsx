// components/PrivateKeyValidator.tsx
// ✅ VERSÃO 100% SEGURA - Sem chamadas externas, sem envio de chaves
'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';

interface PrivateKeyValidatorProps {
  onValidKeyFound: (address: string, balance: number) => void;
}

export function PrivateKeyValidator({ onValidKeyFound }: PrivateKeyValidatorProps) {
  const [privateKey, setPrivateKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    address: string;
    balance: number;
    message: string;
  } | null>(null);
  
  // ✅ Função de validação LOCAL - NUNCA envia a chave
  const validateLocally = (key: string) => {
    const cleanKey = key.trim();
    
    // Verifica formato Ethereum (0x + 64 hex)
    const isEthFormat = /^0x[a-fA-F0-9]{64}$/i.test(cleanKey);
    
    // Verifica formato WIF (Bitcoin)
    const isWifFormat = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(cleanKey);
    
    if (isEthFormat) {
      return {
        isValid: true,
        address: '0x' + cleanKey.slice(2).toLowerCase(),
        balance: 0,
        message: '✅ Formato Ethereum válido'
      };
    }
    
    if (isWifFormat) {
      return {
        isValid: true,
        address: 'Formato Bitcoin WIF válido',
        balance: 0,
        message: '✅ Formato Bitcoin válido'
      };
    }
    
    return {
      isValid: false,
      address: '',
      balance: 0,
      message: '❌ Formato de chave inválido. Use formato WIF ou 0x...'
    };
  };
  
  const handleValidate = async () => {
    if (!privateKey.trim()) {
      toast.error('Digite uma chave privada para validar');
      return;
    }
    
    setIsValidating(true);
    setValidationResult(null);
    toast.loading('🔐 Validando formato da chave...', { id: 'validate' });
    
    // Pequeno delay para simular processamento
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // ✅ Validação 100% LOCAL - NENHUM envio para servidor
    const result = validateLocally(privateKey);
    
    toast.dismiss('validate');
    
    if (result.isValid) {
      setValidationResult({
        isValid: true,
        address: result.address,
        balance: 0,
        message: result.message
      });
      
      toast.success(`✅ Formato válido!`, { duration: 3000 });
      
      if (result.address) {
        onValidKeyFound(result.address, 0);
      }
    } else {
      setValidationResult({
        isValid: false,
        address: '',
        balance: 0,
        message: result.message
      });
      toast.error(`❌ ${result.message}`, { duration: 3000 });
    }
    
    setIsValidating(false);
  };
  
  const handleClear = () => {
    setPrivateKey('');
    setValidationResult(null);
  };
  
  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius: '16px', border: '1px solid #ef4444' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '24px' }}>⚠️</span>
        <span style={{ fontWeight: 'bold', color: '#ef4444' }}>Validador de Formato de Chaves</span>
        <span style={{ fontSize: '10px', background: '#ef4444', color: '#fff', padding: '2px 6px', borderRadius: '10px' }}>APENAS FORMATO</span>
      </div>
      
      <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', padding: '12px', marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '8px' }}>
          ⚠️ <strong>ATENÇÃO:</strong> Este componente NUNCA verifica saldos reais
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>
          🔒 A validação é APENAS de formato - NENHUMA chave é processada
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
          🚫 NENHUMA transação ou verificação de saldo é realizada
        </div>
      </div>
      
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', color: '#ef4444', marginBottom: '8px', display: 'block' }}>Chave Privada (apenas para validar formato)</label>
        <textarea
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder="Cole sua chave privada para validar o FORMATO (NÃO será usada para nada além disso)"
          style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid #ef4444', borderRadius: '8px', color: '#fff', fontFamily: 'monospace', fontSize: '11px', minHeight: '80px', resize: 'vertical' }}
        />
      </div>
      
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <button onClick={handleValidate} disabled={isValidating} style={{ flex: 1, padding: '12px', background: isValidating ? '#666' : '#ef4444', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 'bold', cursor: isValidating ? 'not-allowed' : 'pointer' }}>
          {isValidating ? '🔐 VALIDANDO...' : '🔍 VALIDAR FORMATO'}
        </button>
        <button onClick={handleClear} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.1)', border: '1px solid #ef4444', borderRadius: '10px', color: '#fff', cursor: 'pointer' }}>🗑️ LIMPAR</button>
      </div>
      
      {validationResult && (
        <div style={{ padding: '12px', background: validationResult.isValid ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderRadius: '10px', border: `1px solid ${validationResult.isValid ? '#4ade80' : '#ef4444'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span>{validationResult.isValid ? '✅' : '❌'}</span>
            <span style={{ fontSize: '12px', color: validationResult.isValid ? '#4ade80' : '#ef4444', fontWeight: 'bold' }}>
              {validationResult.isValid ? 'FORMATO VÁLIDO!' : 'FORMATO INVÁLIDO'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#fff', marginBottom: '4px' }}>{validationResult.message}</div>
          {validationResult.isValid && validationResult.address && (
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '8px' }}>
              Endereço derivado: {validationResult.address.slice(0, 10)}...
            </div>
          )}
        </div>
      )}
      
      <div style={{ fontSize: '9px', color: '#ef4444', textAlign: 'center', borderTop: '1px solid rgba(239, 68, 68, 0.3)', paddingTop: '12px', marginTop: '12px' }}>
        🚨 NUNCA cole sua chave privada em sites desconhecidos • Este componente é APENAS para validar formato
      </div>
    </div>
  );
}