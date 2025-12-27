import { Account, Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';

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

  let maxFeePerGas = config.maxFeePerGas;
  let maxPriorityFeePerGas = config.maxPriorityFeePerGas;
  if (maxFeePerGas === undefined) {
    try {
      const fees = await publicClient.estimateFeesPerGas();
      maxFeePerGas = fees.maxFeePerGas;
      if (maxPriorityFeePerGas === undefined) {
        maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
      }
    } catch {
      const gasPrice = await publicClient.getGasPrice();
      maxFeePerGas = gasPrice;
      // leave priority as provided (may be undefined)
    }
  }
  if (maxFeePerGas === undefined) {
    maxFeePerGas = 0n;
  }

  const emitJson = (event: string, data: Record<string, unknown>) => {
    log.jsonInfo(event, { component: 'executor', ...data });
  };

  type PlanResult =
    | {
        ok: true;
        workingCount: number;
        gasEstimate: bigint;
        estimatedCost: bigint;
      }
    | { ok: false; reason: 'GAS_CAP' | 'SPEND_CAP' };

  async function planForCount(
    limitCount: number,
    currentSpend: bigint
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

    const estimatedCost = gasEstimate * (maxFeePerGas ?? 0n);
    if (
      config.maxNativeSpentPerRun !== undefined &&
      maxFeePerGas !== undefined &&
      currentSpend + estimatedCost > config.maxNativeSpentPerRun
    ) {
      emitJson('job_skip', {
        reason: 'SPEND_CAP',
        projectedSpend: (currentSpend + estimatedCost).toString(),
        cap: config.maxNativeSpentPerRun.toString(),
        borrowersTotal: originalBorrowers.length,
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
    });

    return {
      ok: true,
      workingCount: workingCountLocal,
      gasEstimate,
      estimatedCost,
    };
  }

  const initialPlan = await planForCount(workingCount, spendTracker.spent);
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
          const replan = await planForCount(workingCount, spendTracker.spent);
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

      const hash = await walletClient.writeContract({
        address: liquidationEngine,
        abi: liquidationEngineAbi,
        functionName: 'liquidateRange',
        args: [borrowersForTx, job.fallbackOnFail],
        account: (walletAccount ?? null) as Account | Address | null,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasEstimate,
        chain: (walletClient as any).chain ?? null,
      });

      emitJson('tx_sent', {
        hash,
        workingCount,
        gasLimit: gasEstimate.toString(),
        maxFeePerGas: maxFeePerGas?.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas?.toString(),
      });

      log.info(
        `Tx sent: ${hash} (gas=${gasEstimate.toString()} maxFeePerGas=${maxFeePerGas.toString()} fallback=${
          job.fallbackOnFail
        } borrowers=${borrowersForTx.length})`
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const actualGasPrice = (receipt as any).effectiveGasPrice ?? maxFeePerGas;
      const actualGasUsed = receipt.gasUsed ?? gasEstimate;
      const actualCost = actualGasPrice * actualGasUsed;

      emitJson('tx_confirmed', {
        hash,
        status: receipt.status,
        gasUsed: actualGasUsed.toString(),
        effectiveGasPrice: actualGasPrice?.toString(),
        projectedCost: estimatedCost.toString(),
        actualCost: actualCost.toString(),
      });

      log.info(
        `Tx confirmed status=${
          receipt.status
        } gasUsed=${actualGasUsed.toString()} projectedCost=${estimatedCost.toString()} actualCost=${actualCost.toString()}`
      );

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
