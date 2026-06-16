import { createClient, fetchExchange, type Client } from 'urql';

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || '';

let client: Client | null = null;

function getClient(): Client | null {
  if (!SUBGRAPH_URL) return null;
  if (!client) {
    client = createClient({
      url: SUBGRAPH_URL,
      exchanges: [fetchExchange],
      requestPolicy: 'network-only',
    });
  }
  return client;
}

export interface SubgraphJob {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: string;
  status: string;
  createdAt: string;
  createdTx: string;
  activities?: SubgraphActivity[];
}

export interface SubgraphActivity {
  id: string;
  action: string;
  actor: string;
  deliverable?: string;
  reason?: string;
  timestamp: string;
  txHash: string;
}

export interface SubgraphGlobalStats {
  totalJobs: string;
  totalFunded: string;
  totalCompleted: string;
  totalRejected: string;
}

export async function queryJobs(first = 20, skip = 0): Promise<SubgraphJob[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c.query(`
    query ($first: Int, $skip: Int) {
      jobs(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
        id, client, provider, evaluator, description, budget, status, createdAt, createdTx
      }
    }
  `, { first, skip }).toPromise();
  if (error) { console.warn('Subgraph query error:', error.message); return []; }
  return data?.jobs ?? [];
}

export async function queryJobsByAddress(account: string, first = 30): Promise<SubgraphJob[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c.query(`
    query ($account: Bytes!, $first: Int) {
      jobs(first: $first, where: { or: [{ client: $account }, { provider: $account }] }, orderBy: createdAt, orderDirection: desc) {
        id, client, provider, description, budget, status, createdAt
      }
    }
  `, { account: account.toLowerCase(), first }).toPromise();
  if (error) { console.warn('Subgraph query error:', error.message); return []; }
  return data?.jobs ?? [];
}

export async function queryGlobalStats(): Promise<SubgraphGlobalStats | null> {
  const c = getClient();
  if (!c) return null;
  const { data, error } = await c.query(`
    query { globalStats(id: "global") { totalJobs, totalFunded, totalCompleted, totalRejected } }
    `, {}).toPromise();
  if (error) { console.warn('Subgraph query error:', error.message); return null; }
  return data?.globalStats ?? null;
}

export function isSubgraphAvailable(): boolean {
  return !!SUBGRAPH_URL;
}
