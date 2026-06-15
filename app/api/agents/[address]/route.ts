import { NextRequest } from 'next/server';
import { ethers } from 'ethers';

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.network';

const IDENTITY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const provider = new ethers.JsonRpcProvider(ARC_TESTNET_RPC);
const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

export async function GET(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return Response.json({ error: 'Invalid address' }, { status: 400 });
    }

    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 10000);
    const filter = contract.filters.Transfer(ethers.ZeroAddress, address);
    const events = await contract.queryFilter(filter, fromBlock, 'latest');

    if (events.length === 0) {
      return Response.json({ agent: null, message: 'No agent found for this address' });
    }

    const lastEvent = events[events.length - 1] as ethers.EventLog;
    const agentId = Number(lastEvent.args?.tokenId ?? 0);
    const owner = await contract.ownerOf(agentId);
    const tokenURI = await contract.tokenURI(agentId);

    return Response.json({
      agent: {
        agentId,
        owner,
        tokenURI,
      },
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
