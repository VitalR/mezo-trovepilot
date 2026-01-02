import { Address, isAddress } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { getLiquidatableTroves } from '../../src/core/discovery.js';
import { buildLiquidationJobs } from '../../src/core/jobs.js';
import { executeLiquidationJob } from '../../src/core/executor.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import { MCR_ICR } from '../../src/config.js';
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
  writeJsonFile,
  ensureStateDir,
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

type CapturedEvent = Record<string, any>;

function captureJsonLogs<T>(
  fn: () => Promise<T>
): Promise<{ result: T; events: CapturedEvent[] }> {
  const events: CapturedEvent[] = [];
  const orig = console.log;
  console.log = (...args: any[]) => {
    try {
      const first = args[0];
      if (typeof first === 'string' && first.trim().startsWith('{')) {
        const parsed = JSON.parse(first);
        if (parsed && typeof parsed === 'object') events.push(parsed);
      }
    } catch {
      // ignore parse errors; we only care about JSONL
    }
    orig(...args);
  };

  return fn()
    .then((result) => ({ result, events }))
    .finally(() => {
      console.log = orig;
    });
}

async function main() {
  const args = parseArgs();

  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;
  const forceBorrower =
    argString(args, 'FORCE_BORROWER') ??
    process.env.FORCE_BORROWER ??
    undefined;
  const maxToScanOverride =
    argNumber(args, 'MAX_TO_SCAN') ??
    (process.env.MAX_TO_SCAN ? Number(process.env.MAX_TO_SCAN) : undefined) ??
    undefined;
  const dryRun =
    argBool(args, 'DRY_RUN') ??
    (process.env.DRY_RUN
      ? process.env.DRY_RUN.toLowerCase() === 'true'
      : undefined) ??
    undefined;

  const state = readJsonFile<TestnetStateV1>(stateFile);
  const book = loadAddressBook();

  const config = loadConfig();
  if (dryRun !== undefined) {
    config.dryRun = dryRun;
  }

  const { publicClient, walletClient, account } = buildClients(config);
  await assertTestnet(publicClient, book);
  initScriptLogContext({
    script: '03_run_keeper_once',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(config.dryRun);

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

  const spendTracker = { spent: 0n };

  // Prioritized borrower path: if FORCE_BORROWER is set, try it first deterministically.
  if (forceBorrower) {
    if (!isAddress(forceBorrower)) throw new Error('Invalid FORCE_BORROWER');
    const borrower = forceBorrower as Address;
    const icr = (await publicClient.readContract({
      address: config.troveManager,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [borrower, price],
    })) as unknown as bigint;

    if (icr >= MCR_ICR) {
      log.jsonInfo('testnet_run_once_skip', {
        component: 'testnet',
        reason: 'NOT_LIQUIDATABLE',
        borrower,
        icrE18: icr.toString(),
        mcrIcrE18: MCR_ICR.toString(),
      });
      return;
    }

    const job = { borrowers: [borrower], fallbackOnFail: true };
    const balBefore = await publicClient.getBalance({ address: account });
    const { result: execRes, events } = await captureJsonLogs(async () => {
      return await executeLiquidationJob({
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
    });
    const balAfter = await publicClient.getBalance({ address: account });
    const delta = balAfter - balBefore;

    const txConfirmed = events.find(
      (e) => e.event === 'tx_confirmed' && typeof e.hash === 'string'
    );
    const txSent = events.find(
      (e) => e.event === 'tx_sent' && typeof e.hash === 'string'
    );
    const txHash = (txConfirmed?.hash ?? txSent?.hash) as
      | `0x${string}`
      | undefined;

    const receiptInfo =
      txConfirmed && typeof txConfirmed === 'object'
        ? {
            status: txConfirmed.status ? String(txConfirmed.status) : undefined,
            gasUsed: txConfirmed.gasUsed
              ? String(txConfirmed.gasUsed)
              : undefined,
            effectiveGasPrice: txConfirmed.effectiveGasPrice
              ? String(txConfirmed.effectiveGasPrice)
              : undefined,
          }
        : undefined;

    ensureStateDir();
    const now = Date.now();
    const next: TestnetStateV1 = {
      ...state,
      updatedAtMs: now,
      keeper: { address: account },
      keeperRunOnce: {
        attemptedAtMs: now,
        dryRun: Boolean(config.dryRun),
        forceBorrower: borrower,
        maxToScan: maxToScanOverride,
        processedBorrowers: execRes.processedBorrowers,
        leftoverBorrowers: execRes.leftoverBorrowers,
        txHash,
        txConfirmed: Boolean(txConfirmed),
        receipt: receiptInfo,
        balanceBeforeWei: balBefore.toString(),
        balanceAfterWei: balAfter.toString(),
        balanceDeltaWei: delta.toString(),
      },
    };
    const { latest: latestPath } = scriptPaths();
    writeJsonFile(latestPath, next);
    writeJsonFile(stateFile, next);
    log.jsonInfo('testnet_state_updated', {
      component: 'testnet',
      stateFile,
      latest: latestPath,
      txHash,
    });
    return;
  }

  const maxToScan = maxToScanOverride ?? config.maxTrovesToScan;
  const discovery = await getLiquidatableTroves({
    client: publicClient,
    troveManager: config.troveManager,
    sortedTroves: config.sortedTroves,
    price,
    maxToScan,
    earlyExitThreshold: config.earlyExitScanThreshold,
  });

  const jobsQueue = buildLiquidationJobs({
    liquidatable: discovery.liquidatableBorrowers,
    maxPerJob: config.maxTrovesPerJob,
    enableFallback: true,
  });

  log.jsonInfo('testnet_run_once_summary', {
    component: 'testnet',
    priceE18: price.toString(),
    discovery: discovery.stats,
    liquidatableBorrowers: discovery.liquidatableBorrowers.length,
    jobs: jobsQueue.length,
    dryRun: config.dryRun,
    maxToScan,
  });

  if (jobsQueue.length === 0) {
    log.info('No jobs to run (no liquidatables discovered)');
    return;
  }

  // Balance snapshot for gas spend (best-effort).
  const balBefore = await publicClient.getBalance({ address: account });

  const { result: execRes, events } = await captureJsonLogs(async () => {
    const job = jobsQueue[0]!;
    return await executeLiquidationJob({
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
  });

  const balAfter = await publicClient.getBalance({ address: account });
  const delta = balAfter - balBefore;

  // Best-effort tx hash extraction from tx_sent/tx_confirmed events.
  const txSent = events.find(
    (e) => e.event === 'tx_sent' && typeof e.hash === 'string'
  );
  const txConfirmed = events.find(
    (e) => e.event === 'tx_confirmed' && typeof e.hash === 'string'
  );
  const txHash = (txConfirmed?.hash ?? txSent?.hash) as
    | `0x${string}`
    | undefined;

  log.info(
    `processed=${execRes.processedBorrowers.length} leftover=${
      execRes.leftoverBorrowers.length
    } spentWei=${spendTracker.spent.toString()}`
  );
  if (txHash) log.info(`txHash=${txHash}`);

  // Persist updated state.
  ensureStateDir();
  const now = Date.now();
  const next: TestnetStateV1 = {
    ...state,
    updatedAtMs: now,
    keeper: { address: account },
    keeperRunOnce: {
      attemptedAtMs: now,
      dryRun: Boolean(config.dryRun),
      forceBorrower:
        forceBorrower && isAddress(forceBorrower)
          ? (forceBorrower as Address)
          : undefined,
      processedBorrowers: execRes.processedBorrowers,
      leftoverBorrowers: execRes.leftoverBorrowers,
      txHash,
      txConfirmed: Boolean(txConfirmed),
      receipt:
        txConfirmed && typeof txConfirmed === 'object'
          ? {
              status: txConfirmed.status
                ? String(txConfirmed.status)
                : undefined,
              gasUsed: txConfirmed.gasUsed
                ? String(txConfirmed.gasUsed)
                : undefined,
              effectiveGasPrice: txConfirmed.effectiveGasPrice
                ? String(txConfirmed.effectiveGasPrice)
                : undefined,
            }
          : undefined,
      balanceBeforeWei: balBefore.toString(),
      balanceAfterWei: balAfter.toString(),
      balanceDeltaWei: delta.toString(),
    },
  };

  const { latest: latestPath } = scriptPaths();
  writeJsonFile(latestPath, next);
  writeJsonFile(stateFile, next);
  log.jsonInfo('testnet_state_updated', {
    component: 'testnet',
    stateFile,
    latest: latestPath,
    txHash,
  });
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
