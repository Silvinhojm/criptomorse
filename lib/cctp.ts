import { ethers } from 'ethers';

const CCTP_CONFIG = {
  arc: {
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0x5e7A2B3c8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
    usdc: '0x3600000000000000000000000000000000000000',
    chainId: 5042002,
    domainId: 5,
    rpcUrl: 'https://rpc.testnet.arc.network',
  },
  base: {
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0x5e7A2B3c8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    domainId: 6,
    rpcUrl: 'https://mainnet.base.org',
  },
  polygon: {
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0x5e7A2B3c8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 137,
    domainId: 7,
    rpcUrl: 'https://polygon.publicnode.com',
  },
  ethereum: {
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0x5e7A2B3c8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
    usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chainId: 1,
    domainId: 0,
    rpcUrl: 'https://eth.llamarpc.com',
  },
};

const CCTP_DOMAIN_IDS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  polygon: 7,
  base: 6,
  arbitrum: 3,
  optimism: 2,
  arc: 5,
  solana: 5,
};

const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external',
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes hookData) external',
  'event DepositForBurn(address indexed to, uint256 amount, uint32 dstChainId, bytes32 indexed mintRecipient, bytes32 indexed burnToken)',
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

const ATTESTATION_SERVICE_URL = 'https://iris-api.circle.com/v1/attestations';

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

  constructor() {
    this.providers = {};
    for (const [chain, config] of Object.entries(CCTP_CONFIG)) {
      this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
    }
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

      const messageHash = burnReceipt.transactionHash;
      const messageBytes = ethers.concat([
        ethers.toBeHex(burnEvent.args.amount, 32),
        ethers.toBeHex(burnEvent.args.dstChainId, 4),
        burnEvent.args.mintRecipient,
        burnEvent.args.burnToken,
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
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${ATTESTATION_SERVICE_URL}/${cleanHash}`);
        if (response.ok) {
          const data = await response.json();
          if (data.attestation) {
            return data.attestation;
          }
        }
      } catch (err) {
        console.debug('Attestation fetch attempt failed:', err);
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('Attestation not available after maximum retries');
  }

  async trackTransfer(messageHash: string, fromChain: string): Promise<CCTPTransfer | null> {
    const fromConfig = CCTP_CONFIG[fromChain as keyof typeof CCTP_CONFIG];
    if (!fromConfig) {
      throw new Error(`Unsupported chain: ${fromChain}`);
    }

    const provider = this.providers[fromChain];
    const tokenMessenger = new ethers.Contract(fromConfig.tokenMessenger, TOKEN_MESSENGER_ABI, provider);

    try {
      const logs = await provider.getLogs({
        address: fromConfig.tokenMessenger,
        topics: [ethers.id('DepositForBurn(address,uint256,uint32,bytes32,bytes32)')],
        fromBlock: 0,
        toBlock: 'latest',
      });

      for (const log of logs) {
        const parsedLog = tokenMessenger.interface.parseLog(log);
        if (parsedLog && parsedLog.args[4] === messageHash) {
          return {
            txHash: messageHash,
            amount: Number(ethers.formatUnits(parsedLog.args[1], 6)),
            fromChain: fromChain,
            toChain: this.getChainByDomainId(parsedLog.args[2]),
            recipient: parsedLog.args[3],
            status: 'completed',
            timestamp: Date.now(),
            messageHash,
          };
        }
      }

      return null;
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

    const provider = this.providers[chain];
    const usdc = new ethers.Contract(config.usdc, USDC_ABI, provider);
    const [balance, decimals] = await Promise.all([
      usdc.balanceOf(address),
      usdc.decimals().catch(() => 6),
    ]);
    return parseFloat(ethers.formatUnits(balance, decimals));
  }
}

export const cctpService = new CCTPService();