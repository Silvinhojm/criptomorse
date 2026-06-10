import { ethers } from "ethers";
import {
  AGENTIC_COMMERCE_ABI,
  JOB_STATUS_NAMES,
  ZERO_HOOK,
  type JobStatusName,
} from "./agentic-commerce-abi";
import { ERC20_ABI, type WalletNetwork } from "./wallet-config";

export interface OnChainJob {
  id: string;
  description: string;
  budget: string;
  budgetRaw: bigint;
  status: JobStatusName;
  provider: string;
  client: string;
  evaluator: string;
  expiredAt: number;
  createdAt?: number;
}

export interface CreateJobParams {
  provider: string;
  evaluator?: string;
  description: string;
  budgetUsdc: string;
  expiryDays?: number;
}

function getContract(provider: ethers.Provider, network: WalletNetwork) {
  return new ethers.Contract(network.erc8183, AGENTIC_COMMERCE_ABI, provider);
}

function getContractWithSigner(signer: ethers.Signer, network: WalletNetwork) {
  return new ethers.Contract(network.erc8183, AGENTIC_COMMERCE_ABI, signer);
}

function parseJob(raw: {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: bigint | number;
}): OnChainJob {
  const statusIdx = Number(raw.status);
  return {
    id: raw.id.toString(),
    description: raw.description,
    budget: ethers.formatUnits(raw.budget, 6),
    budgetRaw: raw.budget,
    status: JOB_STATUS_NAMES[statusIdx] ?? "Open",
    provider: raw.provider,
    client: raw.client,
    evaluator: raw.evaluator,
    expiredAt: Number(raw.expiredAt),
  };
}

/** Busca jobs onde a conta é client ou provider via eventos on-chain */
export async function fetchJobsForAccount(
  account: string,
  network: WalletNetwork
): Promise<OnChainJob[]> {
  const provider = new ethers.JsonRpcProvider(network.rpc);
  const contract = getContract(provider, network);
  const checksum = ethers.getAddress(account);

  const [asClient, asProvider] = await Promise.all([
    contract.queryFilter(contract.filters.JobCreated(null, checksum, null)),
    contract.queryFilter(contract.filters.JobCreated(null, null, checksum)),
  ]);

  const jobIds = new Set<string>();
  for (const log of [...asClient, ...asProvider]) {
    const parsed = contract.interface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });
    if (parsed?.name === "JobCreated") {
      jobIds.add(parsed.args.jobId.toString());
    }
  }

  const jobs: OnChainJob[] = [];
  for (const id of jobIds) {
    try {
      const raw = await contract.getJob(id);
      const job = parseJob(raw);
      if (job.id !== "0") jobs.push(job);
    } catch {
      // job removido ou id inválido
    }
  }

  return jobs.sort((a, b) => Number(b.id) - Number(a.id));
}

function extractJobIdFromReceipt(
  contract: ethers.Contract,
  receipt: ethers.ContractTransactionReceipt
): string {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "JobCreated") {
        return parsed.args.jobId.toString();
      }
    } catch {
      // outro evento
    }
  }
  throw new Error("Evento JobCreated não encontrado na transação");
}

/** Cria job, define budget e financia escrow com USDC (MetaMask) */
export async function createAndFundJob(
  signer: ethers.Signer,
  network: WalletNetwork,
  params: CreateJobParams
): Promise<{ jobId: string; txHashes: string[] }> {
  const clientAddress = await signer.getAddress();
  const providerAddr = ethers.getAddress(params.provider);
  const evaluator = params.evaluator
    ? ethers.getAddress(params.evaluator)
    : clientAddress;

  if (evaluator === ethers.ZeroAddress) {
    throw new Error("Evaluator não pode ser endereço zero");
  }

  const expiredAt =
    Math.floor(Date.now() / 1000) + (params.expiryDays ?? 7) * 24 * 3600;
  const budgetAmount = ethers.parseUnits(params.budgetUsdc, 6);
  const contract = getContractWithSigner(signer, network);
  const txHashes: string[] = [];

  // 1. createJob
  const createTx = await contract.createJob(
    providerAddr,
    evaluator,
    expiredAt,
    params.description,
    ZERO_HOOK
  );
  txHashes.push(createTx.hash);
  const createReceipt = await createTx.wait();
  if (!createReceipt || createReceipt.status === 0) {
    throw new Error("createJob revertido on-chain");
  }
  const jobId = extractJobIdFromReceipt(contract, createReceipt);

  // 2. setBudget (client ou provider)
  const budgetTx = await contract.setBudget(jobId, budgetAmount, "0x");
  txHashes.push(budgetTx.hash);
  const budgetReceipt = await budgetTx.wait();
  if (!budgetReceipt || budgetReceipt.status === 0) {
    throw new Error("setBudget revertido on-chain");
  }

  // 3. approve USDC
  const usdc = new ethers.Contract(network.usdc, ERC20_ABI, signer);
  const allowance: bigint = await usdc.allowance(clientAddress, network.erc8183);
  if (allowance < budgetAmount) {
    const approveTx = await usdc.approve(network.erc8183, budgetAmount);
    txHashes.push(approveTx.hash);
    const approveReceipt = await approveTx.wait();
    if (!approveReceipt || approveReceipt.status === 0) {
      throw new Error("approve USDC revertido");
    }
  }

  // 4. fund escrow
  const fundTx = await contract.fund(jobId, "0x");
  txHashes.push(fundTx.hash);
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt || fundReceipt.status === 0) {
    throw new Error("fund revertido on-chain");
  }

  return { jobId, txHashes };
}

/** Financia job existente em estado Open (budget já definido) */
export async function fundJob(
  signer: ethers.Signer,
  network: WalletNetwork,
  jobId: string
): Promise<string> {
  const clientAddress = await signer.getAddress();
  const contract = getContractWithSigner(signer, network);
  const raw = await contract.getJob(jobId);
  const job = parseJob(raw);

  if (job.status !== "Open") {
    throw new Error(`Job #${jobId} não está Open (status: ${job.status})`);
  }
  if (job.budgetRaw === 0n) {
    throw new Error("Budget ainda não definido — provider deve chamar setBudget");
  }

  const usdc = new ethers.Contract(network.usdc, ERC20_ABI, signer);
  const allowance: bigint = await usdc.allowance(clientAddress, network.erc8183);
  if (allowance < job.budgetRaw) {
    const approveTx = await usdc.approve(network.erc8183, job.budgetRaw);
    const approveReceipt = await approveTx.wait();
    if (!approveReceipt || approveReceipt.status === 0) {
      throw new Error("approve USDC revertido");
    }
  }

  const fundTx = await contract.fund(jobId, "0x");
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt || fundReceipt.status === 0) {
    throw new Error("fund revertido on-chain");
  }
  return fundTx.hash;
}

export function getJobExplorerUrl(network: WalletNetwork, txHash: string): string {
  return `${network.explorer}/tx/${txHash}`;
}
