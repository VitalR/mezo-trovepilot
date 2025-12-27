import { loadConfig } from './config.js';
import { buildClients } from './clients/mezoClient.js';
import { getLiquidatableTroves } from './core/discovery.js';
import { buildLiquidationJobs } from './core/jobs.js';
import { executeLiquidationJob } from './core/executor.js';
import { log, setLogContext } from './core/logging.js';
import { getCurrentPrice } from './core/price.js';

async function main() {
  const config = loadConfig();
  const { publicClient, walletClient, account } = buildClients(config);

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  setLogContext({
    component: 'keeper',
    keeper: account,
    network: process.env.NETWORK ?? 'mezo-testnet',
    runId,
  });

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
  const skippedBorrowers = new Set<string>();

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

  log.jsonInfo('run_summary', {
    component: 'index',
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
  });

  while (jobsQueue.length > 0) {
    const job = jobsQueue.shift()!;
    const res = await executeLiquidationJob({
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
    });

    if (res.leftoverBorrowers.length === 0) {
      continue;
    }

    const key = res.leftoverBorrowers.join(',');
    const unprocessed =
      res.processedBorrowers.length === 0 &&
      res.leftoverBorrowers.length === job.borrowers.length;

    if (unprocessed) {
      if (skippedBorrowers.has(key)) {
        log.warn(
          `Not re-queuing borrowers (${res.leftoverBorrowers.length}); already skipped this run due to caps`
        );
        continue;
      }
      skippedBorrowers.add(key);
      log.jsonInfo('requeue_skip', {
        component: 'index',
        reason: 'UNPROCESSABLE_THIS_RUN',
        borrowers: res.leftoverBorrowers.length,
      });
      continue;
    }

    jobsQueue.unshift({
      borrowers: res.leftoverBorrowers,
      fallbackOnFail: job.fallbackOnFail,
    });
    log.jsonInfo('requeue', {
      component: 'index',
      processedCount: res.processedBorrowers.length,
      leftoverCount: res.leftoverBorrowers.length,
    });
  }

  log.info('Done');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
