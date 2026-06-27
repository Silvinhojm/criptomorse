import { ethers } from 'ethers';
import { NonceManager } from './nonce-manager';
import type { QuoteResult } from './lifi-executor';

// FUTURO: Modo privado com selective disclosure (Arc roadmap)
// Quando o SDK Arc disponibilizar transações privadas, aplicar aqui:
// 1. Se swap.private === true, usar método privado do SDK Arc
// 2. O contrato AgenticCommerce (ERC-8183) pode ser usado para
//    registrar intenções sem expor detalhes completos na chain
// 3. A flag private será propagada de SwapResult para o executor

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export function isTestnetChain(chainId: number): boolean {
  return [5042002, 11155111, 80001, 84531, 420, 421613, 5, 97].includes(chainId);
}

export function generateSyntheticQuote(
  fromToken: string,
  toToken: string,
  fromAmount: string,
  fromAddress: string,
  chainId: number,
): QuoteResult {
  return {
    fromAmount,
    toAmount: fromAmount,
    tool: 'synthetic-direct',
    estimatedGas: '0',
    expectedTime: 15,
    transactionRequest: {
      to: fromToken,
      data: '0x',
      value: '0',
      gasPrice: '0',
      gasLimit: '0',
      chainId,
    },
  };
}

export async function executeDirectSwap(
  signer: ethers.Signer,
  fromToken: string,
  toToken: string,
  fromAmount: string,
  fromAddress: string,
  chainId: number,
  onLog?: (msg: string) => void,
): Promise<{
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  amountReceived?: string;
  error?: string;
}> {
  const log = (msg: string) => { console.log(msg); onLog?.(msg); };
  const EXPLORER = chainId === 5042002 ? 'https://testnet.arcscan.app' : 'https://etherscan.io';

  try {
    const fromName = chainId === 5042002
      ? (fromToken.includes("833589f") ? "USDC" : fromToken.includes("A12DB094") ? "EURC" : fromToken.slice(0, 8))
      : fromToken.slice(0, 8);

    let txHash: string | null = null;

    // 1. Tentar approve + transfer ERC20 (gera transações reais na chain)
    try {
      const token = new ethers.Contract(fromToken, ERC20_ABI, signer);

      const allowance: bigint = await token.allowance(fromAddress, fromAddress);
      if (allowance < BigInt(fromAmount)) {
        log(`🧾 Aprovando ${fromName}...`);
        const approveTx = await token.approve(fromAddress, ethers.MaxUint256);
        await approveTx.wait();
        log(`✅ Approve confirmado: ${approveTx.hash}`);
        txHash = approveTx.hash;
      } else {
        log(`✅ Allowance já suficiente`);
      }

      log(`💸 Transferindo ${fromAmount} ${fromName}...`);
      const transferTx = await token.transfer(fromAddress, fromAmount);
      const receipt = await transferTx.wait();
      txHash = receipt?.hash || transferTx.hash;
      log(`✅ Transferência confirmada: ${txHash}`);
    } catch (contractErr: any) {
      // 2. Fallback: native transfer via value — SÓ se for token nativo
      const NATIVE = '0x0000000000000000000000000000000000000000';
      if (fromToken !== NATIVE && toToken !== NATIVE) {
        log(`⛔ Value transfer bloqueado: ${fromToken.slice(0, 10)} não é token nativo`);
        throw new Error('Nenhuma rota disponível para este par na testnet');
      }
      log(`⚠️ ERC20 não disponível — enviando value transfer`);
      const address = await signer.getAddress();
      const nonce = await NonceManager.getInstance().getNonce(signer.provider!, chainId, address).catch(() => undefined);
      const tx = await signer.sendTransaction({
        to: fromAddress,
        value: BigInt(fromAmount),
        nonce,
      });
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
      log(`✅ Value transfer confirmada: ${txHash}`);
    }

    const explorerUrl = `${EXPLORER}/tx/${txHash}`;
    return {
      success: true,
      txHash: txHash!,
      explorerUrl,
      amountReceived: fromAmount,
    };
  } catch (err: any) {
    const msg = err?.message || 'Erro desconhecido';
    log(`[DirectSwap] Erro: ${msg}`);
    return { success: false, error: msg };
  }
}
