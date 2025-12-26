import { loadConfig } from './config.js';
import { buildClients } from './clients/mezoClient.js';
import { getLiquidatableTroves } from './core/discovery.js';
import { buildLiquidationJobs } from './core/jobs.js';
import { executeLiquidationJob } from './core/executor.js';
import { log } from './core/logging.js';
import { getCurrentPrice } from './core/price.js';

async function main() {
  const config = loadConfig();
  const { publicClient, walletClient, account } = buildClients(config);

  log.info(`Keeper address ${account}`);

  const price = await getCurrentPrice({
    client: publicClient,
    priceFeed: config.priceFeed,
    minPrice: config.minBtcPrice,
    maxPrice: config.maxBtcPrice,
    maxAgeSeconds: config.maxPriceAgeSeconds,
  });

  if (price === null) {
    log.warn('Price sanity/staleness failed; skipping run');
    return;
  }

  log.info(`Using price (1e18)=${price.toString()}`);

  const spendTracker = { spent: 0n };

  const discovery = await getLiquidatableTroves({
    client: publicClient,
    troveManager: config.troveManager,
    sortedTroves: config.sortedTroves,
    price,
    maxToScan: config.maxTrovesToScan,
    earlyExitThreshold: config.earlyExitScanThreshold,
  });

  const jobsQueue = buildLiquidationJobs({
    liquidatable: discovery.liquidatableBorrowers,
    maxPerJob: config.maxTrovesPerJob,
    enableFallback: true,
  });

  log.info(
    JSON.stringify({
      discovery: {
        scanned: discovery.stats.scanned,
        liquidatable: discovery.stats.liquidatable,
        belowMcr: discovery.stats.belowMcr,
        earlyExit: discovery.stats.earlyExit,
        maxScan: config.maxTrovesToScan,
        threshold: config.earlyExitScanThreshold,
      },
      jobs: {
        total: jobsQueue.length,
        liquidatable: discovery.liquidatableBorrowers.length,
        maxPerJob: config.maxTrovesPerJob,
      },
    })
  );

  while (jobsQueue.length > 0) {
    const job = jobsQueue.shift()!;
    await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: config.liquidationEngine,
      job,
      dryRun: config.dryRun,
      config: {
        maxTxRetries: config.maxTxRetries,
        maxFeePerGas: config.maxFeePerGas,
        maxPriorityFeePerGas: config.maxPriorityFeePerGas,
        maxNativeSpentPerRun: config.maxNativeSpentPerRun,
        maxGasPerJob: config.maxGasPerJob,
        gasBufferPct: config.gasBufferPct,
      },
      spendTracker,
    }).then((res) => {
      if (res.leftoverBorrowers.length === 0) return;

      if (
        res.processedBorrowers.length === 0 &&
        res.leftoverBorrowers.length === job.borrowers.length
      ) {
        log.warn(
          `Skipping re-queue: job could not be processed this run (borrowers=${job.borrowers.length})`
        );
        return;
      }

      jobsQueue.unshift({
        borrowers: res.leftoverBorrowers,
        fallbackOnFail: job.fallbackOnFail,
      });
      log.warn(
        `Re-queued leftover borrowers=${res.leftoverBorrowers.length} processed=${res.processedBorrowers.length}`
      );
    });
  }

  log.info('Done');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
