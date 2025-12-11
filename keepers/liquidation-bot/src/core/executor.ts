import { Address } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { liquidationEngineAbi } from '../abis/liquidationEngineAbi.js';
import { LiquidationJob } from './jobs.js';
import { log } from './logging.js';

export async function executeLiquidationJob(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  liquidationEngine: Address;
  job: LiquidationJob;
  dryRun?: boolean;
}): Promise<void> {
  const { publicClient, walletClient, liquidationEngine, job, dryRun } = params;

  if (dryRun) {
    log.info(
      `DRY RUN: would liquidate ${job.borrowers.length} borrowers, fallback=${job.fallbackOnFail}`
    );
    return;
  }

  log.info(
    `Submitting liquidation: count=${job.borrowers.length} fallback=${job.fallbackOnFail}`
  );

  const hash = await walletClient.writeContract({
    address: liquidationEngine,
    abi: liquidationEngineAbi,
    functionName: 'liquidateRange',
    args: [job.borrowers, job.fallbackOnFail],
  });

  log.info(`Tx sent: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log.info(
    `Tx confirmed status=${
      receipt.status
    } gasUsed=${receipt.gasUsed?.toString()}`
  );
}
