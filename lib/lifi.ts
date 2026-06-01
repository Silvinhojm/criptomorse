import { getRoutes } from "@lifi/sdk";

export async function checkLifiRoute({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  fromAddress,
}: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
}) {
  try {
    const routes = await getRoutes({
      fromChainId,
      toChainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      fromAmount,
      fromAddress,
    });

    return routes;
  } catch (err) {
    console.error("Erro LI.FI:", err);
    return null;
  }
}