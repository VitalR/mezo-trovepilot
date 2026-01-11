import { describe, expect, it, vi } from 'vitest';
import {
  Address,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from 'viem';
import { executeRedeemOnce } from '../src/core/executor.js';
import { trovePilotEngineAbi } from '../src/abis/trovePilotEngineAbi.js';

const addr = (n: number) => `0x${n.toString(16)}`.padEnd(42, '0') as Address;

function makeClients(params?: { caller?: Address }) {
  const caller = params?.caller ?? addr(999);
  const readContract = vi.fn();
  const estimateContractGas = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const getGasPrice = vi.fn();
  const estimateFeesPerGas = vi.fn();
  const getBalance = vi.fn();

  const publicClient = {
    readContract,
    estimateContractGas,
    waitForTransactionReceipt,
    getGasPrice,
    estimateFeesPerGas,
    getBalance,
  };

  const walletClient = {
    account: caller,
    writeContract: vi.fn(),
  };

  return { publicClient, walletClient, caller };
}

const baseHints = {
  requestedMusd: 100n,
  truncatedMusd: 100n,
  firstHint: addr(10),
  partialNICR: 1n,
  upperHint: addr(11),
  lowerHint: addr(12),
  upperSeed: addr(13),
  lowerSeed: addr(14),
  derived: false,
  scannedTail: [],
  insertHintsComputed: true,
  priceE18: 1n,
  maxIterations: 50,
} as const;

describe('executor (redemption)', () => {
  it('caller != recipient: allowance checked for caller; txs sent from caller; recipient deltas tracked for recipient', async () => {
    const { publicClient, walletClient, caller } = makeClients({
      caller: addr(999),
    });
    const recipient = addr(888);

    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(2n);
    publicClient.estimateContractGas.mockResolvedValue(50n);
    let phase = 0;
    publicClient.getBalance.mockImplementation(({ address }: any) => {
      const a = (address as string).toLowerCase();
      if (a === caller.toLowerCase()) return 10_000n;
      if (a === recipient.toLowerCase()) return phase === 0 ? 1000n : 1100n;
      return 0n;
    });

    // Single implementation; phase flips after receipt.
    publicClient.readContract.mockImplementation(
      ({ functionName, args }: any) => {
        if (functionName === 'allowance') {
          expect((args[0] as string).toLowerCase()).toBe(caller.toLowerCase());
          return 1_000n;
        }
        if (functionName === 'balanceOf') {
          const who = (args[0] as string).toLowerCase();
          if (who === caller.toLowerCase()) return phase === 0 ? 1_000n : 900n;
          if (who === recipient.toLowerCase()) return phase === 0 ? 0n : 10n;
        }
        throw new Error(`unexpected readContract ${functionName}`);
      }
    );

    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockImplementation(
      async (_x: any) => {
        phase = 1;
        return {
          status: 'success',
          gasUsed: 10n,
          effectiveGasPrice: 2n,
          logs: [],
        };
      }
    );

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient,
        strictTruncation: false,
      },
      hints: baseHints as any,
      spendTracker: { spent: 0n },
    });

    expect(res.ok).toBe(true);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    const call = walletClient.writeContract.mock.calls[0][0];
    expect(call.account.toLowerCase()).toBe(caller.toLowerCase());
    expect(call.functionName).toBe('redeemHintedTo');
    expect(res.ok ? res.caller.toLowerCase() : '').toBe(caller.toLowerCase());
    expect(res.ok ? res.recipient.toLowerCase() : '').toBe(
      recipient.toLowerCase()
    );
    expect(res.ok ? res.recipientBalances?.nativeDelta : 0n).toBe(100n);
  });

  it('AUTO_APPROVE=true submits approve then redeem (two txs) from caller', async () => {
    const { publicClient, walletClient, caller } = makeClients({
      caller: addr(999),
    });
    const recipient = addr(999);

    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(2n);

    // estimateContractGas called for approve (best-effort) and redeem
    publicClient.estimateContractGas.mockImplementation(
      ({ functionName }: any) => {
        if (functionName === 'approve') return 10n;
        if (functionName === 'redeemHintedTo') return 50n;
        return 1n;
      }
    );

    // allowance low
    let allowance = 0n;
    let musdBal = 1000n;
    let nativeBal = 1000n;
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return allowance;
      if (functionName === 'balanceOf') return musdBal;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockImplementation(() => nativeBal);

    walletClient.writeContract
      .mockResolvedValueOnce('0xapprove')
      .mockResolvedValueOnce('0xredeem');

    // After approve, allowance logically increases (executor doesn't re-check; keep simple)
    // After redeem, balances change
    publicClient.waitForTransactionReceipt.mockImplementation(
      async ({ hash }: any) => {
        if (hash === '0xapprove') {
          allowance = 1_000n;
          return {
            status: 'success',
            gasUsed: 5n,
            effectiveGasPrice: 2n,
            logs: [],
          };
        }
        musdBal = 900n;
        nativeBal = 1100n;
        return {
          status: 'success',
          gasUsed: 10n,
          effectiveGasPrice: 2n,
          logs: [],
        };
      }
    );

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: true,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient,
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(true);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
    expect(walletClient.writeContract.mock.calls[0][0].functionName).toBe(
      'approve'
    );
    expect(
      walletClient.writeContract.mock.calls[0][0].account.toLowerCase()
    ).toBe(caller.toLowerCase());
    expect(walletClient.writeContract.mock.calls[1][0].functionName).toBe(
      'redeemHintedTo'
    );
    expect(
      walletClient.writeContract.mock.calls[1][0].account.toLowerCase()
    ).toBe(caller.toLowerCase());
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(publicClient.waitForTransactionReceipt.mock.calls[0][0].hash).toBe(
      '0xapprove'
    );
    expect(publicClient.waitForTransactionReceipt.mock.calls[1][0].hash).toBe(
      '0xredeem'
    );
  });

  it('enforces MAX_GAS_PER_TX (GAS_CAP)', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(2n);
    publicClient.estimateContractGas.mockResolvedValue(100n);

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 50n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.reason).toBe('GAS_CAP');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('ESTIMATE_REVERT path rejects', async () => {
    const { publicClient, walletClient } = makeClients();
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(2n);
    publicClient.estimateContractGas.mockRejectedValue(new Error('revert'));

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.reason).toBe('ESTIMATE_REVERT');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('retry path: first writeContract throws transient, second succeeds, and retry_scheduled logs replanPerformed', async () => {
    const { publicClient, walletClient } = makeClients();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();

    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(3n); // refreshed on attempt==1 replan
    publicClient.estimateContractGas
      .mockResolvedValueOnce(50n) // initial
      .mockResolvedValueOnce(70n); // replan on attempt==1

    walletClient.writeContract
      .mockRejectedValueOnce(new Error('network hiccup'))
      .mockResolvedValueOnce('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 3n,
      logs: [],
    });

    const p = executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 1,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
      spendTracker: { spent: 0n },
    });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);

    const lines = consoleLogSpy.mock.calls
      .map((c: any[]) => String(c[0] ?? ''))
      .filter((l: string) => l.trim().startsWith('{'))
      .map((l: string) => JSON.parse(l) as any);
    const retry = lines.find((e: any) => e.event === 'retry_scheduled');
    expect(retry).toBeTruthy();
    expect(retry.replanPerformed).toBe(true);

    consoleLogSpy.mockRestore();
    vi.useRealTimers();
  });

  it('event decode path: parses RedemptionExecuted from receipt logs', async () => {
    const { publicClient, walletClient } = makeClients({ caller: addr(999) });
    const engine = addr(2);
    const recipient = addr(999);

    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(2n);
    publicClient.estimateContractGas.mockResolvedValue(50n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');

    // Build a realistic log without encodeEventLog() (not available in all viem versions).
    const topics = encodeEventTopics({
      abi: trovePilotEngineAbi,
      eventName: 'RedemptionExecuted',
      args: {
        jobId: 123n,
        caller: addr(999),
        recipient,
      },
    });
    const data = encodeAbiParameters(
      parseAbiParameters(
        'uint256 musdRequested,uint256 musdRedeemed,uint256 musdRefunded,uint256 collateralOut,uint256 maxIter,bool hinted'
      ),
      [100n, 90n, 10n, 42n, 50n, true]
    );

    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 2n,
      logs: [
        {
          address: engine,
          data,
          topics,
        },
      ],
    });

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: engine,
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 100n,
        truncatedMusd: 100n,
        effectiveMusd: 100n,
        maxIterations: 50,
        recipient,
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(true);
    expect(res.ok ? res.engineEvent?.jobId : undefined).toBe('123');
    expect(res.ok ? res.engineEvent?.musdRefunded : undefined).toBe('10');
  });

  it('spend cap: fee unavailable => FEE_UNAVAILABLE (when cap enabled)', async () => {
    const { publicClient, walletClient } = makeClients({ caller: addr(999) });
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockRejectedValue(new Error('no legacy'));

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1n, // enabling cap requires fee to be known
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 1n,
        truncatedMusd: 1n,
        effectiveMusd: 1n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.reason).toBe('FEE_UNAVAILABLE');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('spend cap: projected spend exceeds => SPEND_CAP', async () => {
    const { publicClient, walletClient } = makeClients({ caller: addr(999) });
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockRejectedValue(new Error('no eip1559'));
    publicClient.getGasPrice.mockResolvedValue(10n);
    publicClient.estimateContractGas.mockResolvedValue(100n);

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 5n, // cap below projected cost (100 * 10)
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 1n,
        truncatedMusd: 1n,
        effectiveMusd: 1n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
      spendTracker: { spent: 0n },
    });

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.reason).toBe('SPEND_CAP');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('estimateFeesPerGas missing maxFeePerGas => falls back to legacy gasPrice and submits legacy tx', async () => {
    const { publicClient, walletClient } = makeClients({ caller: addr(999) });
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: 2n,
    } as any);
    publicClient.getGasPrice.mockResolvedValue(7n);
    publicClient.estimateContractGas.mockResolvedValue(10n);
    walletClient.writeContract.mockResolvedValue('0xtxhash');
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 1n,
      effectiveGasPrice: 7n,
      logs: [],
    });

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1_000_000n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 1n,
        truncatedMusd: 1n,
        effectiveMusd: 1n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(true);
    const callArgs = walletClient.writeContract.mock.calls[0][0];
    expect(callArgs.gasPrice).toBe(7n);
    expect('maxFeePerGas' in callArgs).toBe(false);
    expect('maxPriorityFeePerGas' in callArgs).toBe(false);
  });

  it('MAX_NATIVE_SPENT_PER_RUN enabled and estimateFeesPerGas missing maxFeePerGas + getGasPrice fails => FEE_UNAVAILABLE', async () => {
    const { publicClient, walletClient } = makeClients({ caller: addr(999) });
    publicClient.readContract.mockImplementation(({ functionName }: any) => {
      if (functionName === 'allowance') return 1_000n;
      if (functionName === 'balanceOf') return 0n;
      throw new Error(`unexpected ${functionName}`);
    });
    publicClient.getBalance.mockResolvedValue(10_000n);
    publicClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: 2n,
    } as any);
    publicClient.getGasPrice.mockRejectedValue(new Error('no legacy'));
    publicClient.estimateContractGas.mockResolvedValue(10n);

    const res = await executeRedeemOnce({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      config: {
        musd: addr(1),
        trovePilotEngine: addr(2),
        dryRun: false,
        autoApprove: false,
        approveExact: true,
        maxTxRetries: 0,
        minKeeperBalanceWei: undefined,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        maxNativeSpentPerRun: 1n,
        maxGasPerTx: 1_000_000n,
        gasBufferPct: 0,
      },
      plan: {
        ok: true,
        requestedMusd: 1n,
        truncatedMusd: 1n,
        effectiveMusd: 1n,
        maxIterations: 50,
        recipient: addr(999),
        strictTruncation: false,
      },
      hints: baseHints as any,
    });

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.reason).toBe('FEE_UNAVAILABLE');
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
