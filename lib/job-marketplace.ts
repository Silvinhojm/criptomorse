import { ethers } from 'ethers';

const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583';
const USDC_ARC_TESTNET = '0x3600000000000000000000000000000000000000';
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network';

const ERC8183_ABI = [
  'function createJob(address provider, address evaluator, uint256 expiredAt, string memory description, address hook) external returns (uint256 jobId)',
  'function setBudget(uint256 jobId, uint256 amount, bytes memory optParams) external',
  'function fund(uint256 jobId, bytes memory optParams) external',
  'function submit(uint256 jobId, bytes32 deliverable, bytes memory optParams) external',
  'function complete(uint256 jobId, bytes32 reason, bytes memory optParams) external',
  'function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export const JOB_STATUS_MAP: Record<number, string> = {
  0: 'Open',
  1: 'Funded',
  2: 'Submitted',
  3: 'Completed',
  4: 'Rejected',
  5: 'Expired',
};

export interface JobData {
  id: number;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: string;
  expiredAt: number;
  status: number;
  statusLabel: string;
  hook: string;
}

class JobMarketplace {
  private getPublicProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(ARC_TESTNET_RPC);
  }

  private getSignerProvider(): ethers.BrowserProvider | null {
    if (!window.ethereum) return null;
    return new ethers.BrowserProvider(window.ethereum);
  }

  async createJob(
    provider: string,
    evaluator: string,
    description: string,
    budgetUSDC: number,
    deadlineMinutes = 60
  ): Promise<{ jobId: number; txHash: string }> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, signer);

    const provider_ = new ethers.JsonRpcProvider(ARC_TESTNET_RPC);
    const block = await provider_.getBlock('latest');
    const expiredAt = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + deadlineMinutes * 60;

    const tx = await contract.createJob(provider, evaluator, expiredAt, description, ethers.ZeroAddress);
    const receipt = await tx.wait();

    const iface = new ethers.Interface(ERC8183_ABI);
    const jobCreatedLog = receipt.logs.find((log: any) => {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        return parsed?.name === 'JobCreated';
      } catch { return false; }
    });

    const parsed = jobCreatedLog ? iface.parseLog({ topics: jobCreatedLog.topics as string[], data: jobCreatedLog.data }) : null;
    const jobId = Number(parsed?.args?.jobId ?? 0);

    return { jobId, txHash: tx.hash };
  }

  async setBudget(jobId: number, amountUSDC: number): Promise<string> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, signer);

    const amount = ethers.parseUnits(amountUSDC.toFixed(6), 6);
    const tx = await contract.setBudget(jobId, amount, '0x');
    await tx.wait();
    return tx.hash;
  }

  async approveUSDC(amountUSDC: number): Promise<string> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const usdc = new ethers.Contract(USDC_ARC_TESTNET, ERC20_ABI, signer);

    const amount = ethers.parseUnits(amountUSDC.toFixed(6), 6);
    const tx = await usdc.approve(AGENTIC_COMMERCE, amount);
    await tx.wait();
    return tx.hash;
  }

  async fundJob(jobId: number): Promise<string> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, signer);

    const tx = await contract.fund(jobId, '0x');
    await tx.wait();
    return tx.hash;
  }

  async submitDeliverable(jobId: number, deliverableHash: string): Promise<string> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, signer);

    const tx = await contract.submit(jobId, deliverableHash, '0x');
    await tx.wait();
    return tx.hash;
  }

  async completeJob(jobId: number, reason = 'deliverable-approved'): Promise<string> {
    const signerProvider = this.getSignerProvider();
    if (!signerProvider) throw new Error('MetaMask not available');

    const signer = await signerProvider.getSigner();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, signer);

    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reason));
    const tx = await contract.complete(jobId, reasonHash, '0x');
    await tx.wait();
    return tx.hash;
  }

  async getJob(jobId: number): Promise<JobData | null> {
    try {
      const provider = this.getPublicProvider();
      const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, provider);

      const job = await contract.getJob(jobId);

      return {
        id: Number(job.id),
        client: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        description: job.description,
        budget: ethers.formatUnits(job.budget, 6),
        expiredAt: Number(job.expiredAt),
        status: Number(job.status),
        statusLabel: JOB_STATUS_MAP[Number(job.status)] ?? 'Unknown',
        hook: job.hook,
      };
    } catch {
      return null;
    }
  }

  async listJobs(startId = 1, count = 20): Promise<JobData[]> {
    const jobs: JobData[] = [];

    for (let id = startId; id < startId + count; id++) {
      try {
        const job = await this.getJob(id);
        if (job) jobs.push(job);
      } catch {
        continue;
      }
    }

    return jobs;
  }

  async getLastJobId(): Promise<number> {
    const provider = this.getPublicProvider();
    const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, provider);

    try {
      const filter = contract.filters.JobCreated();
      const events = await contract.queryFilter(filter, -100000, 'latest');
      if (events.length === 0) return 0;
      return Number((events[events.length - 1] as ethers.EventLog).args?.jobId ?? 0);
    } catch {
      return 0;
    }
  }

  async getJobsByAddress(address: string, maxLookup = 50): Promise<JobData[]> {
    const jobs: JobData[] = [];
    const lastId = await this.getLastJobId();
    const startId = Math.max(1, lastId - maxLookup);

    for (let id = startId; id <= lastId; id++) {
      try {
        const job = await this.getJob(id);
        if (job && (job.client.toLowerCase() === address.toLowerCase() || job.provider.toLowerCase() === address.toLowerCase())) {
          jobs.push(job);
        }
      } catch {
        continue;
      }
    }

    return jobs;
  }

  getContractAddress() {
    return AGENTIC_COMMERCE;
  }

  getUSDCAddress() {
    return USDC_ARC_TESTNET;
  }
}

export const jobMarketplace = new JobMarketplace();
