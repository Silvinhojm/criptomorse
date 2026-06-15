import { NextRequest } from 'next/server';
import { ethers } from 'ethers';

const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583';
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network';

const ERC8183_ABI = [
  'function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
];

const JOB_STATUS_MAP: Record<number, string> = {
  0: 'Open', 1: 'Funded', 2: 'Submitted', 3: 'Completed', 4: 'Rejected', 5: 'Expired',
};

const provider = new ethers.JsonRpcProvider(ARC_TESTNET_RPC);
const contract = new ethers.Contract(AGENTIC_COMMERCE, ERC8183_ABI, provider);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const count = Math.min(Number(searchParams.get('count')) || 20, 100);

    const filter = contract.filters.JobCreated();
    const events = await contract.queryFilter(filter, -100000, 'latest');
    const totalJobs = events.length;
    if (totalJobs === 0) {
      return Response.json({ jobs: [], total: 0 });
    }

    const lastId = Number((events[totalJobs - 1] as ethers.EventLog).args?.jobId ?? 0);
    const startId = Math.max(1, lastId - count + 1);
    const jobs: any[] = [];

    for (let id = startId; id <= lastId; id++) {
      try {
        const job = await contract.getJob(id);
        const jobData = {
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

        if (address) {
          const addr = address.toLowerCase();
          if (jobData.client.toLowerCase() !== addr && jobData.provider.toLowerCase() !== addr) {
            continue;
          }
        }

        jobs.push(jobData);
      } catch {
        continue;
      }
    }

    return Response.json({ jobs, total: jobs.length });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
