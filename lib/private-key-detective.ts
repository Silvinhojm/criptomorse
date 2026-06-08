// lib/private-key-detective.ts
// ✅ VERSÃO SEGURA - Apenas validação de formato, SEM acesso à chave real

export interface ValidationResult {
  isValid: boolean;
  walletAddress?: string;
  balance?: number;
  confidence: number;
  message: string;
  needsFullKey: boolean;
}

class PrivateKeyDetectiveClass {
  // ✅ Método seguro - Apenas valida formato, NÃO processa a chave
  async validatePrivateKey(privateKey: string, expectedAddress?: string): Promise<ValidationResult> {
    
    // ⚠️ NUNCA armazenar, logar ou enviar a privateKey para lugar nenhum
    // ⚠️ NUNCA fazer requisições HTTP com a privateKey
    
    // Validação APENAS de formato
    const cleanKey = privateKey.trim();
    
    // Verifica formato Ethereum
    const isEthFormat = /^0x[a-fA-F0-9]{64}$/i.test(cleanKey);
    
    // Verifica formato WIF (Bitcoin)
    const isWifFormat = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(cleanKey);
    
    if (!isEthFormat && !isWifFormat) {
      return {
        isValid: false,
        confidence: 0,
        message: '❌ Formato de chave inválido. Use formato WIF (Bitcoin) ou 0x... (Ethereum)',
        needsFullKey: false
      };
    }
    
    // ✅ Apenas retorna que o formato é válido
    // NUNCA deriva endereço real ou verifica saldo
    return {
      isValid: true,
      confidence: 100,
      message: isEthFormat ? '✅ Formato Ethereum válido' : '✅ Formato Bitcoin (WIF) válido',
      needsFullKey: false,
      walletAddress: 'Não disponível por segurança',
      balance: 0
    };
  }
  
  // ⚠️ Método desabilitado por segurança
  registerKeyAttempt(privateKey: string, source: string): void {
    // 🔒 ESTE MÉTODO FOI DESABILITADO POR SEGURANÇA
    console.warn('⚠️ Tentativa de registrar chave privada bloqueada por segurança');
    return;
  }
}

export const privateKeyDetective = new PrivateKeyDetectiveClass();