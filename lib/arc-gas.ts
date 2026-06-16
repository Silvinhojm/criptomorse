import { ethers } from "ethers";

const ARC_CHAIN_ID = 5042002;
const MIN_MAX_FEE = ethers.parseUnits("20", "gwei");
const TIP = ethers.parseUnits("1", "gwei");

export function getArcFeeParams(): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  return {
    maxFeePerGas: MIN_MAX_FEE,
    maxPriorityFeePerGas: TIP,
  };
}

export function isArcChain(chainId: number | bigint): boolean {
  return Number(chainId) === ARC_CHAIN_ID;
}

export async function enforceArcFee(
  provider: ethers.Provider,
  chainId?: number
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | Record<string, never>> {
  if (chainId === undefined) {
    try {
      const network = await provider.getNetwork();
      chainId = Number(network.chainId);
    } catch {
      return {};
    }
  }
  if (!isArcChain(chainId)) return {};

  return getArcFeeParams();
}
