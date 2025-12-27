import { Account, Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';

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

  const originalBorrowers = [...job.borrowers];
  let currentBorrowers = [...job.borrowers];
  let leftoverBorrowers: Address[] = [];

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
      account: walletAccount ?? undefined,
    });
  }

  const bufferPct = config.gasBufferPct ?? 0;
  const applyBuffer = (g: bigint) => (g * BigInt(100 + bufferPct)) / 100n;

  const maxFeePerGas =
    config.maxFeePerGas ?? (await publicClient.getGasPrice());
  const maxPriorityFeePerGas = config.maxPriorityFeePerGas;

  async function planForBorrowers(
    allBorrowers: Address[],
    currentSpend: bigint
  ) {
    let working = [...allBorrowers];
    let gasEstimate = applyBuffer(await estimate(working));

    if (config.maxGasPerJob !== undefined && config.maxGasPerJob > 0n) {
      while (working.length > 1 && gasEstimate > config.maxGasPerJob) {
        const before = working.length;
        const nextCount = Math.max(1, Math.ceil(working.length / 2));
        working = working.slice(0, nextCount);
        log.warn(
          `Shrinking job for gas cap: before=${before} after=${
            working.length
          } maxGasPerJob=${config.maxGasPerJob.toString()}`
        );
        gasEstimate = applyBuffer(await estimate(working));
      }
      if (gasEstimate > config.maxGasPerJob) {
        log.warn(
          `Skipping job: estimated gas ${gasEstimate.toString()} exceeds MAX_GAS_PER_JOB ${config.maxGasPerJob.toString()} (borrowers=${
            working.length
          })`
        );
        return {
          ok: false,
          reason: 'GAS_CAP',
          gasEstimate,
          working,
          leftover: allBorrowers,
        } as const;
      }
    }

    const leftover = allBorrowers.slice(working.length);
    const estimatedCost = gasEstimate * maxFeePerGas;
    if (
      config.maxNativeSpentPerRun !== undefined &&
      currentSpend + estimatedCost > config.maxNativeSpentPerRun
    ) {
      log.warn(
        `Skipping job: projected native spend ${(
          currentSpend + estimatedCost
        ).toString()} exceeds MAX_NATIVE_SPENT_PER_RUN ${config.maxNativeSpentPerRun.toString()}`
      );
      return {
        ok: false,
        reason: 'SPEND_CAP',
        gasEstimate,
        working,
        leftover: allBorrowers,
      } as const;
    }

    return {
      ok: true,
      working,
      gasEstimate,
      leftover,
      estimatedCost,
    } as const;
  }

  const initialPlan = await planForBorrowers(
    currentBorrowers,
    spendTracker.spent
  );
  if (!initialPlan.ok) {
    return { processedBorrowers: [], leftoverBorrowers: originalBorrowers };
  }

  currentBorrowers = initialPlan.working;
  leftoverBorrowers = initialPlan.leftover;
  let gasEstimate = initialPlan.gasEstimate;
  let estimatedCost = initialPlan.estimatedCost;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= config.maxTxRetries) {
    try {
      if (attempt > 0) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        // Re-estimate once on first retry to adapt to state change
        if (attempt === 1) {
          const replan = await planForBorrowers(
            currentBorrowers,
            spendTracker.spent
          );
          if (!replan.ok) {
            return {
              processedBorrowers: [],
              leftoverBorrowers: originalBorrowers,
            };
          }
          leftoverBorrowers = leftoverBorrowers.concat(replan.leftover);
          currentBorrowers = replan.working;
          gasEstimate = replan.gasEstimate;
          estimatedCost = replan.estimatedCost;
        }
      }

      const hash = await walletClient.writeContract({
        address: liquidationEngine,
        abi: liquidationEngineAbi,
        functionName: 'liquidateRange',
        args: [currentBorrowers, job.fallbackOnFail],
        account: walletAccount,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasEstimate,
        chain: undefined,
      });

      log.info(
        `Tx sent: ${hash} (gas=${gasEstimate.toString()} maxFeePerGas=${maxFeePerGas.toString()} fallback=${
          job.fallbackOnFail
        } borrowers=${currentBorrowers.length})`
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const actualGasPrice = (receipt as any).effectiveGasPrice ?? maxFeePerGas;
      const actualGasUsed = receipt.gasUsed ?? gasEstimate;
      const actualCost = actualGasPrice * actualGasUsed;
      log.info(
        `Tx confirmed status=${
          receipt.status
        } gasUsed=${actualGasUsed.toString()} projectedCost=${estimatedCost.toString()} actualCost=${actualCost.toString()}`
      );

      spendTracker.spent += actualCost;
      return {
        processedBorrowers: currentBorrowers,
        leftoverBorrowers,
      };
    } catch (err) {
      lastErr = err;
      const isLast = attempt === config.maxTxRetries;
      const msg = String(err);
      // Basic classification: logic revert vs transport.
      const logicRevert =
        msg.toLowerCase().includes('revert') ||
        msg.toLowerCase().includes('execution reverted');
      log.warn(
        `Attempt ${attempt + 1}/${
          config.maxTxRetries + 1
        } failed (logic=${logicRevert}): ${msg}`
      );
      if (logicRevert) {
        // don't retry logic reverts
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
