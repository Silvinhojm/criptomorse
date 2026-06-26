// lib/lifi.ts - VERSÃO CORRIGIDA
// Integração com LI.FI SDK para cross-chain swaps e bridges

import * as ethers from 'ethers';
import { NonceManager } from './nonce-manager';
import { getRoutes, getStepTransaction, type Route, type RoutesResponse, type LiFiStep } from '@lifi/sdk';
import { lifiClient } from './lifi-config';
// Re-exportar tipos para uso em outros arquivos
export type { Route, RoutesResponse, LiFiStep };

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// ============================================================
// TIPOS
// ============================================================

export interface LifiRouteParams {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export interface LifiRouteResult {
  success: boolean;
  routes?: RoutesResponse;
  error?: string;
}

export interface LifiQuoteResult {
  success: boolean;
  step?: LiFiStep;
  fromAmount?: string;
  toAmount?: string;
  fromToken?: string;
  toToken?: string;
  estimatedTime?: number;
  fee?: string;
  error?: string;
}

export interface LifiExecutionResult {
  success: boolean;
  route?: Route;
  txHash?: string;
  error?: string;
}

// ============================================================
// FUNÇÕES PRINCIPAIS
// ============================================================

export async function checkLifiRoute({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  fromAddress,
  toAddress,
  slippage = 0.5,
}: LifiRouteParams): Promise<LifiRouteResult> {
  try {
    if (!fromChainId || !toChainId) {
      throw new Error('Chain IDs são obrigatórios');
    }
    if (!fromToken || !toToken) {
      throw new Error('Endereços dos tokens são obrigatórios');
    }
    if (fromChainId === toChainId && fromToken.toLowerCase() === toToken.toLowerCase()) {
      throw new Error('Tokens de origem e destino precisam ser diferentes na mesma rede');
    }
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      throw new Error('Amount deve ser maior que zero');
    }
    if (!fromAddress) {
      throw new Error('Endereço de origem é obrigatório');
    }

    console.log(`🔄 LI.FI: Buscando bridge de ${fromChainId} → ${toChainId}`);
    console.log(`   Token: ${fromToken} → ${toToken}`);
    console.log(`   Amount: ${fromAmount}`);
    console.log(`   Address: ${fromAddress}`);

   const routes = await getRoutes(lifiClient, {
  fromChainId: fromChainId,
      toChainId: toChainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      fromAmount: fromAmount,
      fromAddress: fromAddress,
      toAddress: toAddress || fromAddress,
      options: {
        slippage: slippage / 100,
      },
    });

    if (!routes || !routes.routes || routes.routes.length === 0) {
      console.warn('⚠️ LI.FI: Nenhuma rota encontrada');
      return {
        success: false,
        error: 'Nenhuma rota disponível para esta combinação de redes',
      };
    }

    console.log(`✅ LI.FI: ${routes.routes.length} rotas encontradas`);
    
    return {
      success: true,
      routes,
    };
  } catch (err) {
    console.error('❌ LI.FI: Erro ao buscar rotas:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro desconhecido ao buscar rotas',
    };
  }
}

export async function getBestLifiQuote({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  fromAddress,
  toAddress,
}: LifiRouteParams): Promise<LifiQuoteResult> {
  try {
    if (fromChainId === toChainId && fromToken.toLowerCase() === toToken.toLowerCase()) {
      return { success: false, error: 'Tokens de origem e destino precisam ser diferentes na mesma rede' };
    }
    console.log(`📊 LI.FI: Buscando melhor bridge para ${fromChainId} → ${toChainId}`);

    const routes = await getRoutes(lifiClient, {
  fromChainId: fromChainId,
  toChainId: toChainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      fromAmount: fromAmount,
      fromAddress: fromAddress,
      toAddress: toAddress || fromAddress,
    });

    if (!routes || !routes.routes || routes.routes.length === 0) {
      return {
        success: false,
        error: 'Nenhum quote disponível',
      };
    }

    const bestRoute = routes.routes[0];
    const firstStep = bestRoute.steps[0];
    const lastStep = bestRoute.steps[bestRoute.steps.length - 1];
    
    const fromAmountDecimal = parseFloat(firstStep.action.fromAmount) / Math.pow(10, firstStep.action.fromToken.decimals);
    const toAmountDecimal = lastStep.estimate?.toAmount 
      ? parseFloat(lastStep.estimate.toAmount) / Math.pow(10, lastStep.action.toToken.decimals)
      : 0;
    
    const estimatedTime = bestRoute.steps.reduce((total, step) => {
      return total + (step.estimate?.executionDuration || 0);
    }, 0);
    
    const fee = Math.abs(fromAmountDecimal - toAmountDecimal);
    
    console.log(`✅ LI.FI: Bridge encontrada`);
    console.log(`   De: ${fromAmountDecimal} ${firstStep.action.fromToken.symbol}`);
    console.log(`   Para: ${toAmountDecimal} ${lastStep.action.toToken.symbol}`);

    return {
      success: true,
      step: lastStep,
      fromAmount: fromAmountDecimal.toFixed(6),
      toAmount: toAmountDecimal.toFixed(6),
      fromToken: firstStep.action.fromToken.symbol,
      toToken: lastStep.action.toToken.symbol,
      estimatedTime,
      fee: fee.toFixed(6),
    };
  } catch (err) {
    console.error('❌ LI.FI: Erro ao buscar quote:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro desconhecido ao buscar quote',
    };
  }
}

export async function executeLifiRoute(
  route: Route,
  options?: {
    infiniteApproval?: boolean;
    onUpdate?: (route: Route) => void;
  }
): Promise<LifiExecutionResult> {
  try {
    if (!route) throw new Error('Rota não fornecida');
    if (!route.steps?.length) throw new Error('Rota não possui steps');

    console.log(`🚀 LI.FI: Executando bridge (REST + ethers)...`);
    console.log(`   Steps: ${route.steps.length}`);

    const provider = (window as any).ethereum as ethers.Eip1193Provider | undefined;
    if (!provider) throw new Error('MetaMask não encontrada');

    const browserProvider = new ethers.BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    const fromAddress = await signer.getAddress();

    let lastTxHash = '';

    for (const step of route.steps) {
      console.log(`   Step: ${step.tool} ${step.action.fromChainId} → ${step.action.toChainId}`);

      // Handle ERC-20 approval if needed (check estimate.approvalAddress)
      const approvalAddress = step.estimate?.approvalAddress;
      if (approvalAddress && step.action.fromToken.address) {
        const tokenAddress = step.action.fromToken.address;
        const isNative = tokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000';
        if (!isNative) {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const allowance = await tokenContract.allowance(fromAddress, approvalAddress);
          const amount = BigInt(step.action.fromAmount);
          if (allowance < amount) {
            console.log(`   Aprovando ${step.action.fromToken.symbol} → ${approvalAddress}...`);
            const approveTx = await tokenContract.approve(
              approvalAddress,
              options?.infiniteApproval ? ethers.MaxUint256 : amount,
            );
            await approveTx.wait();
            console.log(`   Aprovação confirmada: ${approveTx.hash}`);
          }
        }
      }

      // Get transaction request via SDK REST API
      const stepWithTx = await getStepTransaction(lifiClient, step as any);
      const txReq = stepWithTx.transactionRequest;
      if (!txReq?.data || !txReq?.to) {
        console.warn(`   Step ${step.tool} sem transactionRequest, pulando`);
        continue;
      }

      const nonce = await NonceManager.getInstance().getNonce(signer.provider!, step.action.fromChainId, fromAddress).catch(() => undefined);
      console.log(`   Enviando transação para ${txReq.to}...`);
      const tx = await signer.sendTransaction({
        to: txReq.to,
        data: txReq.data as `0x${string}`,
        value: BigInt(txReq.value || '0x0'),
        chainId: step.action.fromChainId,
        nonce,
      });

      console.log(`   TX enviada: ${tx.hash}`);
      lastTxHash = tx.hash;

      const receipt = await tx.wait();
      if (receipt && receipt.status === 1) {
        console.log(`   TX confirmada no bloco ${receipt.blockNumber}`);
      } else {
        throw new Error(`Transação falhou on-chain`);
      }
    }

    console.log(`✅ LI.FI: Bridge concluída! TxHash: ${lastTxHash}`);

    return {
      success: true,
      route,
      txHash: lastTxHash,
    };
  } catch (err) {
    console.error('❌ LI.FI: Erro ao executar bridge:', err);

    let errorMessage = 'Erro ao executar bridge';
    if (err instanceof Error) {
      if (err.message.includes('user rejected') || err.message.includes('ACTION_REJECTED')) {
        errorMessage = 'Transação rejeitada pelo usuário';
      } else if (err.message.includes('insufficient')) {
        errorMessage = 'Saldo insuficiente para a transação';
      } else if (err.message.includes('approve')) {
        errorMessage = 'Erro na aprovação do token. Tente novamente.';
      } else {
        errorMessage = err.message;
      }
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export default {
  checkLifiRoute,
  getBestLifiQuote,
  executeLifiRoute,
};