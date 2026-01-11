import { loadConfig } from './config.js';
import { buildClients } from './clients/mezoClient.js';
import { log, setLogContext } from './core/logging.js';
import { getCurrentPrice } from './core/price.js';
import { computeHintBundle } from './core/hinting.js';
import { buildRedeemPlan } from './core/strategy.js';
import { executeRedeemOnce } from './core/executor.js';

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
  log.jsonInfo('redeem_price', {
    component: 'price',
    priceE18: price.toString(),
  });

  const hints = await computeHintBundle({
    client: publicClient,
    hintHelpers: config.hintHelpers,
    sortedTroves: config.sortedTroves,
    requestedMusd: config.redeemMusdAmount,
    priceE18: price,
    maxIterations: config.maxIterations,
    upperSeed: config.upperSeed,
    lowerSeed: config.lowerSeed,
    seedScanWindow: config.seedScanWindow,
  });

  log.jsonInfo('redeem_hints', {
    component: 'hinting',
    requestedMusd: hints.requestedMusd.toString(),
    truncatedMusd: hints.truncatedMusd.toString(),
    firstHint: hints.firstHint,
    partialNICR: hints.partialNICR.toString(),
    maxIterations: hints.maxIterations,
  });
  log.jsonInfo('redeem_seeds', {
    component: 'hinting',
    derived: hints.derived,
    upperSeed: hints.upperSeed,
    lowerSeed: hints.lowerSeed,
    scannedTail: hints.scannedTail,
    upperHint: hints.upperHint,
    lowerHint: hints.lowerHint,
    insertHintsComputed: hints.insertHintsComputed,
  });

  // MVP default: caller == recipient (keeper collects collateral + refunds).
  // Executor still treats caller and recipient distinctly for correctness.
  const recipient = account;
  const plan = buildRedeemPlan({
    requestedMusd: config.redeemMusdAmount,
    truncatedMusd: hints.truncatedMusd,
    maxChunk: config.redeemMaxChunkMusd,
    maxIterations: config.maxIterations,
    strictTruncation: config.strictTruncation,
    recipient,
  });

  if (!plan.ok) {
    log.jsonInfo('job_skip', {
      component: 'strategy',
      reason: plan.reason,
      requestedMusd: plan.requestedMusd.toString(),
      truncatedMusd: plan.truncatedMusd?.toString(),
      maxIterations: plan.maxIterations,
      strictTruncation: plan.strictTruncation,
      maxChunk: plan.maxChunk?.toString(),
    });
    return;
  }

  log.jsonInfo('redeem_plan', {
    component: 'strategy',
    recipient: plan.recipient,
    requestedMusd: plan.requestedMusd.toString(),
    truncatedMusd: plan.truncatedMusd.toString(),
    effectiveMusd: plan.effectiveMusd.toString(),
    maxIterations: plan.maxIterations,
    strictTruncation: plan.strictTruncation,
    maxChunk: plan.maxChunk?.toString(),
  });

  const spendTracker = { spent: 0n };
  await executeRedeemOnce({
    publicClient,
    walletClient,
    config: {
      musd: config.musd,
      trovePilotEngine: config.trovePilotEngine,
      dryRun: config.dryRun,
      autoApprove: config.autoApprove,
      approveExact: config.approveExact,
      maxTxRetries: config.maxTxRetries,
      minKeeperBalanceWei: config.minKeeperBalanceWei,
      maxFeePerGas: config.maxFeePerGas,
      maxPriorityFeePerGas: config.maxPriorityFeePerGas,
      maxNativeSpentPerRun: config.maxNativeSpentPerRun,
      maxGasPerTx: config.maxGasPerTx,
      gasBufferPct: config.gasBufferPct,
    },
    plan,
    hints,
    spendTracker,
  });
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
