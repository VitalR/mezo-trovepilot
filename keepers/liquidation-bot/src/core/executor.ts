import { Address } from 'viem';
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

  if (dryRun) {
    log.info(
      `DRY RUN: would liquidate ${job.borrowers.length} borrowers, fallback=${job.fallbackOnFail}`
    );
    return { processedBorrowers: [], leftoverBorrowers: [] };
  }

  log.info(
    `Submitting liquidation: count=${job.borrowers.length} fallback=${job.fallbackOnFail}`
  );

  const originalBorrowers = [...job.borrowers];
  let borrowers = [...job.borrowers];

  async function estimate(bList: Address[]) {
    return publicClient.estimateContractGas({
      address: liquidationEngine,
      abi: liquidationEngineAbi,
      functionName: 'liquidateRange',
      args: [bList, job.fallbackOnFail],
      account: walletClient.account,
    });
  }

  let gasEstimate = await estimate(borrowers);
  const bufferPct = config.gasBufferPct ?? 0;
  const applyBuffer = (g: bigint) => (g * BigInt(100 + bufferPct)) / 100n;
  gasEstimate = applyBuffer(gasEstimate);

  if (config.maxGasPerJob !== undefined && config.maxGasPerJob > 0n) {
    while (borrowers.length > 1 && gasEstimate > config.maxGasPerJob) {
      const before = borrowers.length;
      const nextCount = Math.max(1, Math.ceil(borrowers.length / 2));
      borrowers = borrowers.slice(0, nextCount);
      log.warn(
        `Shrinking job for gas cap: before=${before} after=${
          borrowers.length
        } maxGasPerJob=${config.maxGasPerJob.toString()}`
      );
      gasEstimate = applyBuffer(await estimate(borrowers));
    }
    if (gasEstimate > config.maxGasPerJob) {
      log.warn(
        `Skipping job: estimated gas ${gasEstimate.toString()} exceeds MAX_GAS_PER_JOB ${config.maxGasPerJob.toString()} (borrowers=${
          borrowers.length
        })`
      );
      return {
        processedBorrowers: [],
        leftoverBorrowers: originalBorrowers,
      };
    }
  }

  const gasEstimateBorrowers = borrowers;
  const leftoverBorrowers = originalBorrowers.slice(
    gasEstimateBorrowers.length
  );

  const maxFeePerGas =
    config.maxFeePerGas ?? (await publicClient.getGasPrice());
  const maxPriorityFeePerGas = config.maxPriorityFeePerGas;

  let estimatedCost = gasEstimate * maxFeePerGas;
  if (config.maxNativeSpentPerRun !== undefined) {
    const projected = spendTracker.spent + estimatedCost;
    if (projected > config.maxNativeSpentPerRun) {
      log.warn(
        `Skipping job: projected native spend ${projected.toString()} exceeds MAX_NATIVE_SPENT_PER_RUN ${config.maxNativeSpentPerRun.toString()}`
      );
      return { processedBorrowers: [], leftoverBorrowers: originalBorrowers };
    }
  }

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= config.maxTxRetries) {
    try {
      if (attempt > 0) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
        // Re-estimate once on first retry to adapt to state change
        if (attempt === 1) {
          gasEstimate = applyBuffer(await estimate(gasEstimateBorrowers));
          estimatedCost = gasEstimate * maxFeePerGas;
        }
      }

      const hash = await (walletClient.writeContract as any)({
        address: liquidationEngine,
        abi: liquidationEngineAbi,
        functionName: 'liquidateRange',
        args: [gasEstimateBorrowers, job.fallbackOnFail],
        account: ((walletClient as any).account ?? null) as
          | `0x${string}`
          | null,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasEstimate,
        chain: undefined,
      });

      log.info(
        `Tx sent: ${hash} (gas=${gasEstimate.toString()} maxFeePerGas=${maxFeePerGas.toString()} fallback=${
          job.fallbackOnFail
        } borrowers=${gasEstimateBorrowers.length})`
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
        processedBorrowers: gasEstimateBorrowers,
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
