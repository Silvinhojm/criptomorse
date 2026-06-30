import { ethers } from "ethers"
import { AGENTIC_COMMERCE_ABI } from "./agentic-commerce-abi"

export interface ContractInfo {
  name: string
  symbol: string
  address: string
  network: string
  deployTx?: string
  description: string
  source: string
  explorerUrl: string
  abi: ethers.InterfaceAbi
  deployBlock?: number
  tags: string[]
  metadata?: Record<string, string>
}

const AMM_ABI: ethers.InterfaceAbi = [
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalLiquidity() view returns (uint256)",
  "function liquidity(address) view returns (uint256)",
  "function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) returns (uint256)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()",
  "event Swap(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "event AddLiquidity(address indexed user, uint256 amount0, uint256 amount1, uint256 liquidityMinted)",
]

const JOB_PROOF_ABI: ethers.InterfaceAbi = [
  "function robotName() view returns (string)",
  "function jobNumber() view returns (uint256)",
  "function timestamp() view returns (uint256)",
  "function deployer() view returns (address)",
  "event JobDeployed(string robotName, uint256 jobNumber, address indexed deployer)",
]

const AGENT_IDENTITY_ABI: ethers.InterfaceAbi = [
  "function registerAgent(string calldata agentURI) returns (uint256 agentId)",
  "function getAgentInfo(uint256 agentId) view returns (tuple(uint256 agentId, address owner, address operator, address paymentAddress, uint8 trustLevel, uint256 completedJobs, string agentURI))",
  "function walletToAgent(address) view returns (uint256)",
  "function totalAgents() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)",
]

const KNOWN_CONTRACTS: ContractInfo[] = [
  // ── Arc Testnet ───────────────────────────────────────────
  {
    name: "GenericAMMPair",
    symbol: "AMM-USDC/EURC",
    address: "0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb",
    network: "arc",
    description: "Uniswap V2-style AMM para swaps stablecoin USDC↔EURC na Arc testnet. Fee 0.3%, Ownable com pause.",
    source: "contracts/GenericAMMPair.sol",
    deployTx: "",
    explorerUrl: "https://testnet.arcscan.app/address/0xA1e418D16C969FdB9482716C7e2bD3d31872EBfb",
    abi: AMM_ABI,
    tags: ["amm", "dex", "stablecoin", "arc"],
    metadata: { liquidity: "$17.28 USDC + $16.00 EURC", fee: "0.3%" },
  },
  {
    name: "AgenticCommerce (ERC-8183) v1",
    symbol: "ERC8183",
    address: "0x319227cf1de5c61d11313af8226a8f5309fa70d9",
    network: "arc",
    description: "Job marketplace ERC-8183 para agents autônomos CriptoMorse. Usado pelo job-marketplace.ts.",
    source: "contracts/ERC8183.sol",
    deployTx: "",
    explorerUrl: "https://testnet.arcscan.app/address/0x319227cf1de5c61d11313af8226a8f5309fa70d9",
    abi: AGENTIC_COMMERCE_ABI,
    tags: ["marketplace", "jobs", "erc8183", "arc"],
  },
  {
    name: "AgenticCommerce (ERC-8183) v2",
    symbol: "ERC8183",
    address: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    network: "arc",
    description: "Job marketplace ERC-8183 — deploy unificado usado pelo wallet-config.ts em Arc, Base, Polygon e Ethereum.",
    source: "contracts/ERC8183.sol",
    deployTx: "",
    explorerUrl: "https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583",
    abi: AGENTIC_COMMERCE_ABI,
    tags: ["marketplace", "jobs", "erc8183", "arc", "multichain"],
  },
  {
    name: "AgentIdentity (ERC-8004)",
    symbol: "CMAI",
    address: "0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b",
    network: "arc",
    description: "Identity Registry ERC-8004 para agentes CriptoMorse. ERC-721 com trust levels, payment addresses, integração ERC-8183.",
    source: "contracts/AgentIdentity.sol",
    deployTx: "",
    explorerUrl: "https://testnet.arcscan.app/address/0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b",
    abi: AGENT_IDENTITY_ABI,
    tags: ["identity", "erc8004", "nft", "arc"],
  },
  {
    name: "AgentIdentity (ERC-8004) Base",
    symbol: "CMAI",
    address: "0xaeb95e2532a73a097e03584cb244eeca9b5609a5",
    network: "base",
    description: "Identity Registry ERC-8004 na Base Mainnet.",
    source: "contracts/AgentIdentity.sol",
    deployTx: "",
    explorerUrl: "https://basescan.org/address/0xaeb95e2532a73a097e03584cb244eeca9b5609a5",
    abi: AGENT_IDENTITY_ABI,
    tags: ["identity", "erc8004", "nft", "base"],
  },
  // JobProof não tem endereço fixo — deployado dinamicamente pelo job-robot.ts
  // MicroPool.sol é conceitual (não deployado)

  // ── Polygon ──────────────────────────────────────────────
  {
    name: "AgenticCommerce (ERC-8183) Polygon",
    symbol: "ERC8183",
    address: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    network: "polygon",
    description: "Job marketplace ERC-8183 (mesmo address multi-chain).",
    source: "contracts/ERC8183.sol",
    deployTx: "",
    explorerUrl: "https://polygonscan.com/address/0x0747EEf0706327138c69792bF28Cd525089e4583",
    abi: AGENTIC_COMMERCE_ABI,
    tags: ["marketplace", "jobs", "erc8183", "polygon"],
  },

  // ── Base ─────────────────────────────────────────────────
  {
    name: "AgenticCommerce (ERC-8183) Base",
    symbol: "ERC8183",
    address: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    network: "base",
    description: "Job marketplace ERC-8183 (mesmo address multi-chain).",
    source: "contracts/ERC8183.sol",
    deployTx: "",
    explorerUrl: "https://basescan.org/address/0x0747EEf0706327138c69792bF28Cd525089e4583",
    abi: AGENTIC_COMMERCE_ABI,
    tags: ["marketplace", "jobs", "erc8183", "base"],
  },

  // ── Ethereum ─────────────────────────────────────────────
  {
    name: "AgenticCommerce (ERC-8183) Ethereum",
    symbol: "ERC8183",
    address: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    network: "ethereum",
    description: "Job marketplace ERC-8183 (mesmo address multi-chain).",
    source: "contracts/ERC8183.sol",
    deployTx: "",
    explorerUrl: "https://etherscan.io/address/0x0747EEf0706327138c69792bF28Cd525089e4583",
    abi: AGENTIC_COMMERCE_ABI,
    tags: ["marketplace", "jobs", "erc8183", "ethereum"],
  },
]

class ContractRegistry {
  private _dynamicContracts: ContractInfo[] = []
  private _observers: Array<(contracts: ContractInfo[]) => void> = []

  getAll(network?: string): ContractInfo[] {
    let all = [...KNOWN_CONTRACTS, ...this._dynamicContracts]
    if (network) all = all.filter(c => c.network === network)
    return all
  }

  getByAddress(address: string): ContractInfo | undefined {
    const addr = address.toLowerCase()
    return this.getAll().find(c => c.address.toLowerCase() === addr)
  }

  getByTag(tag: string, network?: string): ContractInfo[] {
    return this.getAll(network).filter(c => c.tags.includes(tag))
  }

  getDeployed(network?: string): ContractInfo[] {
    return this.getAll(network).filter(c => c.address.length > 0)
  }

  registerDynamic(info: ContractInfo): void {
    const existing = this._dynamicContracts.findIndex(
      c => c.address.toLowerCase() === info.address.toLowerCase()
    )
    if (existing >= 0) {
      this._dynamicContracts[existing] = info
    } else {
      this._dynamicContracts.push(info)
    }
    this._notify()
  }

  async getAMMReserves(address: string, rpcUrl: string): Promise<{ reserve0: bigint; reserve1: bigint; token0: string; token1: string; paused: boolean } | null> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(address, AMM_ABI, provider)
      const [r0, r1, t0, t1, paused] = await Promise.all([
        contract.reserve0(),
        contract.reserve1(),
        contract.token0(),
        contract.token1(),
        contract.paused(),
      ])
      return { reserve0: r0, reserve1: r1, token0: t0, token1: t1, paused }
    } catch {
      return null
    }
  }

  async getAgentIdentityInfo(address: string, rpcUrl: string): Promise<{ totalAgents: number } | null> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(address, AGENT_IDENTITY_ABI, provider)
      const total = await contract.totalAgents()
      return { totalAgents: Number(total) }
    } catch {
      return null
    }
  }

  onChange(cb: (contracts: ContractInfo[]) => void): () => void {
    this._observers.push(cb)
    return () => {
      this._observers = this._observers.filter(o => o !== cb)
    }
  }

  private _notify(): void {
    const all = this.getAll()
    for (const cb of this._observers) cb(all)
  }
}

export const contractRegistry = new ContractRegistry()
export { KNOWN_CONTRACTS, AMM_ABI, JOB_PROOF_ABI, AGENT_IDENTITY_ABI }