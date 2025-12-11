import { loadConfig } from './config.js';
import { buildClients } from './clients/mezoClient.js';
import { getLiquidatableTroves } from './core/discovery.js';
import { buildLiquidationJobs } from './core/jobs.js';
import { executeLiquidationJob } from './core/executor.js';
import { log } from './core/logging.js';

async function fetchBtcPrice(staticPrice: bigint): Promise<bigint> {
  if (staticPrice === 0n) {
    throw new Error('STATIC_BTC_PRICE not set; stub price fetcher requires it');
  }
  return staticPrice;
}

async function main() {
  const config = loadConfig();
  const { publicClient, walletClient, account } = buildClients(config);

  log.info(`Keeper address ${account.address}`);

  const price = await fetchBtcPrice(config.staticBtcPrice);
  log.info(`Using price (1e18)=${price.toString()}`);

  const liquidatable = await getLiquidatableTroves({
    client: publicClient,
    troveManager: config.troveManager,
    sortedTroves: config.sortedTroves,
    price,
    maxTroves: config.maxTroves,
  });

  const jobs = buildLiquidationJobs({
    liquidatable,
    maxPerJob: config.maxPerJob,
    enableFallback: true,
  });

  log.info(
    `Built ${jobs.length} jobs from ${liquidatable.length} liquidatable troves`
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
