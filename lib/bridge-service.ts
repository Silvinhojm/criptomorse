// lib/bridge-service.ts
export const CHAINS: Record<string, { id: number; name: string; icon: string; usdc: string; isTestnet: boolean }> = {
  arc: { id: 5042002, name: "Arc Testnet", icon: "🔵", usdc: "0x3600000000000000000000000000000000000000", isTestnet: true },
  base: { id: 8453, name: "Base", icon: "🟢", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", isTestnet: false },
  polygon: { id: 137, name: "Polygon", icon: "🟣", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", isTestnet: false },
  ethereum: { id: 1, name: "Ethereum", icon: "💙", usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", isTestnet: false }
};

type ChainKey = keyof typeof CHAINS;

class BridgeService {
  async getQuote(fromChain: ChainKey, toChain: ChainKey, amount: number, fromAddress: string, toAddress: string) {
    return { amount: amount.toString(), fee: (amount * 0.001).toFixed(6), total: (amount * 1.001).toFixed(6), estimatedTime: "~2-5 min", routes: [] };
  }

  executeBridge(fromChain: ChainKey, toChain: ChainKey, amount: number, toAddress: string) {
    const from = CHAINS[fromChain];
    const to = CHAINS[toChain];
    return { url: `https://jumper.exchange/?fromChain=${from.id}&fromToken=${from.usdc}&toChain=${to.id}&toToken=${to.usdc}&toAddress=${toAddress}&fromAmount=${Math.floor(amount * 1e6)}` };
  }

  getUniARCBridgeUrl(toChain: string, toAddress: string) { 
    return `https://bridge.uniarc.xyz?to=${toChain}&address=${toAddress}`; 
  }

  getSupportedNetworks() { 
    return Object.entries(CHAINS).map(([k, v]) => ({ id: k, name: v.name, icon: v.icon, chainId: v.id, isTestnet: v.isTestnet })); 
  }
}

export const bridgeService = new BridgeService();
