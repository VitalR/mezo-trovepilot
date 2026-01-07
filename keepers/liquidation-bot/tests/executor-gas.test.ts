import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import { executeLiquidationJob } from '../src/core/executor.js';

// Minimal mock public/wallet clients
function makeMockClients(gas: bigint, shouldFail: boolean = false) {
  let sent = false;
  return {
    publicClient: {
      async estimateFeesPerGas() {
        throw new Error('no eip1559');
      },
      async estimateContractGas() {
        return gas;
      },
      async getGasPrice() {
        return 1n;
      },
      async getBalance() {
        return 1_000_000_000_000_000_000n; // plenty
      },
      async waitForTransactionReceipt() {
        return { status: 'success', gasUsed: gas };
      },
    } as any,
    walletClient: {
      account: '0xabc' as Address,
      async writeContract() {
        if (shouldFail) throw new Error('execution reverted');
        sent = true;
        return '0xhash';
      },
    } as any,
    wasSent: () => sent,
  };
}

const LIQ_ENGINE = '0xbeef' as Address;

describe('executor gas cap', () => {
  it('skips when single liquidation exceeds cap', async () => {
    const { publicClient, walletClient, wasSent } = makeMockClients(1_000_000n);
    const res = await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: LIQ_ENGINE,
      job: { borrowers: ['0x1' as Address], fallbackOnFail: true },
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 100_000n,
        maxFeePerGas: 1n,
        gasBufferPct: 20,
      },
      dryRun: false,
    });
    expect(wasSent()).toBe(false);
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual(['0x1']);
  });

  it('shrinks chunk until under cap', async () => {
    let sent = false;
    const { publicClient, walletClient, wasSent } = {
      publicClient: {
        async estimateFeesPerGas() {
          throw new Error('no eip1559');
        },
        async estimateContractGas(opts: any) {
          if (opts.functionName === 'liquidateSingle') return 80_000n;
          const borrowerCount = opts.args[0].length;
          return borrowerCount === 1 ? 80_000n : 200_000n;
        },
        async getGasPrice() {
          return 1n;
        },
        async getBalance() {
          return 1_000_000_000_000_000_000n; // plenty
        },
        async waitForTransactionReceipt() {
          return { status: 'success', gasUsed: 80_000n };
        },
      } as any,
      walletClient: {
        account: '0xabc' as Address,
        async writeContract(args: any) {
          sent = true;
          expect(args.functionName).toBe('liquidateSingle');
          expect(args.args[0]).toBe('0x1');
          expect(args.args[1]).toBe('0xabc');
          return '0xhash';
        },
      } as any,
      wasSent: () => sent,
    };

    const res = await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: LIQ_ENGINE,
      job: {
        borrowers: ['0x1' as Address, '0x2' as Address],
        fallbackOnFail: true,
      },
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 150_000n,
        maxFeePerGas: 1n,
        gasBufferPct: 20,
      },
      dryRun: false,
    });
    expect(wasSent()).toBe(true);
    expect(res.processedBorrowers.length).toBeGreaterThanOrEqual(1);
    expect(res.leftoverBorrowers.length + res.processedBorrowers.length).toBe(
      2
    );
  });

  it('shrinks multiple times and preserves suffix leftovers', async () => {
    let sent = false;
    const publicClient = {
      async estimateFeesPerGas() {
        throw new Error('no eip1559');
      },
      async estimateContractGas(opts: any) {
        if (opts.functionName === 'liquidateSingle') return 60_000n;
        const count = opts.args[0].length;
        if (count >= 8) return 400_000n;
        if (count >= 4) return 220_000n;
        if (count >= 2) return 140_000n;
        return 60_000n;
      },
      async getGasPrice() {
        return 1n;
      },
      async getBalance() {
        return 1_000_000_000_000_000_000n; // plenty
      },
      async waitForTransactionReceipt() {
        return { status: 'success', gasUsed: 60_000n };
      },
    } as any;
    const walletClient = {
      account: '0xabc' as Address,
      async writeContract(args: any) {
        sent = true;
        return '0xhash';
      },
    } as any;

    const res = await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: LIQ_ENGINE,
      job: {
        borrowers: [
          '0x1' as Address,
          '0x2' as Address,
          '0x3' as Address,
          '0x4' as Address,
          '0x5' as Address,
          '0x6' as Address,
          '0x7' as Address,
          '0x8' as Address,
        ],
        fallbackOnFail: true,
      },
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 150_000n,
        maxFeePerGas: 1n,
        gasBufferPct: 20,
      },
      dryRun: false,
    });

    expect(sent).toBe(true);
    expect(res.processedBorrowers).toEqual(['0x1']);
    expect(res.leftoverBorrowers).toEqual([
      '0x2',
      '0x3',
      '0x4',
      '0x5',
      '0x6',
      '0x7',
      '0x8',
    ]);
  });
});
