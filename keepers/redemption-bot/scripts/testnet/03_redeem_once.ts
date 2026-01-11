import { Address } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { log } from '../../src/core/logging.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { computeHintBundle } from '../../src/core/hinting.js';
import { buildRedeemPlan } from '../../src/core/strategy.js';
import { executeRedeemOnce } from '../../src/core/executor.js';
import {
  argBool,
  argNumber,
  argString,
  assertTestnet,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  requireConfirm,
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

  const { publicClient, walletClient, account } = buildClients(config);
  await assertTestnet(publicClient as any, book);
  initScriptLogContext({
    script: '03_redeem_once',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(config.dryRun);

  // State is optional for this script (it can run purely from config).
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
  if (price === null) throw new Error('Unable to read price');

  const hints = await computeHintBundle({
    client: publicClient as any,
    hintHelpers: book.mezo.core.hintHelpers,
    sortedTroves: book.mezo.core.sortedTroves,
    requestedMusd: config.redeemMusdAmount,
    priceE18: price,
    maxIterations: config.maxIterations,
    upperSeed: config.upperSeed,
    lowerSeed: config.lowerSeed,
    seedScanWindow: config.seedScanWindow,
  });

  const caller: Address = account;
  const recipient: Address = account; // scripts default to caller==recipient
  const plan = buildRedeemPlan({
    requestedMusd: config.redeemMusdAmount,
    truncatedMusd: hints.truncatedMusd,
    maxChunk: config.redeemMaxChunkMusd,
    maxIterations: config.maxIterations,
    strictTruncation: config.strictTruncation,
    recipient,
  });

  const nowMs = Date.now();
  state.updatedAtMs = nowMs;
  state.keeper = { address: recipient };
  state.actors = { caller, recipient };

  if (!plan.ok) {
    log.jsonInfo('job_skip', {
      component: 'testnet',
      reason: plan.reason,
      requestedMusd: plan.requestedMusd.toString(),
      truncatedMusd: plan.truncatedMusd?.toString(),
    });
    state.redeemOnce = {
      attemptedAtMs: nowMs,
      dryRun: config.dryRun,
      caller,
      recipient,
    };
    writeStateWithHistory({
      stateFile,
      latestFile: latest,
      snapshotPrefix: 'redeem_once_skip',
      data: state,
    });
    return;
  }

  // Execute with the same executor used by the main keeper.
  const spendTracker = { spent: 0n };
  const res = await executeRedeemOnce({
    publicClient: publicClient as any,
    walletClient: walletClient as any,
    config: {
      musd: book.mezo.tokens.musd,
      trovePilotEngine: book.trovePilot.trovePilotEngine,
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

  state.updatedAtMs = Date.now();
  state.quote = {
    attemptedAtMs: nowMs,
    caller,
    recipient,
    requestedMusd: plan.requestedMusd.toString(),
    truncatedMusd: plan.truncatedMusd.toString(),
    effectiveMusd: plan.effectiveMusd.toString(),
    maxIterations: plan.maxIterations,
    strictTruncation: plan.strictTruncation,
    maxChunkMusd: plan.maxChunk?.toString(),
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
      musdAmount: plan.effectiveMusd.toString(),
      recipient,
      firstHint: hints.firstHint,
      upperHint: hints.upperHint,
      lowerHint: hints.lowerHint,
      partialNICR: hints.partialNICR.toString(),
      maxIter: String(plan.maxIterations),
    },
  };

  state.redeemOnce = {
    attemptedAtMs: nowMs,
    dryRun: config.dryRun,
    hintFallbackUsed: res.ok ? res.hintFallbackUsed : undefined,
    calldataUsed: res.ok ? res.calldataUsed : undefined,
    recipient: res.ok ? res.recipient : recipient,
    txHash: res.ok ? res.txHash : undefined,
    txConfirmed: res.ok ? true : undefined,
    receipt: res.ok ? res.receipt : undefined,
    caller: res.ok ? res.caller : recipient,
    recipientMusdBefore: res.ok
      ? res.recipientBalances?.musdBefore?.toString()
      : undefined,
    recipientMusdAfter: res.ok
      ? res.recipientBalances?.musdAfter?.toString()
      : undefined,
    recipientMusdDelta: res.ok
      ? res.recipientBalances?.musdDelta?.toString()
      : undefined,
    recipientNativeBefore: res.ok
      ? res.recipientBalances?.nativeBefore?.toString()
      : undefined,
    recipientNativeAfter: res.ok
      ? res.recipientBalances?.nativeAfter?.toString()
      : undefined,
    recipientNativeDelta: res.ok
      ? res.recipientBalances?.nativeDelta?.toString()
      : undefined,
    engineEvent: res.ok ? res.engineEvent : undefined,
  };

  writeStateWithHistory({
    stateFile,
    latestFile: latest,
    snapshotPrefix: res.ok ? 'redeem_once_ok' : 'redeem_once_failed',
    data: state,
  });
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
