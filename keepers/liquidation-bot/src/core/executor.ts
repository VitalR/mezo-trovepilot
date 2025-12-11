import { Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';

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
  >;
  spendTracker?: { spent: bigint };
}): Promise<void> {
  const { publicClient, walletClient, liquidationEngine, job, dryRun, config } =
    params;
  const spendTracker = params.spendTracker ?? { spent: 0n };

  if (dryRun) {
    log.info(
      `DRY RUN: would liquidate ${job.borrowers.length} borrowers, fallback=${job.fallbackOnFail}`
    );
    return;
  }

  log.info(
    `Submitting liquidation: count=${job.borrowers.length} fallback=${job.fallbackOnFail}`
  );

  const gasEstimate = await publicClient.estimateContractGas({
    address: liquidationEngine,
    abi: liquidationEngineAbi,
    functionName: 'liquidateRange',
    args: [job.borrowers, job.fallbackOnFail],
    account: walletClient.account,
  });

  const maxFeePerGas =
    config.maxFeePerGas ?? (await publicClient.getGasPrice());
  const maxPriorityFeePerGas = config.maxPriorityFeePerGas;

  const estimatedCost = gasEstimate * maxFeePerGas;
  if (config.maxNativeSpentPerRun !== undefined) {
    const projected = spendTracker.spent + estimatedCost;
    if (projected > config.maxNativeSpentPerRun) {
      log.warn(
        `Skipping job: projected native spend ${projected.toString()} exceeds MAX_NATIVE_SPENT_PER_RUN ${config.maxNativeSpentPerRun.toString()}`
      );
      return;
    }
  }

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= config.maxTxRetries) {
    try {
      if (attempt > 0) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const hash = await walletClient.writeContract({
        address: liquidationEngine,
        abi: liquidationEngineAbi,
        functionName: 'liquidateRange',
        args: [job.borrowers, job.fallbackOnFail],
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasEstimate,
      });

      log.info(
        `Tx sent: ${hash} (gas=${gasEstimate.toString()} maxFeePerGas=${maxFeePerGas.toString()} fallback=${
          job.fallbackOnFail
        })`
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      log.info(
        `Tx confirmed status=${
          receipt.status
        } gasUsed=${receipt.gasUsed?.toString()}`
      );

      spendTracker.spent += estimatedCost;
      return;
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
}
