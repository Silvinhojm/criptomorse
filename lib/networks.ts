// lib/networks.ts
// Configuração de múltiplas redes blockchain para LI.FI

export interface Network {
  id: string;
  name: string;
  shortName: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  tokens: Token[];
  icon: string;
  isTestnet: boolean;
  isActive: boolean;
  lifiId?: number; // ID usado pelo LI.FI
}

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  lifiId?: string;
}

// ============================================================
// REDES SUPORTADAS PELO LI.FI
// ============================================================

export const SUPPORTED_NETWORKS: Network[] = [
  // ARC Testnet
 // ARC Testnet
  {
    id: 'arc-testnet',
    name: 'Arc Testnet',
    shortName: 'ARC',
    chainId: 5042002, // Alinhado com o ID da sua MetaMask
    chainIdHex: '0x4cef52', // Hexadecimal correspondente a 5042002
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorerUrl: 'https://testnet.arcscan.app',
    nativeCurrency: {
      name: 'USDC',
      symbol: 'USDC',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x3600000000000000000000000000000000000000', decimals: 6, icon: '💵' },
      { symbol: 'EURC', name: 'Euro Coin', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, icon: '💶' },
      { symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8, icon: '₿' },
      { symbol: 'mcirBTC', name: 'Mock cirBTC', address: '0x8cad4951192853D14f8Cb813695146b5Ae00EA6d', decimals: 8, icon: '₿' },
    ],
    icon: '🔵',
    isTestnet: true,
    isActive: true,
    lifiId: 5042002,
  },
  // Base Mainnet
  {
    id: 'base',
    name: 'Base',
    shortName: 'BASE',
    chainId: 8453,
    chainIdHex: '0x2105',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 6, icon: '💰' },
      { symbol: 'ETH', name: 'Ethereum', address: '0x4200000000000000000000000000000000000006', decimals: 18, icon: '⬜' },
      { symbol: 'DAI', name: 'Dai', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, icon: '🟡' },
    ],
    icon: '🔵',
    isTestnet: false,
    isActive: true,
    lifiId: 8453,
  },
  
  // Ethereum Mainnet
  {
    id: 'ethereum',
    name: 'Ethereum',
    shortName: 'ETH',
    chainId: 1,
    chainIdHex: '0x1',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, icon: '💰' },
      { symbol: 'ETH', name: 'Ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, icon: '⬜' },
      { symbol: 'DAI', name: 'Dai', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, icon: '🟡' },
      { symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: '0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E', decimals: 8, icon: '₿' },
      { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, icon: '₿' },
      { symbol: 'EURC', name: 'Euro Coin', address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6, icon: '💶' },
    ],
    icon: '⬜',
    isTestnet: false,
    isActive: true,
    lifiId: 1,
  },
  
  // Polygon
  {
    id: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    chainId: 137,
    chainIdHex: '0x89',
    rpcUrl: 'https://polygon.publicnode.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'Polygon',
      symbol: 'POL',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, icon: '💰' },
      { symbol: 'POL', name: 'Polygon', address: '0x0000000000000000000000000000000000001010', decimals: 18, icon: '🟣' },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, icon: '⬜' },
    ],
    icon: '🟣',
    isTestnet: false,
    isActive: true,
    lifiId: 137,
  },
  
  // Arbitrum
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    shortName: 'ARB',
    chainId: 42161,
    chainIdHex: '0xa4b1',
    rpcUrl: 'https://arb1.llamarpc.com',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, icon: '💰' },
      { symbol: 'ETH', name: 'Ethereum', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, icon: '⬜' },
    ],
    icon: '🔷',
    isTestnet: false,
    isActive: true,
    lifiId: 42161,
  },
  
  // Ethereum Sepolia (testnet)
  {
    id: 'sepolia',
    name: 'Ethereum Sepolia',
    shortName: 'Sepolia',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    rpcUrl: 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Sepolia ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, icon: '💵' },
      { symbol: 'WETH', name: 'Wrapped Ether', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18, icon: '⬜' },
    ],
    icon: '🧪',
    isTestnet: true,
    isActive: true,
    lifiId: 11155111,
  },

  // Optimism
  {
    id: 'optimism',
    name: 'Optimism',
    shortName: 'OP',
    chainId: 10,
    chainIdHex: '0xa',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, icon: '💰' },
      { symbol: 'ETH', name: 'Ethereum', address: '0x4200000000000000000000000000000000000006', decimals: 18, icon: '⬜' },
    ],
    icon: '🟠',
    isTestnet: false,
    isActive: true,
    lifiId: 10,
  },
  
  // BNB Chain
  {
    id: 'bnb',
    name: 'BNB Chain',
    shortName: 'BNB',
    chainId: 56,
    chainIdHex: '0x38',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, icon: '💰' },
      { symbol: 'BNB', name: 'BNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, icon: '🟡' },
      { symbol: 'ETH', name: 'Ethereum', address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18, icon: '⬜' },
    ],
    icon: '🟡',
    isTestnet: false,
    isActive: true,
    lifiId: 56,
  },
  
  // Avalanche
  {
    id: 'avalanche',
    name: 'Avalanche',
    shortName: 'AVAX',
    chainId: 43114,
    chainIdHex: '0xa86a',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18,
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6, icon: '💵' },
      { symbol: 'USDT', name: 'Tether', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6, icon: '💰' },
      { symbol: 'AVAX', name: 'Avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18, icon: '🔴' },
    ],
    icon: '🔴',
    isTestnet: false,
    isActive: true,
    lifiId: 43114,
  },
];

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

export function getNetworkById(id: string): Network | undefined {
  return SUPPORTED_NETWORKS.find(n => n.id === id);
}

export function getNetworkByChainId(chainId: number): Network | undefined {
  return SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
}

export function getActiveNetworks(): Network[] {
  return SUPPORTED_NETWORKS.filter(n => n.isActive);
}

export function getMainnets(): Network[] {
  return SUPPORTED_NETWORKS.filter(n => !n.isTestnet && n.isActive);
}

export function getTestnets(): Network[] {
  return SUPPORTED_NETWORKS.filter(n => n.isTestnet && n.isActive);
}

export function getTokensForNetwork(networkId: string): Token[] {
  const network = getNetworkById(networkId);
  return network?.tokens || [];
}

// Função para adicionar rede à MetaMask
export async function addNetworkToMetaMask(network: Network): Promise<boolean> {
  if (!window.ethereum) {
    console.error('MetaMask não instalada');
    return false;
  }
  
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: network.chainIdHex,
        chainName: network.name,
        nativeCurrency: network.nativeCurrency,
        rpcUrls: [network.rpcUrl],
        blockExplorerUrls: [network.explorerUrl],
      }],
    });
    return true;
  } catch (error) {
    console.error('Erro ao adicionar rede:', error);
    return false;
  }
}

// Função para trocar de rede
export async function switchToNetwork(network: Network): Promise<boolean> {
  if (!window.ethereum) {
    console.error('MetaMask não instalada');
    return false;
  }
  
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainIdHex }],
    });
    return true;
  } catch (error: any) {
    if (error.code === 4902) {
      return await addNetworkToMetaMask(network);
    }
    console.error('Erro ao trocar de rede:', error);
    return false;
  }
}

export default SUPPORTED_NETWORKS;