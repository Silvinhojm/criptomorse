import { ethers } from 'ethers';

// ─── CCTP V2 — Endereços oficiais Circle / Arc (docs.arc.io) ────────────────
// Mainnet TokenMessengerV2: 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d
// Mainnet MessageTransmitterV2: 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
// Mainnet TokenMinterV2: 0xfd78EE919681417d192449715b2594ab58f5D002
//
// Arc Testnet:
//   TokenMessengerV2:    0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
//   MessageTransmitterV2: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
//   TokenMinterV2:       0xb43db544E2c27092c107639Ad201b3dEfAbcF192
//   MessageV2:           0xbaC0179bB358A8936169a63408C8481D582390C4  ← útil para decode/hash de mensagens
//
// V2 Domains: Ethereum=0, Arbitrum=3, Base=6, Polygon=7, Arc=26
export const CCTP_CONFIG = {
  arc: {
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    usdc: '0x3600000000000000000000000000000000000000',
    chainId: 5042002,
    domainId: 26,
    rpcUrl: 'https://rpc.testnet.arc.network',
  },
  base: {
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    domainId: 6,
    rpcUrl: 'https://mainnet.base.org',
  },
  polygon: {
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 137,
    domainId: 7,
    rpcUrl: 'https://polygon.publicnode.com',
  },
  ethereum: {
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    domainId: 0,
    rpcUrl: 'https://eth.llamarpc.com',
  },
  arbitrum: {
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    domainId: 3,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
};

const CCTP_DOMAIN_IDS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  polygon: 7,
  base: 6,
  arbitrum: 3,
  optimism: 2,
  arc: 26,
  solana: 5,
};

const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, uint256 maxFee, uint32 minFinalityThreshold) external',
  'event DepositForBurn(address indexed from, uint256 amount, uint32 indexed destinationDomain, bytes32 indexed mintRecipient, address burnToken, bytes32 indexed maxFee, bytes extraData)',
  'function MAX_BURN_AMOUNT_PER_MESSAGE() view returns (uint256)',
];

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes calldata message, bytes calldata attestation) external',
  'event MessageReceived(bytes32 indexed messageHash, address indexed sender, bytes message)',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const ATTESTATION_SERVICE_URL = 'https://iris-api.circle.com/v2/messages';
const ATTESTATION_SERVICE_SANDBOX_URL = 'https://iris-api-sandbox.circle.com/v2/messages';

export interface CCTPTransfer {
  txHash: string;
  amount: number;
  fromChain: string;
  toChain: string;
  recipient: string;
  status: 'pending' | 'attestation_ready' | 'completed' | 'failed';
  timestamp: number;
  messageHash?: string;
  attestation?: string;
}

export interface CCTPStep {
  name: 'approve' | 'burn' | 'fetch_attestation' | 'mint';
  state: 'pending' | 'success' | 'error';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export class CCTPService {
  private providers: Record<string, ethers.JsonRpcProvider>;

  // Balance cache: 10s TTL + 200ms rate limit entre RPC calls
  private balanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private lastRpcCall = 0;
  private readonly BALANCE_CACHE_TTL = 10_000;
  private readonly RPC_RATE_LIMIT_MS = 200;

  constructor() {
    this.providers = {};
    for (const [chain, config] of Object.entries(CCTP_CONFIG)) {
      this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
    }
  }

  private async waitForRateLimit() {
    const elapsed = Date.now() - this.lastRpcCall;
    if (elapsed < this.RPC_RATE_LIMIT_MS) {
      await new Promise(r => setTimeout(r, this.RPC_RATE_LIMIT_MS - elapsed));
    }
    this.lastRpcCall = Date.now();
  }

  async estimateFee(fromChain: string, toChain: string, amount: number): Promise<number> {
    const fromConfig = CCTP_CONFIG[fromChain as keyof typeof CCTP_CONFIG];
    const toConfig = CCTP_CONFIG[toChain as keyof typeof CCTP_CONFIG];

    if (!fromConfig || !toConfig) {
      throw new Error(`Unsupported chain: ${fromChain} or ${toChain}`);
    }

    const provider = this.providers[fromChain];
    try {
      const feeData = await provider.getFeeData();
      const estimatedGas = 250000;
      const gasCost = Number(feeData.gasPrice || 0) * estimatedGas;
      const amountInWei = Number(ethers.parseUnits(amount.toString(), 6));

      return (gasCost + amountInWei) / 1e6;
    } catch (err) {
      console.error('Error estimating CCTP fee:', err);
      return amount * 0.001;
    }
  }

  async initiateTransfer(params: {
    fromChain: string;
    toChain: string;
    amount: number;
    recipient: string;
    signer: ethers.Signer;
    onStep?: (step: CCTPStep) => void;
  }): Promise<CCTPTransfer> {
    const MAX_RETRIES = 3
    const RETRY_DELAYS = [15000, 30000, 60000]
    let lastError: string = ''

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]))
      }
      try {
        return await this._initiateTransferOnce(params)
      } catch (err: any) {
        lastError = err.message
        params.onStep?.({
          name: 'burn',
          state: 'error',
          error: `tentativa ${attempt + 1}/${MAX_RETRIES + 1}: ${err.message.slice(0, 100)}`,
        })
      }
    }
    throw new Error(`CCTP transfer failed after ${MAX_RETRIES + 1} tentativas: ${lastError}`)
  }

  private async _initiateTransferOnce(params: {
    fromChain: string;
    toChain: string;
    amount: number;
    recipient: string;
    signer: ethers.Signer;
    onStep?: (step: CCTPStep) => void;
  }): Promise<CCTPTransfer> {
    const fromConfig = CCTP_CONFIG[params.fromChain as keyof typeof CCTP_CONFIG];
    const toConfig = CCTP_CONFIG[params.toChain as keyof typeof CCTP_CONFIG];

    if (!fromConfig || !toConfig) {
      throw new Error(`Unsupported chain: ${params.fromChain} or ${params.toChain}`);
    }

    const amountWei = ethers.parseUnits(params.amount.toString(), 6);
    const dstDomainId = toConfig.domainId;
    const mintRecipient = ethers.zeroPadValue(params.recipient, 32);

    const steps: CCTPStep[] = [
      { name: 'approve', state: 'pending' },
      { name: 'burn', state: 'pending' },
      { name: 'fetch_attestation', state: 'pending' },
      { name: 'mint', state: 'pending' },
    ];

    const notifyStep = (step: CCTPStep) => {
      params.onStep?.(step);
    };

    try {
      const usdc = new ethers.Contract(fromConfig.usdc, USDC_ABI, params.signer);
      const tokenMessenger = new ethers.Contract(fromConfig.tokenMessenger, TOKEN_MESSENGER_ABI, params.signer);

      notifyStep({ ...steps[0], state: 'pending' });
      const allowance = await usdc.allowance(await params.signer.getAddress(), fromConfig.tokenMessenger);
      if (allowance < amountWei) {
        const approveTx = await usdc.approve(fromConfig.tokenMessenger, ethers.MaxUint256);
        await approveTx.wait();
        notifyStep({ ...steps[0], state: 'success', txHash: approveTx.hash });
      } else {
        notifyStep({ ...steps[0], state: 'success' });
      }

      notifyStep({ ...steps[1], state: 'pending' });
      const burnTx = await tokenMessenger.depositForBurn(
        amountWei,
        dstDomainId,
        mintRecipient,
        fromConfig.usdc,
        0n,   // maxFee (0 = sem Forwarding Service)
        0,    // minFinalityThreshold (0 = dev chain default)
        { gasLimit: 300000 }
      );
      const burnReceipt = await burnTx.wait();
      notifyStep({ ...steps[1], state: 'success', txHash: burnTx.hash });

      const burnEvent = burnReceipt.logs
        .map((log: any) => {
          try {
            return tokenMessenger.interface.parseLog(log);
          } catch { return null; }
        })
        .find((log: any) => log?.name === 'DepositForBurn');

      if (!burnEvent) {
        throw new Error('DepositForBurn event not found');
      }

      // V2: extraData contém a mensagem codificada; usamos o txHash como messageHash
      const messageHash = burnReceipt.transactionHash;
      const messageBytes = burnEvent.args.extraData || ethers.concat([
        ethers.toBeHex(burnEvent.args.amount, 32),
        ethers.toBeHex(burnEvent.args.dstDomain || burnEvent.args.destinationDomain, 4),
        burnEvent.args.mintRecipient,
        ethers.zeroPadValue(burnEvent.args.burnToken || fromConfig.usdc, 32),
        ethers.toBeHex(0, 32),
      ]);

      notifyStep({ ...steps[2], state: 'pending' });
      const attestation = await this.fetchAttestation(messageHash);
      notifyStep({ ...steps[2], state: 'success' });

      const toProvider = this.providers[params.toChain];
      const messageTransmitter = new ethers.Contract(toConfig.messageTransmitter, MESSAGE_TRANSMITTER_ABI, toProvider);
      const toSigner = params.signer.connect(toProvider);

      notifyStep({ ...steps[3], state: 'pending' });
      const mintTx = await (messageTransmitter.connect(toSigner) as any).receiveMessage(
        messageBytes,
        attestation,
        { gasLimit: 300000 }
      );
      await mintTx.wait();
      notifyStep({ ...steps[3], state: 'success', txHash: mintTx.hash });

      return {
        txHash: burnTx.hash,
        amount: params.amount,
        fromChain: params.fromChain,
        toChain: params.toChain,
        recipient: params.recipient,
        status: 'completed',
        timestamp: Date.now(),
        messageHash,
        attestation,
      };
    } catch (err: any) {
      throw new Error(`CCTP transfer failed: ${err.message}`);
    }
  }

  private async fetchAttestation(messageHash: string, maxRetries = 30, intervalMs = 2000): Promise<string> {
    const cleanHash = messageHash.startsWith('0x') ? messageHash.slice(2) : messageHash;
    const urls = [
      `${ATTESTATION_SERVICE_URL}/${cleanHash}/attestation`,
      `${ATTESTATION_SERVICE_SANDBOX_URL}/${cleanHash}/attestation`,
      `${ATTESTATION_SERVICE_URL}/${cleanHash}`,
      `${ATTESTATION_SERVICE_SANDBOX_URL}/${cleanHash}`,
    ];
    
    for (let i = 0; i < maxRetries; i++) {
      for (const url of urls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            if (data.attestation) {
              return data.attestation;
            }
          }
        } catch (err) {
          console.debug(`Attestation fetch failed for ${url}:`, err);
        }
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('Attestation not available after maximum retries');
  }

  async trackTransfer(txHash: string, fromChain: string): Promise<CCTPTransfer | null> {
    const fromConfig = CCTP_CONFIG[fromChain as keyof typeof CCTP_CONFIG];
    if (!fromConfig) {
      throw new Error(`Unsupported chain: ${fromChain}`);
    }

    const provider = this.providers[fromChain];

    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return null;

      const tokenMessenger = new ethers.Contract(fromConfig.tokenMessenger, TOKEN_MESSENGER_ABI, provider);
      const event = receipt.logs
        .map((log: any) => {
          try { return tokenMessenger.interface.parseLog(log); }
          catch { return null; }
        })
        .find((log: any) => log?.name === 'DepositForBurn');

      if (!event) return null;

      return {
        txHash,
        amount: Number(ethers.formatUnits(event.args.amount, 6)),
        fromChain,
        toChain: this.getChainByDomainId(event.args.destinationDomain),
        recipient: ethers.dataSlice(event.args.mintRecipient, 12),
        status: 'completed',
        timestamp: Date.now(),
        messageHash: txHash,
      };
    } catch (err) {
      console.error('Error tracking CCTP transfer:', err);
      return null;
    }
  }

  private getChainByDomainId(domainId: number): string {
    for (const [chain, config] of Object.entries(CCTP_CONFIG)) {
      if (config.domainId === domainId) {
        return chain;
      }
    }
    return 'unknown';
  }

  async getSupportedChains(): Promise<string[]> {
    return Object.keys(CCTP_CONFIG);
  }

  async validateRecipient(chain: string, recipient: string): Promise<boolean> {
    const config = CCTP_CONFIG[chain as keyof typeof CCTP_CONFIG];
    if (!config) {
      return false;
    }

    try {
      const provider = this.providers[chain];
      const code = await provider.getCode(recipient);
      return code !== '0x';
    } catch (err) {
      return false;
    }
  }

  async getUSDCBalance(chain: string, address: string): Promise<number> {
    const config = CCTP_CONFIG[chain as keyof typeof CCTP_CONFIG];
    if (!config) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    const cacheKey = `${chain}:${address.toLowerCase()}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.BALANCE_CACHE_TTL) {
      return cached.balance;
    }

    await this.waitForRateLimit();
    const provider = this.providers[chain];
    const usdc = new ethers.Contract(config.usdc, USDC_ABI, provider);
    const [balance, decimals] = await Promise.all([
      usdc.balanceOf(address).catch(() => 0n),
      usdc.decimals().catch(() => 6),
    ]);
    const parsed = parseFloat(ethers.formatUnits(balance, decimals));
    this.balanceCache.set(cacheKey, { balance: parsed, timestamp: Date.now() });
    return parsed;
  }
}

export const cctpService = new CCTPService();