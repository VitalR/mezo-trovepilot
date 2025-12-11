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

  log.info(`Keeper address ${account.address}`);

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

  const discovery = await getLiquidatableTroves({
    client: publicClient,
    troveManager: config.troveManager,
    sortedTroves: config.sortedTroves,
    price,
    maxToScan: config.maxTrovesToScan,
    earlyExitThreshold: config.earlyExitScanThreshold,
  });

  const jobs = buildLiquidationJobs({
    liquidatable: discovery.liquidatableBorrowers,
    maxPerJob: config.maxTrovesPerJob,
    enableFallback: true,
  });

  log.info(
    `Discovery scanned=${discovery.totalScanned} belowMCR=${discovery.totalBelowMcr} liquidatable=${discovery.liquidatableBorrowers.length}`
  );
  log.info(
    `Built ${jobs.length} jobs from ${discovery.liquidatableBorrowers.length} liquidatable troves`
  );

  for (const job of jobs) {
    await executeLiquidationJob({
      publicClient,
      walletClient,
      liquidationEngine: config.liquidationEngine,
      job,
      dryRun: config.dryRun,
    });
  }

  log.info('Done');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
