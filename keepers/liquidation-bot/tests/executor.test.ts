import { describe, expect, it, vi } from 'vitest';
import { Address } from 'viem';
import { classifyError, executeLiquidationJob } from '../src/core/executor.js';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const addr = (n: number) => `0x${n.toString(16)}`.padEnd(42, '0') as Address;

function makeClients() {
  const estimateContractGas = vi.fn();
  const writeContract = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const getGasPrice = vi.fn();
  const estimateFeesPerGas = vi.fn();
  const getBalance = vi.fn();

  const publicClient = {
    estimateContractGas,
    waitForTransactionReceipt,
    getGasPrice,
    estimateFeesPerGas,
    getBalance,
  };

  const walletClient = {
    account: addr(999),
    writeContract,
  };

  return { publicClient, walletClient };
}

describe('executor gas handling and splitting', () => {
  it('skips with INSUFFICIENT_BALANCE when balance is below projected cost', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(10n);
    publicClient.estimateContractGas.mockResolvedValue(100n);
    publicClient.getBalance.mockResolvedValue(500n); // too low

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxNativeSpentPerRun: undefined,
        maxGasPerJob: undefined,
        gasBufferPct: 0,
      },
    });

    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1)]);
    expect(walletClient.writeContract).not.toHaveBeenCalled();

    const lines = consoleLogSpy.mock.calls
      .map((c) => String(c[0] ?? ''))
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l));
    const skip = lines.find((e) => e.event === 'job_skip');
    expect(skip?.reason).toBe('INSUFFICIENT_BALANCE');

    consoleLogSpy.mockRestore();
  });

  it('applies gas buffer, shrinks under cap, and tracks actual cost', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
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
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas
      .mockResolvedValueOnce(50n) // initial
      .mockResolvedValueOnce(70n); // retry re-estimate
    publicClient.getGasPrice
      .mockResolvedValueOnce(10n)
      .mockResolvedValueOnce(30n); // refreshed fee on attempt 1
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
    expect([...res.processedBorrowers, ...res.leftoverBorrowers]).toEqual([
      addr(1),
    ]);

    const planLog = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l: string) => l.startsWith('{'))
      .map((l: string) => JSON.parse(l))
      .find(
        (p: any) =>
          p.event === 'job_plan' &&
          p.fee?.mode === 'legacy' &&
          p.fee?.gasPrice === '30'
      );
    expect(planLog).toBeTruthy();
    consoleLogSpy.mockRestore();
  });

  it('keeps suffix ordering when retry re-plan shrinks further', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(5n);
    publicClient.estimateContractGas
      .mockResolvedValueOnce(150n) // initial -> shrinks to 2 with buffer 165 vs cap 160
      .mockResolvedValueOnce(90n) // after shrink to 2 (buffer 99 < cap)
      .mockResolvedValueOnce(180n) // retry replan raw for 2 (buffer 198 > cap)
      .mockResolvedValueOnce(90n); // replan shrink to 1 (buffer 99)
    walletClient.writeContract
      .mockRejectedValueOnce(new Error('network issue'))
      .mockResolvedValueOnce('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 90n,
      effectiveGasPrice: 5n,
    });

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: {
        borrowers: [addr(1), addr(2), addr(3), addr(4)],
        fallbackOnFail: true,
      },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 160n,
        maxNativeSpentPerRun: 10_000n,
        gasBufferPct: 10,
      },
      spendTracker: { spent: 0n },
    });

    expect([...res.processedBorrowers, ...res.leftoverBorrowers]).toEqual([
      addr(1),
      addr(2),
      addr(3),
      addr(4),
    ]);
  });

  it('uses estimateFeesPerGas when auto fee caps are enabled', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 7n,
      maxPriorityFeePerGas: 2n,
    } as any);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 7n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 10_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(publicClient.estimateFeesPerGas).toHaveBeenCalledTimes(1);
    expect(publicClient.getGasPrice).not.toHaveBeenCalled();
    const callArgs = walletClient.writeContract.mock.calls[0][0];
    expect(callArgs.maxFeePerGas).toBe(7n);
    expect(callArgs.maxPriorityFeePerGas).toBe(2n);

    // ensure job_plan fee metadata emitted
    const planLog = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l))
      .find((p) => p.event === 'job_plan');
    expect(planLog.fee.mode).toBe('eip1559');
    expect(planLog.fee.source).toBe('estimateFeesPerGas');
    expect(planLog.fee.maxFeePerGas).toBe('7');
    expect(planLog.fee.maxPriorityFeePerGas).toBe('2');

    consoleLogSpy.mockRestore();
  });

  it('falls back to getGasPrice when estimateFeesPerGas is unavailable', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(9n);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 9n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 10_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(publicClient.getGasPrice).toHaveBeenCalledTimes(1);
    const callArgs = walletClient.writeContract.mock.calls[0][0];
    expect(callArgs.gasPrice).toBe(9n);
    expect(callArgs.maxFeePerGas).toBeUndefined();
  });

  it('skips when spend cap enabled and fee cannot be estimated', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('fail'));
    publicClient.getGasPrice.mockRejectedValue(new Error('fail'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1), addr(2)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 1_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1), addr(2)]);

    const skipLog = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l))
      .find((p) => p.event === 'job_skip');
    expect(skipLog.reason).toBe('FEE_UNAVAILABLE');
    expect(skipLog.fee.source).toBe('unknown');
    consoleLogSpy.mockRestore();
  });

  it('rechecks gas cap after retry re-estimation and skips without sending second tx when over cap', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas
      .mockResolvedValueOnce(50n) // initial ok
      .mockResolvedValueOnce(200n); // retry spikes -> over cap after buffer (220)
    publicClient.getGasPrice.mockResolvedValue(1n);
    walletClient.writeContract.mockRejectedValueOnce(
      new Error('network issue')
    );

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 100n,
        maxNativeSpentPerRun: 10_000n,
        gasBufferPct: 10,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1); // first attempt only
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1)]);
  });

  it('rechecks spend cap after retry re-estimation and keeps all borrowers as leftovers', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas
      .mockResolvedValueOnce(20n) // initial ok (buffer 22)
      .mockResolvedValueOnce(40n); // retry (buffer 44) -> spend exceeds cap 30
    publicClient.getGasPrice.mockResolvedValue(1n);
    walletClient.writeContract.mockRejectedValueOnce(
      new Error('network issue')
    );

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1), addr(2)], fallbackOnFail: false },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 30n,
        gasBufferPct: 10,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1); // first attempt only
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1), addr(2)]);
  });

  it('does not retry logic reverts', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.getGasPrice.mockResolvedValue(1n);
    walletClient.writeContract.mockRejectedValueOnce(
      new Error('execution reverted')
    );

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 2,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 1_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(res.processedBorrowers).toEqual([]);
    expect(res.leftoverBorrowers).toEqual([addr(1)]);
  });

  it('retries rate-limit style error once with backoff', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.getGasPrice.mockResolvedValue(1n);
    walletClient.writeContract
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 1n,
    });

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 1_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
    expect([...res.processedBorrowers, ...res.leftoverBorrowers]).toEqual([
      addr(1),
    ]);
  });

  it('emits retry_scheduled before second send with reason/message and correct backoff', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.getGasPrice.mockResolvedValue(1n);
    walletClient.writeContract
      .mockRejectedValueOnce(new Error('network issue'))
      .mockResolvedValueOnce('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 1n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 1,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: 1_000n,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));

    const txErrorIdx = logs.findIndex((p: any) => p.event === 'tx_error');
    const retryIdx = logs.findIndex((p: any) => p.event === 'retry_scheduled');
    const txSentIdxs = logs
      .map((p: any, i: number) => ({ p, i }))
      .filter(({ p }) => p.event === 'tx_sent')
      .map(({ i }) => i);

    expect(txSentIdxs.length).toBe(1);
    const txSentIdx = txSentIdxs[0];

    expect(txErrorIdx).toBeLessThan(retryIdx);
    expect(retryIdx).toBeLessThan(txSentIdx);

    const retry = logs[retryIdx];
    expect(retry.attempt).toBe(1);
    expect(retry.nextBackoffMs).toBe(500);
    expect(retry.backoffMs).toBe(500); // compatibility field, kept equal
    expect(retry.reason).toBe('transient');
    expect(retry.message).toContain('network issue');

    const txError = logs[txErrorIdx];
    expect(txError.nextBackoffMs).toBe(500);

    consoleLogSpy.mockRestore();
  });

  it('falls back to zero priority fee when config maxFeePerGas set and priority unavailable', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no priority'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 5n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
        maxFeePerGas: 5n,
        maxPriorityFeePerGas: undefined,
      },
      spendTracker: { spent: 0n },
    });

    const txArgs = walletClient.writeContract.mock.calls[0][0];
    expect(txArgs.maxFeePerGas).toBe(5n);
    expect(txArgs.maxPriorityFeePerGas).toBe(0n);

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const plan = logs.find((p: any) => p.event === 'job_plan');
    expect(plan.fee.mode).toBe('eip1559');
    expect(plan.fee.maxPriorityFeePerGas).toBe('0');
    expect(plan.fee.priorityKnown).toBe(false);
    const txSent = logs.find((p: any) => p.event === 'tx_sent');
    expect(txSent.fee.maxPriorityFeePerGas).toBe('0');
    expect(txSent.fee.priorityKnown).toBe(false);

    consoleLogSpy.mockRestore();
  });

  it('submits zero priority when estimateFeesPerGas returns undefined priority with config override', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: undefined,
    } as any);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 5n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
        maxFeePerGas: 5n,
        maxPriorityFeePerGas: undefined,
      },
      spendTracker: { spent: 0n },
    });

    const txArgs = walletClient.writeContract.mock.calls[0][0];
    expect(txArgs.maxFeePerGas).toBe(5n);
    expect(txArgs.maxPriorityFeePerGas).toBe(0n);

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const plan = logs.find((p: any) => p.event === 'job_plan');
    expect(plan.fee.maxPriorityFeePerGas).toBe('0');
    expect(plan.fee.priorityKnown).toBe(false);
    expect(plan.fee.prioritySource).toBe('estimateFeesPerGas');
    consoleLogSpy.mockRestore();
  });

  it('falls back to zero priority when estimateFeesPerGas returns undefined priority in auto mode', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 6n,
      maxPriorityFeePerGas: undefined,
    } as any);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 6n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    const txArgs = walletClient.writeContract.mock.calls[0][0];
    expect(txArgs.maxPriorityFeePerGas).toBe(0n);

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const plan = logs.find((p: any) => p.event === 'job_plan');
    expect(plan.fee.maxPriorityFeePerGas).toBe('0');
    expect(plan.fee.priorityKnown).toBe(false);
    expect(plan.fee.prioritySource).toBe('estimateFeesPerGas');

    consoleLogSpy.mockRestore();
  });

  it('skips when projected spend exceeds cap without dropping borrowers silently', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
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

  it('does not skip when spend cap is disabled (undefined)', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.estimateContractGas.mockResolvedValue(1_000_000n);
    publicClient.getGasPrice.mockResolvedValue(100n);
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 1_000_000n,
      effectiveGasPrice: 100n,
    });
    walletClient.writeContract.mockResolvedValue('0xtxhash');

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect([...res.processedBorrowers, ...res.leftoverBorrowers]).toEqual([
      addr(1),
    ]);
  });

  it('does not skip when spend cap disabled even if fee cannot be estimated', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('fail'));
    publicClient.getGasPrice.mockRejectedValue(new Error('fail'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 1n,
    });

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(res.processedBorrowers).toEqual([addr(1)]);
  });

  it('labels fee mode correctly for config override and gasPrice fallback', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 5n,
    });

    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
        maxFeePerGas: 5n,
        maxPriorityFeePerGas: undefined,
      },
      spendTracker: { spent: 0n },
    });

    // capture logs after config path
    const firstLogs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const planConfig = firstLogs.find((p: any) => p.event === 'job_plan');
    expect(planConfig).toBeTruthy();
    expect(planConfig.fee.mode).toBe('eip1559');
    expect(planConfig.fee.maxFeePerGas).toBe('5');
    expect(planConfig.fee.maxPriorityFeePerGas).toBe('0');

    consoleLogSpy.mockClear();
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(3n);
    await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(2)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const planGasPrice = logs.find((p: any) => p.event === 'job_plan');
    expect(planGasPrice).toBeTruthy();
    expect(planGasPrice.fee.mode).toBe('legacy');
    expect(planGasPrice.fee.gasPrice).toBe('3');
    expect(planGasPrice.fee.maxFeePerGas).toBeUndefined();

    const txArgs = walletClient.writeContract.mock.calls[1][0];
    expect(txArgs.gasPrice).toBe(3n);
    expect(txArgs.maxFeePerGas).toBeUndefined();
    consoleLogSpy.mockRestore();
  });

  it('submits best-effort when fee unknown and spend cap disabled', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    publicClient.estimateFeesPerGas.mockRejectedValue(
      new Error('eip1559 fail')
    );
    publicClient.getGasPrice.mockRejectedValue(new Error('gasPrice fail'));
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 1n,
    });

    const res = await executeLiquidationJob({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      liquidationEngine: ZERO,
      job: { borrowers: [addr(1)], fallbackOnFail: true },
      dryRun: false,
      config: {
        maxTxRetries: 0,
        maxGasPerJob: 0n,
        maxNativeSpentPerRun: undefined,
        gasBufferPct: 0,
      },
      spendTracker: { spent: 0n },
    });

    expect(res.processedBorrowers).toEqual([addr(1)]);
    const callArgs = walletClient.writeContract.mock.calls[0][0];
    expect(callArgs.gasPrice).toBeUndefined();
    expect(callArgs.maxFeePerGas).toBeUndefined();
    expect(callArgs.maxPriorityFeePerGas).toBeUndefined();

    const logs = consoleLogSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    const plan = logs.find((p: any) => p.event === 'job_plan');
    expect(plan.fee.mode).toBe('unknown');
    expect(plan.fee.known).toBe(false);
    const txSent = logs.find((p: any) => p.event === 'tx_sent');
    expect(txSent.fee.mode).toBe('unknown');
    expect(txSent.fee.known).toBe(false);
    consoleLogSpy.mockRestore();
  });

  it('classifies nonce and underpriced errors', () => {
    expect(classifyError(new Error('nonce too low')).type).toBe('nonce');
    expect(
      classifyError(new Error('replacement transaction underpriced')).type
    ).toBe('underpriced');
  });
});
