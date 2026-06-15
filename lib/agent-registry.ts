import { ethers } from 'ethers';

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network';

const IDENTITY_ABI = [
  'function register(string memory metadataURI) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, int128 score, uint8 confidence, string memory tag, string memory metadataURI, string memory metadataHash, string memory proofURI, bytes32 proofHash) external',
  'function getFeedback(uint256 agentId) view returns (tuple(int128 score, uint8 confidence, string tag, uint256 timestamp, address rater)[])',
];

interface AgentInfo {
  agentId: number;
  owner: string;
  tokenURI: string;
}

interface FeedbackEntry {
  score: number;
  confidence: number;
  tag: string;
  timestamp: number;
  rater: string;
}

class AgentRegistry {
  private getPublicProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(ARC_TESTNET_RPC);
  }

  private getSignerProvider(): ethers.BrowserProvider | null {
    if (!window.ethereum) return null;
    return new ethers.BrowserProvider(window.ethereum);
  }

  async registerAgent(metadataURI: string): Promise<{ agentId: number; txHash: string }> {
    const provider = this.getSignerProvider();
    if (!provider) throw new Error('MetaMask not available');

    const signer = await provider.getSigner();
    const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, signer);

    const tx = await contract.register(metadataURI);
    const receipt = await tx.wait();

    const logs = contract.interface.parseLog(receipt.logs[0]);
    const agentId = Number(logs?.args?.tokenId ?? 0);

    return { agentId, txHash: tx.hash };
  }

  async getAgentInfo(agentId: number): Promise<AgentInfo> {
    const provider = this.getPublicProvider();
    const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

    const [owner, tokenURI] = await Promise.all([
      contract.ownerOf(agentId),
      contract.tokenURI(agentId),
    ]);

    return { agentId, owner, tokenURI };
  }

  async resolveAgentFromOwner(ownerAddress: string): Promise<AgentInfo | null> {
    const provider = this.getPublicProvider();
    const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

    try {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10000);
      const filter = contract.filters.Transfer(ethers.ZeroAddress, ownerAddress);
      const events = await contract.queryFilter(filter, fromBlock, 'latest');
      if (events.length === 0) return null;

      const lastEvent = events[events.length - 1] as ethers.EventLog;
      const agentId = Number(lastEvent.args?.tokenId ?? 0);
      return this.getAgentInfo(agentId);
    } catch {
      return null;
    }
  }

  async getAgentFeedback(agentId: number): Promise<FeedbackEntry[]> {
    const provider = this.getPublicProvider();
    const contract = new ethers.Contract(REPUTATION_REGISTRY, REPUTATION_ABI, provider);

    try {
      const feedback = await contract.getFeedback(agentId);
      return (feedback as any[]).map((f: any) => ({
        score: Number(f.score),
        confidence: Number(f.confidence),
        tag: f.tag,
        timestamp: Number(f.timestamp),
        rater: f.rater,
      }));
    } catch {
      return [];
    }
  }

  async getLastAgentId(): Promise<number> {
    const provider = this.getPublicProvider();
    const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

    try {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10000);
      const filter = contract.filters.Transfer(ethers.ZeroAddress);
      const events = await contract.queryFilter(filter, fromBlock, 'latest');
      if (events.length === 0) return 0;
      return Number((events[events.length - 1] as ethers.EventLog).args?.tokenId ?? 0);
    } catch {
      return 0;
    }
  }

  async listAgents(maxCount = 10): Promise<AgentInfo[]> {
    const lastId = await this.getLastAgentId();
    if (lastId === 0) return [];

    const startId = Math.max(1, lastId - maxCount + 1);
    const agents: AgentInfo[] = [];

    for (let id = startId; id <= lastId; id++) {
      try {
        const info = await this.getAgentInfo(id);
        agents.push(info);
      } catch {
        continue;
      }
    }

    return agents;
  }

  getContractAddresses() {
    return {
      identityRegistry: IDENTITY_REGISTRY,
      reputationRegistry: REPUTATION_REGISTRY,
      validationRegistry: VALIDATION_REGISTRY,
    };
  }
}

export const agentRegistry = new AgentRegistry();
export type { AgentInfo, FeedbackEntry };
