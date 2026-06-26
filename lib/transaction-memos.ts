// lib/transaction-memos.ts
// Suporte a Transaction Memos - v0.7.2 hardfork (18 Jun 2026)
// Anexa referencias de pagamento onchain para rastrear transfers entre agentes

import { keccak256, toUtf8Bytes, hexlify } from "ethers"

interface TransactionMemo {
  version: number;
  type: MemoType;
  reference: string;
  agentId?: string;
  jobId?: string;
  timestamp: number;
  metadata?: Record<string, string>;
}

type MemoType = 'payment' | 'trade' | 'job_completion' | 'agent_fee' | 'settlement' | 'custom';

interface EncodedMemo {
  hex: string;
  raw: string;
  bytes: number;
}

class TransactionMemos {
  private readonly MEMO_PREFIX = '0x415243';
  private readonly CURRENT_VERSION = 1;

  encode(memo: TransactionMemo): EncodedMemo {
    const payload = JSON.stringify({
      v: memo.version,
      t: memo.type,
      r: memo.reference,
      ...(memo.agentId && { a: memo.agentId }),
      ...(memo.jobId && { j: memo.jobId }),
      ts: memo.timestamp,
      ...(memo.metadata && { m: memo.metadata }),
    });

    const hex = this.toHex(payload);
    return {
      hex: this.MEMO_PREFIX + hex,
      raw: payload,
      bytes: payload.length * 2,
    };
  }

  decode(hexData: string): TransactionMemo | null {
    try {
      const clean = hexData.startsWith('0x') ? hexData.slice(2) : hexData;
      const payload = this.fromHex(clean);
      const data = JSON.parse(payload);
      return {
        version: data.v,
        type: data.t,
        reference: data.r,
        agentId: data.a,
        jobId: data.j,
        timestamp: data.ts,
        metadata: data.m,
      };
    } catch {
      return null;
    }
  }

  createPaymentMemo(reference: string, agentId?: string): EncodedMemo {
    return this.encode({
      version: this.CURRENT_VERSION,
      type: 'payment',
      reference,
      agentId,
      timestamp: Date.now(),
    });
  }

  createTradeMemo(reference: string, agentId: string, metadata?: Record<string, string>): EncodedMemo {
    return this.encode({
      version: this.CURRENT_VERSION,
      type: 'trade',
      reference,
      agentId,
      timestamp: Date.now(),
      metadata,
    });
  }

  /** Gera bytes32 memoId via keccak256(reference) — compatível com Memo contract on-chain */
  generateMemoId(reference: string): string {
    return keccak256(toUtf8Bytes(reference))
  }

  /** Codifica metadados como bytes hex para memoData no Memo contract */
  encodeMemoData(data: Record<string, string>): string {
    return hexlify(toUtf8Bytes(JSON.stringify(data)))
  }

  createJobMemo(jobId: string, reference: string, metadata?: Record<string, string>): EncodedMemo {
    return this.encode({
      version: this.CURRENT_VERSION,
      type: 'job_completion',
      reference,
      jobId,
      timestamp: Date.now(),
      metadata,
    });
  }

  private toHex(str: string): string {
    return Array.from(new TextEncoder().encode(str))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private fromHex(hex: string): string {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []
    );
    return new TextDecoder().decode(bytes);
  }

  isValidMemo(hexData: string): boolean {
    return hexData.startsWith(this.MEMO_PREFIX);
  }
}

export const transactionMemos = new TransactionMemos();
export type { TransactionMemo, MemoType, EncodedMemo };
