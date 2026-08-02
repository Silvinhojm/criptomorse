import { NextRequest } from 'next/server';
import { ethers } from 'ethers';

const IDENTITY_REGISTRY = '0xd2a801e60a0ab36da3fb17d4a7654b494ba8326b';
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network';

const IDENTITY_ABI = [
  'function walletToAgent(address owner) view returns (uint256)',
  'function getAgentInfo(uint256 agentId) view returns (tuple(uint256 agentId, address owner, address operator, address paymentAddress, uint8 trustLevel, uint256 completedJobs, string agentURI))',
];

const provider = new ethers.JsonRpcProvider(ARC_TESTNET_RPC, 5042002, { staticNetwork: true });
const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

interface AgentIdentityReader {
  walletToAgent(address: string): Promise<bigint>;
  getAgentInfo(agentId: bigint): Promise<{ owner: string; agentURI: string }>;
}

const MAX_RPC_ATTEMPTS = 3;

function isTransientRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('request limit reached')
    || message.includes('timeout')
    || message.includes('network error')
    || message.includes('failed to fetch');
}

async function readWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RPC_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === MAX_RPC_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }

  throw lastError;
}

function createAgentsGetHandler(reader: AgentIdentityReader) {
  return async function GET(_request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
    try {
      const { address } = await params;

      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return Response.json({ error: 'Invalid address' }, { status: 400 });
      }

      const agentId = await readWithRetry(() => reader.walletToAgent(address));

      if (agentId === 0n) {
        return Response.json({ agent: null, message: 'No agent found for this address' });
      }

      const agentInfo = await readWithRetry(() => reader.getAgentInfo(agentId));

      return Response.json({
        agent: {
          agentId: Number(agentId),
          owner: agentInfo.owner,
          tokenURI: agentInfo.agentURI,
        },
      });
    } catch (error: unknown) {
      console.error('[api/agents] Agent registry lookup failed', error);
      return Response.json(
        { error: 'Agent registry temporarily unavailable' },
        { status: 503 },
      );
    }
  };
}

export const GET = createAgentsGetHandler(contract as unknown as AgentIdentityReader);
