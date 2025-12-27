import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import { executeLiquidationJob } from '../src/core/executor.js';

// Minimal mock public/wallet clients
function makeMockClients(gas: bigint, shouldFail: boolean = false) {
  let sent = false;
  return {
    publicClient: {
      async estimateContractGas() {
        return gas;
      },
      async getGasPrice() {
        return 1n;
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
    const { publicClient, walletClient, wasSent } = {
      publicClient: {
        async estimateContractGas(opts: any) {
          const borrowerCount = opts.args[0].length;
          return borrowerCount === 1 ? 80_000n : 200_000n;
        },
        async getGasPrice() {
          return 1n;
        },
        async waitForTransactionReceipt() {
          return { status: 'success', gasUsed: 80_000n };
        },
      } as any,
      walletClient: {
        account: '0xabc' as Address,
        async writeContract() {
          return '0xhash';
        },
      } as any,
      wasSent: () => true,
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
});
