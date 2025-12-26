import { describe, expect, it, vi } from 'vitest';
import { Address } from 'viem';
import { executeLiquidationJob } from '../src/core/executor.js';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const addr = (n: number) => (`0x${n.toString(16)}`.padEnd(42, '0')) as Address;

function makeClients() {
  const estimateContractGas = vi.fn();
  const writeContract = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const getGasPrice = vi.fn();

  const publicClient = {
    estimateContractGas,
    waitForTransactionReceipt,
    getGasPrice,
  };

  const walletClient = {
    account: addr(999),
    writeContract,
  };

  return { publicClient, walletClient };
}

describe('executor gas handling and splitting', () => {
  it('applies gas buffer, shrinks under cap, and tracks actual cost', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateContractGas
      .mockResolvedValueOnce(100n) // initial with 3 borrowers
      .mockResolvedValueOnce(60n); // after shrink to 2
    publicClient.getGasPrice.mockResolvedValue(3n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 2n,
    });

    const spendTracker = { spent: 0n };
    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1), addr(2), addr(3)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 90n,
        maxNativeSpentPerRun: 1_000n,
        gasBufferPct: 20,
      },
      spendTracker,
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    const callArgs = walletClient.writeContract.mock.calls[0][0];
    expect(callArgs.args[0]).toEqual([addr(1), addr(2)]);
    expect(callArgs.gas).toBe(72n); // 60 * 1.2 buffer
    expect(res.processedBorrowers).toEqual([addr(1), addr(2)]);
    expect(res.leftoverBorrowers).toEqual([addr(3)]);
    expect(spendTracker.spent).toBe(20n); // effectiveGasPrice * gasUsed
  });

  it('re-estimates gas on first retry and uses new buffered value', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateContractGas
      .mockResolvedValueOnce(50n) // initial
      .mockResolvedValueOnce(70n); // retry re-estimate
    publicClient.getGasPrice.mockResolvedValue(10n);
    walletClient.writeContract
      .mockRejectedValueOnce(new Error('network issue'))
      .mockResolvedValueOnce('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 70n,
      effectiveGasPrice: 10n,
    });

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: false },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 1_000_000n,
        gasBufferPct: 10,
      },
      spendTracker: { spent: 0n },
    });

    expect(publicClient.estimateContractGas).toHaveBeenCalledTimes(2);
    const secondWrite = walletClient.writeContract.mock.calls[1][0];
    expect(secondWrite.gas).toBe(77n); // 70 * 1.1
    expect(res.leftoverBorrowers).toEqual([]);
    expect(res.processedBorrowers).toEqual([addr(1)]);
  });

  it('skips when projected spend exceeds cap without dropping borrowers silently', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.getGasPrice.mockResolvedValue(5n);

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1), addr(2)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 20n, // estimated cost 10 * 1.2 * 5 = 60 > cap
        gasBufferPct: 20,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1), addr(2)]);
  });
});

