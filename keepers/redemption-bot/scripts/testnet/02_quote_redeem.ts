import { Address } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { log } from '../../src/core/logging.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { computeHintBundle } from '../../src/core/hinting.js';
import { buildRedeemPlan } from '../../src/core/strategy.js';
import {
  argBool,
  argNumber,
  argString,
  assertTestnet,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  scriptPaths,
  readJsonFile,
  writeStateWithHistory,
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;
  const dryRun =
    argBool(args, 'DRY_RUN') ??
    (process.env.DRY_RUN
      ? process.env.DRY_RUN.toLowerCase() === 'true'
      : undefined) ??
    undefined;
  const maxIterOverride =
    argNumber(args, 'MAX_ITERATIONS') ??
    (process.env.MAX_ITERATIONS
      ? Number(process.env.MAX_ITERATIONS)
      : undefined) ??
    undefined;

  const book = loadAddressBook();
  const config = loadConfig();
  if (dryRun !== undefined) config.dryRun = dryRun;
  if (maxIterOverride !== undefined) config.maxIterations = maxIterOverride;

  const { publicClient, account } = buildClients(config);
  await assertTestnet(publicClient as any, book);
  initScriptLogContext({
    script: '02_quote_redeem',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  // Ensure we can create a state file even if missing.
  let state: TestnetStateV1;
  try {
    state = readJsonFile<TestnetStateV1>(stateFile);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
    const now = Date.now();
    state = {
      version: 1,
      network: process.env.NETWORK ?? book.network,
      chainId: book.chainId,
      createdAtMs: now,
      updatedAtMs: now,
      actors: { caller: account, recipient: account },
      addresses: {
        trovePilotEngine: book.trovePilot.trovePilotEngine,
        hintHelpers: book.mezo.core.hintHelpers,
        sortedTroves: book.mezo.core.sortedTroves,
        priceFeed: book.mezo.price.priceFeed,
        musd: book.mezo.tokens.musd,
      },
      keeper: { address: account },
    };
  }

  const price = await getCurrentPrice({
    client: publicClient as any,
    priceFeed: book.mezo.price.priceFeed,
    minPrice: config.minBtcPrice,
    maxPrice: config.maxBtcPrice,
    maxAgeSeconds: config.maxPriceAgeSeconds,
  });
  if (price === null) throw new Error('Unable to read price for quoting');

  const requested = config.redeemMusdAmount;

  const hints = await computeHintBundle({
    client: publicClient as any,
    hintHelpers: book.mezo.core.hintHelpers,
    sortedTroves: book.mezo.core.sortedTroves,
    requestedMusd: requested,
    priceE18: price,
    maxIterations: config.maxIterations,
    upperSeed: config.upperSeed,
    lowerSeed: config.lowerSeed,
    seedScanWindow: config.seedScanWindow,
  });

  const plan = buildRedeemPlan({
    requestedMusd: requested,
    truncatedMusd: hints.truncatedMusd,
    maxChunk: config.redeemMaxChunkMusd,
    maxIterations: config.maxIterations,
    strictTruncation: config.strictTruncation,
    recipient: account,
  });

  const nowMs = Date.now();
  state.updatedAtMs = nowMs;
  state.actors = { caller: account, recipient: account };
  state.quote = {
    attemptedAtMs: nowMs,
    caller: account,
    recipient: account,
    requestedMusd: requested.toString(),
    truncatedMusd: hints.truncatedMusd.toString(),
    effectiveMusd: plan.ok ? plan.effectiveMusd.toString() : '0',
    maxIterations: config.maxIterations,
    strictTruncation: config.strictTruncation,
    maxChunkMusd: config.redeemMaxChunkMusd?.toString(),
    priceE18: price.toString(),
    hints: {
      firstHint: hints.firstHint,
      partialNICR: hints.partialNICR.toString(),
      upperHint: hints.upperHint,
      lowerHint: hints.lowerHint,
      upperSeed: hints.upperSeed,
      lowerSeed: hints.lowerSeed,
      derivedSeeds: hints.derived,
      scannedTail: hints.scannedTail,
      insertHintsComputed: hints.insertHintsComputed,
    },
    calldata: {
      musdAmount: plan.ok ? plan.effectiveMusd.toString() : '0',
      recipient: account,
      firstHint: hints.firstHint,
      upperHint: hints.upperHint,
      lowerHint: hints.lowerHint,
      partialNICR: hints.partialNICR.toString(),
      maxIter: String(config.maxIterations),
    },
  };

  log.jsonInfo('redeem_quote', {
    component: 'testnet',
    requestedMusd: requested.toString(),
    truncatedMusd: hints.truncatedMusd.toString(),
    effectiveMusd: plan.ok ? plan.effectiveMusd.toString() : '0',
    strictTruncation: config.strictTruncation,
    planOk: plan.ok,
    planReason: plan.ok ? undefined : plan.reason,
    priceE18: price.toString(),
    hints: {
      firstHint: hints.firstHint,
      partialNICR: hints.partialNICR.toString(),
      upperHint: hints.upperHint,
      lowerHint: hints.lowerHint,
    },
    seeds: {
      derived: hints.derived,
      upperSeed: hints.upperSeed,
      lowerSeed: hints.lowerSeed,
      scannedTail: hints.scannedTail,
    },
    insertHintsComputed: hints.insertHintsComputed,
  });

  writeStateWithHistory({
    stateFile,
    latestFile: latest,
    snapshotPrefix: 'quote_redeem',
    data: state,
  });
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
