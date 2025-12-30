import { Account, Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';

type FeeInfo =
  | {
      mode: 'eip1559';
      source: 'config' | 'estimateFeesPerGas';
      known: true;
      maxFeePerGas?: bigint;
      // Always submitted (falls back to 0n when not sourceable).
      maxPriorityFeePerGas: bigint;
      // Always present for EIP-1559 to make log schema unambiguous.
      prioritySource: 'config' | 'estimateFeesPerGas';
      priorityKnown: boolean;
    }
  | {
      mode: 'legacy';
      source: 'getGasPrice';
      known: true;
      gasPrice: bigint;
    }
  | {
      mode: 'unknown';
      source: 'unknown';
      known: false;
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

  const computeBackoffMs = (attemptNumber: number) =>
    attemptNumber > 0 ? 500 * 2 ** (attemptNumber - 1) : 0;

  const buildFeeFields = (fee: FeeInfo) => {
    switch (fee.mode) {
      case 'eip1559':
        return {
          mode: 'eip1559',
          source: fee.source,
          known: fee.known,
          maxFeePerGas: fee.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
          gasPrice: undefined,
          prioritySource: fee.prioritySource,
          priorityKnown: fee.priorityKnown,
        };
      case 'legacy':
        return {
          mode: 'legacy',
          source: fee.source,
          known: fee.known,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
          gasPrice: fee.gasPrice.toString(),
        };
      case 'unknown':
        return {
          mode: 'unknown',
          source: fee.source,
          known: fee.known,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
          gasPrice: undefined,
        };
      default: {
        const _exhaustive: never = fee;
        throw new Error('Unhandled fee mode in buildFeeFields()');
      }
    }
  };

  async function resolveFeeInfo(): Promise<FeeInfo> {
    if (config.maxFeePerGas !== undefined) {
      let priorityFee: bigint = config.maxPriorityFeePerGas ?? 0n;
      let prioritySource: 'config' | 'estimateFeesPerGas' =
        config.maxPriorityFeePerGas !== undefined
          ? 'config'
          : 'estimateFeesPerGas';
      let priorityKnown: boolean = config.maxPriorityFeePerGas !== undefined;

      // Priority fee is either explicitly configured (source=config), or we attempt
      // estimateFeesPerGas (source=estimateFeesPerGas) even if it throws/returns undefined.
      if (config.maxPriorityFeePerGas === undefined) {
        try {
          const fees = await publicClient.estimateFeesPerGas();
          if (fees.maxPriorityFeePerGas === undefined) {
            priorityKnown = false;
            priorityFee = 0n;
          } else {
            priorityKnown = true;
            priorityFee = fees.maxPriorityFeePerGas;
          }
        } catch {
          priorityKnown = false;
          priorityFee = 0n; // fallback to explicit zero priority for type-2 tx safety
        }
      }
      return {
        mode: 'eip1559',
        source: 'config',
        maxFeePerGas: config.maxFeePerGas,
        maxPriorityFeePerGas: priorityFee,
        prioritySource,
        priorityKnown,
        known: true,
      };
    }

    try {
      const fees = await publicClient.estimateFeesPerGas();
      const priorityFee = fees.maxPriorityFeePerGas ?? 0n;
      const priorityKnown = fees.maxPriorityFeePerGas !== undefined;
      return {
        mode: 'eip1559',
        source: 'estimateFeesPerGas',
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: priorityFee,
        prioritySource: 'estimateFeesPerGas',
        priorityKnown,
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
        estimatedCost?: bigint;
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
      feePerGas !== undefined ? gasEstimate * feePerGas : undefined;
    if (
      config.maxNativeSpentPerRun !== undefined &&
      estimatedCost !== undefined &&
      currentSpend + estimatedCost > config.maxNativeSpentPerRun
    ) {
      emitJson('job_skip', {
        reason: 'SPEND_CAP',
        projectedSpend: (currentSpend + estimatedCost).toString(),
        cap: config.maxNativeSpentPerRun.toString(),
        borrowersTotal: originalBorrowers.length,
        fee: buildFeeFields(fee),
      });
      return { ok: false, reason: 'SPEND_CAP' };
    }

    emitJson('job_plan', {
      borrowersTotal: originalBorrowers.length,
      workingCount: workingCountLocal,
      gasEstimateRaw: rawGas.toString(),
      gasBuffered: gasEstimate.toString(),
      estimatedCost: estimatedCost?.toString(),
      estimatedCostKnown: estimatedCost !== undefined,
      maxGasPerJob:
        config.maxGasPerJob !== undefined
          ? config.maxGasPerJob.toString()
          : undefined,
      maxNativeSpentPerRun:
        config.maxNativeSpentPerRun !== undefined
          ? config.maxNativeSpentPerRun.toString()
          : undefined,
      fee: buildFeeFields(fee),
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
  let lastClassified:
    | { type: ReturnType<typeof classifyError>['type']; message: string }
    | undefined;
  while (attempt <= config.maxTxRetries) {
    try {
      if (attempt > 0) {
        const nextBackoffMs = computeBackoffMs(attempt);
        emitJson('retry_scheduled', {
          attempt,
          // TODO: remove backoffMs once downstream consumers migrate to nextBackoffMs (keeper v2.0+)
          backoffMs: nextBackoffMs,
          nextBackoffMs,
          replanPerformed: attempt === 1,
          reason: lastClassified?.type,
          message: lastClassified?.message,
        });
        await new Promise((r) => setTimeout(r, nextBackoffMs));
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
        if (feeInfo.maxFeePerGas !== undefined) {
          txArgs.maxFeePerGas = feeInfo.maxFeePerGas;
        }
        txArgs.maxPriorityFeePerGas = feeInfo.maxPriorityFeePerGas;
      } else if (feeInfo.mode === 'legacy') {
        txArgs.gasPrice = feeInfo.gasPrice;
      }

      const hash = await walletClient.writeContract(txArgs as any);

      emitJson('tx_sent', {
        hash,
        workingCount,
        gasLimit: gasEstimate.toString(),
        fee: buildFeeFields(feeInfo),
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const actualGasPrice =
        (receipt as any).effectiveGasPrice ??
        (feeInfo.mode === 'eip1559'
          ? feeInfo.maxFeePerGas ?? 0n
          : feeInfo.mode === 'legacy'
          ? feeInfo.gasPrice
          : 0n);
      const actualGasUsed = receipt.gasUsed ?? gasEstimate;
      const actualCost = actualGasPrice * actualGasUsed;

      emitJson('tx_confirmed', {
        hash,
        status: receipt.status,
        gasUsed: actualGasUsed.toString(),
        effectiveGasPrice: actualGasPrice?.toString(),
        projectedCost: estimatedCost?.toString(),
        projectedCostKnown: estimatedCost !== undefined,
        actualCost: actualCost.toString(),
        fee: {
          mode: feeInfo.mode,
          source: feeInfo.source,
          known: feeInfo.known,
          submittedMaxFeePerGas:
            feeInfo.mode === 'eip1559'
              ? feeInfo.maxFeePerGas?.toString()
              : undefined,
          submittedGasPrice:
            feeInfo.mode === 'legacy' ? feeInfo.gasPrice.toString() : undefined,
          submittedMaxPriorityFeePerGas:
            feeInfo.mode === 'eip1559'
              ? feeInfo.maxPriorityFeePerGas.toString()
              : undefined,
          prioritySource:
            feeInfo.mode === 'eip1559' ? feeInfo.prioritySource : undefined,
          priorityKnown:
            feeInfo.mode === 'eip1559' ? feeInfo.priorityKnown : undefined,
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
      lastClassified = classified;

      emitJson('tx_error', {
        attempt,
        reason: classified.type,
        replanPerformed: attempt === 1,
        message: classified.message,
        nextBackoffMs:
          attempt < config.maxTxRetries
            ? computeBackoffMs(attempt + 1)
            : undefined,
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
