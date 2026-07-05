export const SOLANA_CONFIG = {
  rpcUrl: "https://api.mainnet-beta.solana.com",
  jupiterApi: "https://quote-api.jup.ag/v6",
  tokens: {
    USDC: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, label: "USDC" },
    BP: { address: "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy", decimals: 6, label: "BP" },
    SOL: { address: "So11111111111111111111111111111111111111112", decimals: 9, label: "SOL" },
  },
  pools: [
    { label: "USDC/BP", tokenA: "USDC", tokenB: "BP", dex: "Raydium" },
  ],
}
