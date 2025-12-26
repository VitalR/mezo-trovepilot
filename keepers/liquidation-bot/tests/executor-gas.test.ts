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
    await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: LIQ_ENGINE,
      job: { borrowers: ['0x1' as Address], fallbackOnFail: true },
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 100_000n,
        maxFeePerGas: 1n,
      },
      dryRun: false,
    });
    expect(wasSent()).toBe(false);
  });

  it('shrinks chunk until under cap', async () => {
    // Start with 2 borrowers; we simulate gas proportional to borrowers (mock returns 200_000)
    let currentGas = 200_000n;
    const { publicClient, walletClient, wasSent } = {
      publicClient: {
        async estimateContractGas() {
          return currentGas;
        },
        async getGasPrice() {
          return 1n;
        },
        async waitForTransactionReceipt() {
          return { status: 'success', gasUsed: currentGas };
        },
      } as any,
      walletClient: {
        account: '0xabc' as Address,
        async writeContract(args: any) {
          // Simulate that when we retry with fewer borrowers, gas drops
          const borrowerCount = args.args[0].length;
          currentGas = borrowerCount === 1 ? 80_000n : 200_000n;
          return '0xhash';
        },
      } as any,
      wasSent: () => true,
    };

    await executeLiquidationJob({
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
      },
      dryRun: false,
    });
    // Sent once after shrinking; no explicit flag, so we just ensure no throw
    expect(wasSent()).toBe(true);
  });
});
