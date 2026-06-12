export const BLUE = "#3a6cc8";
export const ORANGE = "#e05a3a";
export const GREEN = "#10b981";
export const RED = "#ef4444";
export const BORDER = "#c8cdd8";
export const GAS_PER_TRADE = 0.12;

export const ARC_TESTNET = {
  id: "arc",
  name: "Arc Testnet",
  shortName: "Arc",
  rpc: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://testnet.arcscan.app",
  icon: "🔵",
  isTestnet: true,
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
} as const;

export const BASE_MAINNET = {
  id: "base",
  name: "Base Mainnet",
  shortName: "Base",
  rpc: "https://mainnet.base.org",
  chainId: 8453,
  chainIdHex: "0x2105",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eurc: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://basescan.org",
  icon: "🟢",
  isTestnet: false,
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
} as const;

export const POLYGON_MAINNET = {
  id: "polygon",
  name: "Polygon (POL)",
  shortName: "Polygon",
  rpc: "https://polygon.drpc.org",
  chainId: 137,
  chainIdHex: "0x89",
  usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  eurc: "0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://polygonscan.com",
  icon: "🟣",
  isTestnet: false,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
} as const;

export const ETHEREUM_MAINNET = {
  id: "ethereum",
  name: "Ethereum Mainnet",
  shortName: "Ethereum",
  rpc: "https://eth.llamarpc.com",
  chainId: 1,
  chainIdHex: "0x1",
  usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  erc8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  explorer: "https://etherscan.io",
  icon: "💙",
  isTestnet: false,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

export type WalletNetwork =
  | typeof ARC_TESTNET
  | typeof BASE_MAINNET
  | typeof POLYGON_MAINNET
  | typeof ETHEREUM_MAINNET;

export const WALLET_NETWORKS: WalletNetwork[] = [
  ARC_TESTNET,
  BASE_MAINNET,
  POLYGON_MAINNET,
  ETHEREUM_MAINNET,
];

export const BRIDGE_TARGET_NETWORKS: WalletNetwork[] = [
  BASE_MAINNET,
  POLYGON_MAINNET,
  ETHEREUM_MAINNET,
];

export const shortAddress = (address: string) =>
  address ? address.slice(0, 6) + "..." + address.slice(-4) : "";

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
