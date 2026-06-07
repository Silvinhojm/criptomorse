// lib/lifi.ts - VERSÃO CORRIGIDA
// Integração com LI.FI SDK para cross-chain swaps e bridges

import { getRoutes, getQuote, executeRoute, type Route, type RoutesResponse, type LiFiStep } from '@lifi/sdk';
import { BrowserProvider, type Eip1193Provider } from 'ethers';
import { lifiClient } from './lifi-config';
// Re-exportar tipos para uso em outros arquivos
export type { Route, RoutesResponse, LiFiStep };

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
    if (!route) {
      throw new Error('Rota não fornecida');
    }

    console.log(`🚀 LI.FI: Executando bridge...`);
    console.log(`   Steps: ${route.steps.length}`);
    
   const executedRoute = await executeRoute(lifiClient, route, {
      updateRouteHook: (updatedRoute: Route) => {
        console.log(`LI.FI: Atualização da rota`);
        if (options?.onUpdate) {
          options.onUpdate(updatedRoute);
        }
      },
    });

    let txHash = '';
    if (executedRoute.steps.length > 0) {
      const lastStep = executedRoute.steps[executedRoute.steps.length - 1];
      // Acessar o hash da transação de forma segura
      const execution = lastStep as any;
      if (execution && execution.execution && execution.execution.process && execution.execution.process.length > 0) {
        const lastProcess = execution.execution.process[execution.execution.process.length - 1];
        txHash = lastProcess.txHash || '';
      }
    }

    console.log(`✅ LI.FI: Bridge concluída! TxHash: ${txHash}`);

    return {
      success: true,
      route: executedRoute,
      txHash,
    };
  } catch (err) {
    console.error('❌ LI.FI: Erro ao executar bridge:', err);
    
    let errorMessage = 'Erro ao executar bridge';
    if (err instanceof Error) {
      if (err.message.includes('user rejected')) {
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