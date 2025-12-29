import { Account, Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';

type FeeMode = 'eip1559' | 'legacy' | 'unknown';
type FeeSource = 'config' | 'estimateFeesPerGas' | 'getGasPrice' | 'unknown';
type FeeInfo = {
  mode: FeeMode;
  source: FeeSource;
  prioritySource?: FeeSource;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
  known: boolean;
};

export function classifyError(err: unknown): {
  type: 'logic' | 'rate_limit' | 'nonce' | 'underpriced' | 'transient';
  message: string;
} {
  const msg = String(err ?? '');
  const lower = msg.toLowerCase();
  if (lower.includes('revert')) return { type: 'logic', message: msg };
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many')
  )
    return { type: 'rate_limit', message: msg };
  if (lower.includes('nonce')) return { type: 'nonce', message: msg };
  if (lower.includes('underpriced') || lower.includes('replacement'))
    return { type: 'underpriced', message: msg };
  return { type: 'transient', message: msg };
}

export interface ExecuteResult {
  processedBorrowers: Address[];
  leftoverBorrowers: Address[];
}

export async function executeLiquidationJob(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  liquidationEngine: Address;
  job: LiquidationJob;
  dryRun?: boolean;
  config: Pick<
    BotConfig,
    | 'maxTxRetries'
    | 'maxFeePerGas'
    | 'maxPriorityFeePerGas'
    | 'maxNativeSpentPerRun'
    | 'maxGasPerJob'
    | 'gasBufferPct'
  >;
  spendTracker?: { spent: bigint };
}): Promise<ExecuteResult> {
  const { publicClient, walletClient, liquidationEngine, job, dryRun, config } =
    params;
  const spendTracker = params.spendTracker ?? { spent: 0n };
  const walletAccount: Account | Address | null = walletClient.account ?? null;
  const fromAddress: Address | undefined =
    walletAccount && typeof walletAccount === 'object'
      ? (walletAccount as Account).address
      : (walletAccount as Address | null) ?? undefined;

  const originalBorrowers = [...job.borrowers];
  let workingCount = originalBorrowers.length;

  if (dryRun) {
    log.info(
      `DRY RUN: would liquidate ${job.borrowers.length} borrowers, fallback=${job.fallbackOnFail}`
    );
    return { processedBorrowers: [], leftoverBorrowers: [] };
  }

  log.info(
    `Submitting liquidation: count=${job.borrowers.length} fallback=${job.fallbackOnFail}`
  );

  async function estimate(bList: Address[]) {
    return publicClient.estimateContractGas({
      address: liquidationEngine,
      abi: liquidationEngineAbi,
      functionName: 'liquidateRange',
      args: [bList, job.fallbackOnFail],
      account: fromAddress,
    });
  }

  const bufferPct = config.gasBufferPct ?? 0;
  const applyBuffer = (g: bigint) => (g * BigInt(100 + bufferPct)) / 100n;

  const emitJson = (event: string, data: Record<string, unknown>) => {
    log.jsonInfo(event, { component: 'executor', ...data });
  };

  async function resolveFeeInfo(): Promise<FeeInfo> {
    if (config.maxFeePerGas !== undefined) {
      let priorityFee: bigint | undefined = config.maxPriorityFeePerGas;
      let prioritySource: FeeSource | undefined;
      if (priorityFee === undefined) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          priorityFee = fees.maxPriorityFeePerGas;
          prioritySource = 'estimateFeesPerGas';
        } catch {
          // leave undefined if not available
        }
      }
      return {
        mode: 'eip1559',
        source: 'config',
        maxFeePerGas: config.maxFeePerGas,
        maxPriorityFeePerGas: priorityFee,
        prioritySource,
        known: true,
      };
    }

    try {
      const fees = await publicClient.estimateFeesPerGas();
      return {
        mode: 'eip1559',
        source: 'estimateFeesPerGas',
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        known: true,
      };
    } catch {
      // fall through
    }

    try {
      const gasPrice = await publicClient.getGasPrice();
      return {
        mode: 'legacy',
        source: 'getGasPrice',
        gasPrice,
        known: true,
      };
    } catch {
      return { mode: 'unknown', source: 'unknown', known: false };
    }
  }

  let feeInfo = await resolveFeeInfo();

  type PlanResult =
    | {
        ok: true;
        workingCount: number;
        gasEstimate: bigint;
        estimatedCost: bigint;
      }
    | { ok: false; reason: 'GAS_CAP' | 'SPEND_CAP' | 'FEE_UNAVAILABLE' };

  async function planForCount(
    limitCount: number,
    currentSpend: bigint,
    fee: FeeInfo
  ): Promise<PlanResult> {
    let workingCountLocal = limitCount;
    let borrowers = originalBorrowers.slice(0, workingCountLocal);
    let rawGas = await estimate(borrowers);
    let gasEstimate = applyBuffer(rawGas);

    if (config.maxGasPerJob !== undefined && config.maxGasPerJob > 0n) {
      while (workingCountLocal > 1 && gasEstimate > config.maxGasPerJob) {
        const before = workingCountLocal;
        workingCountLocal = Math.max(1, Math.ceil(workingCountLocal / 2));
        borrowers = originalBorrowers.slice(0, workingCountLocal);
        rawGas = await estimate(borrowers);
        gasEstimate = applyBuffer(rawGas);
        emitJson('job_shrink', {
          beforeCount: before,
          afterCount: workingCountLocal,
          reason: 'GAS_CAP',
          maxGasPerJob: config.maxGasPerJob.toString(),
        });
      }
      if (gasEstimate > config.maxGasPerJob) {
        emitJson('job_skip', {
          reason: 'GAS_CAP',
          gasEstimate: gasEstimate.toString(),
          maxGasPerJob: config.maxGasPerJob.toString(),
          borrowersTotal: originalBorrowers.length,
        });
        return { ok: false, reason: 'GAS_CAP' };
      }
    }

    const feePerGas =
      fee.mode === 'eip1559'
        ? fee.maxFeePerGas
        : fee.mode === 'legacy'
        ? fee.gasPrice
        : undefined;
    if (config.maxNativeSpentPerRun !== undefined && !fee.known) {
      emitJson('job_skip', {
        reason: 'FEE_UNAVAILABLE',
        borrowersTotal: originalBorrowers.length,
        fee: {
          mode: fee.mode,
          source: fee.source,
          known: fee.known,
        },
      });
      return { ok: false, reason: 'FEE_UNAVAILABLE' };
    }

    const estimatedCost =
      feePerGas !== undefined ? gasEstimate * feePerGas : 0n;
    if (
      config.maxNativeSpentPerRun !== undefined &&
      feePerGas !== undefined &&
      currentSpend + estimatedCost > config.maxNativeSpentPerRun
    ) {
      emitJson('job_skip', {
        reason: 'SPEND_CAP',
        projectedSpend: (currentSpend + estimatedCost).toString(),
        cap: config.maxNativeSpentPerRun.toString(),
        borrowersTotal: originalBorrowers.length,
        fee: {
          mode: fee.mode,
          source: fee.source,
          known: fee.known,
          maxFeePerGas: fee.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas?.toString(),
          gasPrice: fee.gasPrice?.toString(),
        },
      });
      return { ok: false, reason: 'SPEND_CAP' };
    }

    emitJson('job_plan', {
      borrowersTotal: originalBorrowers.length,
      workingCount: workingCountLocal,
      gasEstimateRaw: rawGas.toString(),
      gasBuffered: gasEstimate.toString(),
      estimatedCost: estimatedCost.toString(),
      maxGasPerJob:
        config.maxGasPerJob !== undefined
          ? config.maxGasPerJob.toString()
          : undefined,
      maxNativeSpentPerRun:
        config.maxNativeSpentPerRun !== undefined
          ? config.maxNativeSpentPerRun.toString()
          : undefined,
      fee: {
        mode: fee.mode,
        source: fee.source,
        known: fee.known,
        maxFeePerGas: fee.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas?.toString(),
        gasPrice: fee.gasPrice?.toString(),
        prioritySource: fee.prioritySource,
      },
    });

    return {
      ok: true,
      workingCount: workingCountLocal,
      gasEstimate,
      estimatedCost,
    };
  }

  const initialPlan = await planForCount(
    workingCount,
    spendTracker.spent,
    feeInfo
  );
  if (!initialPlan.ok) {
    return { processedBorrowers: [], leftoverBorrowers: originalBorrowers };
  }

  workingCount = initialPlan.workingCount;
  let gasEstimate = initialPlan.gasEstimate;
  let estimatedCost = initialPlan.estimatedCost;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= config.maxTxRetries) {
    try {
      if (attempt > 0) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        emitJson('retry', {
          attempt,
          reason: 'transient',
          backoffMs,
          replanPerformed: attempt === 1,
        });
        if (attempt === 1) {
          feeInfo = await resolveFeeInfo();
          const replan = await planForCount(
            workingCount,
            spendTracker.spent,
            feeInfo
          );
          if (!replan.ok) {
            return {
              processedBorrowers: [],
              leftoverBorrowers: originalBorrowers,
            };
          }
          workingCount = replan.workingCount;
          gasEstimate = replan.gasEstimate;
          estimatedCost = replan.estimatedCost;
        }
      }

      const borrowersForTx = originalBorrowers.slice(0, workingCount);

      const txArgs: Record<string, unknown> = {
        address: liquidationEngine,
        abi: liquidationEngineAbi,
        functionName: 'liquidateRange',
        args: [borrowersForTx, job.fallbackOnFail],
        account: (walletAccount ?? null) as Account | Address | null,
        gas: gasEstimate,
      };

      if (feeInfo.mode === 'eip1559') {
        if (feeInfo.maxFeePerGas !== undefined)
          txArgs.maxFeePerGas = feeInfo.maxFeePerGas;
        if (feeInfo.maxPriorityFeePerGas !== undefined)
          txArgs.maxPriorityFeePerGas = feeInfo.maxPriorityFeePerGas;
      } else if (feeInfo.mode === 'legacy') {
        if (feeInfo.gasPrice !== undefined) txArgs.gasPrice = feeInfo.gasPrice;
      }

      const hash = await walletClient.writeContract(txArgs as any);

      emitJson('tx_sent', {
        hash,
        workingCount,
        gasLimit: gasEstimate.toString(),
        fee: {
          mode: feeInfo.mode,
          source: feeInfo.source,
          known: feeInfo.known,
          maxFeePerGas: feeInfo.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: feeInfo.maxPriorityFeePerGas?.toString(),
          gasPrice: feeInfo.gasPrice?.toString(),
          prioritySource: feeInfo.prioritySource,
        },
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const actualGasPrice =
        (receipt as any).effectiveGasPrice ??
        feeInfo.maxFeePerGas ??
        feeInfo.gasPrice ??
        0n;
      const actualGasUsed = receipt.gasUsed ?? gasEstimate;
      const actualCost = actualGasPrice * actualGasUsed;

      emitJson('tx_confirmed', {
        hash,
        status: receipt.status,
        gasUsed: actualGasUsed.toString(),
        effectiveGasPrice: actualGasPrice?.toString(),
        projectedCost: estimatedCost.toString(),
        actualCost: actualCost.toString(),
        fee: {
          mode: feeInfo.mode,
          source: feeInfo.source,
          known: feeInfo.known,
          submittedMaxFeePerGas: feeInfo.maxFeePerGas?.toString(),
          submittedGasPrice: feeInfo.gasPrice?.toString(),
          submittedMaxPriorityFeePerGas:
            feeInfo.maxPriorityFeePerGas?.toString(),
          prioritySource: feeInfo.prioritySource,
        },
      });

      spendTracker.spent += actualCost;
      return {
        processedBorrowers: borrowersForTx,
        leftoverBorrowers: originalBorrowers.slice(workingCount),
      };
    } catch (err) {
      lastErr = err;
      const isLast = attempt === config.maxTxRetries;
      const classified = classifyError(err);

      emitJson('retry', {
        attempt,
        reason: classified.type,
        backoffMs: attempt > 0 ? 500 * 2 ** (attempt - 1) : 0,
        replanPerformed: attempt === 1,
        message: classified.message,
      });

      if (classified.type === 'logic') {
        break;
      }
      if (isLast) break;
    }
    attempt++;
  }

  log.error(`Job failed after ${config.maxTxRetries + 1} attempts`);
  if (lastErr) log.error(String(lastErr));
  return {
    processedBorrowers: [],
    leftoverBorrowers: originalBorrowers,
  };
}
