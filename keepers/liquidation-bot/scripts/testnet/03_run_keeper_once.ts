import { Address, isAddress } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { getLiquidatableTroves } from '../../src/core/discovery.js';
import { buildLiquidationJobs } from '../../src/core/jobs.js';
import { executeLiquidationJob } from '../../src/core/executor.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import { trovePilotEngineAbi } from '../../src/abis/trovePilotEngineAbi.js';
import { MCR_ICR } from '../../src/config.js';
import {
  argBool,
  argNumber,
  argString,
  assertTestnet,
  initScriptLogContext,
  loadAddressBook,
  parseAddressList,
  parseArgs,
  requireConfirm,
  scriptPaths,
  readJsonFile,
  ensureStateDir,
  writeStateWithHistory,
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

type CapturedEvent = Record<string, any>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

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
  const forceBorrowersRaw =
    argString(args, 'FORCE_BORROWERS') ??
    process.env.FORCE_BORROWERS ??
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
  const strictBatch =
    argBool(args, 'STRICT_BATCH') ??
    (process.env.STRICT_BATCH
      ? process.env.STRICT_BATCH.toLowerCase() === 'true'
      : undefined) ??
    false;

  const book = loadAddressBook();

  const config = loadConfig();
  if (dryRun !== undefined) {
    config.dryRun = dryRun;
  }

  const { publicClient, walletClient, account } = buildClients(config);
  await assertTestnet(publicClient, book);
  const runId = initScriptLogContext({
    script: '03_run_keeper_once',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(config.dryRun);

  const canonicalAddresses = {
    troveManager: config.troveManager,
    sortedTroves: config.sortedTroves,
    priceFeed: config.priceFeed,
    borrowerOperations: book.mezo.core.borrowerOperations,
    trovePilotEngine: config.trovePilotEngine,
    // Backwards compatibility for older state readers:
    liquidationEngine: config.trovePilotEngine,
    redemptionRouter: book.trovePilot.redemptionRouter,
  };

  // State is optional for this script (it can run purely from config).
  // If missing, create a minimal state so we can persist results.
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
      addresses: canonicalAddresses,
      keeper: { address: account },
    };
  }

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

  // Deterministic multi-borrower path: FORCE_BORROWERS lets operators specify
  // the exact borrowers to attempt in one tx (batch), avoiding scan nondeterminism.
  if (forceBorrowersRaw) {
    const borrowers = parseAddressList({
      name: 'FORCE_BORROWERS',
      raw: forceBorrowersRaw,
      allowEmpty: false,
    });

    // Pre-check ICRs at the current price to avoid sending known-bad txs.
    const checked: Array<{ borrower: Address; icrE18: bigint }> = [];
    for (const borrower of borrowers) {
      const icr = (await publicClient.readContract({
        address: config.troveManager,
        abi: troveManagerAbi,
        functionName: 'getCurrentICR',
        args: [borrower, price],
      })) as unknown as bigint;
      checked.push({ borrower, icrE18: icr });
    }

    const liquidatable = checked
      .filter((x) => x.icrE18 < MCR_ICR)
      .map((x) => x.borrower);

    log.jsonInfo('testnet_force_borrowers_precheck', {
      component: 'testnet',
      forceBorrowers: borrowers,
      priceE18: price.toString(),
      mcrIcrE18: MCR_ICR.toString(),
      icrs: checked.map((x) => ({
        borrower: x.borrower,
        icrE18: x.icrE18.toString(),
        belowMcr: x.icrE18 < MCR_ICR,
      })),
      liquidatableCount: liquidatable.length,
      strictBatch,
    });

    if (liquidatable.length === 0) {
      log.jsonInfo('testnet_run_once_skip', {
        component: 'testnet',
        reason: 'NONE_LIQUIDATABLE',
        forceBorrowers: borrowers,
        mcrIcrE18: MCR_ICR.toString(),
        priceE18: price.toString(),
        icrs: checked.map((x) => ({
          borrower: x.borrower,
          icrE18: x.icrE18.toString(),
        })),
      });
      return;
    }

    // STRICT_BATCH mode: do a best-effort preflight using eth_estimateGas against
    // the engine entrypoints to surface which borrower(s) cause reverts.
    if (!config.dryRun && strictBatch) {
      const recipient = account;
      const engine = config.trovePilotEngine;
      const singleEstimates: Array<{
        borrower: Address;
        ok: boolean;
        gas?: string;
        error?: string;
      }> = [];
      for (const b of liquidatable) {
        try {
          const g = await publicClient.estimateContractGas({
            address: engine,
            abi: trovePilotEngineAbi,
            functionName: 'liquidateSingle',
            args: [b, recipient],
            account: recipient,
          });
          singleEstimates.push({ borrower: b, ok: true, gas: g.toString() });
        } catch (e) {
          singleEstimates.push({ borrower: b, ok: false, error: String(e) });
        }
      }
      const estimateBatch = async (borrowers: Address[]) => {
        try {
          const g = await publicClient.estimateContractGas({
            address: engine,
            abi: trovePilotEngineAbi,
            functionName: 'liquidateBatch',
            args: [borrowers, recipient],
            account: recipient,
          });
          return { ok: true as const, gas: g.toString() };
        } catch (e) {
          return { ok: false as const, error: String(e) };
        }
      };

      const batchOrders: Array<{ name: string; borrowers: Address[] }> = [];
      // As provided (after filtering to liquidatable).
      batchOrders.push({ name: 'as_provided', borrowers: liquidatable });
      // For 2 borrowers, explicitly try the swapped order (order can matter in some TM implementations).
      if (liquidatable.length === 2) {
        batchOrders.push({
          name: 'reversed',
          borrowers: [liquidatable[1]!, liquidatable[0]!],
        });
      }
      // Also try ICR-sorted orders (best-effort; uses the same ICR values already fetched above).
      const icrMap = new Map<Address, bigint>();
      for (const x of checked) icrMap.set(x.borrower, x.icrE18);
      const byIcrAsc = [...liquidatable].sort((a, b) => {
        const ia = icrMap.get(a) ?? 0n;
        const ib = icrMap.get(b) ?? 0n;
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
      const byIcrDesc = [...byIcrAsc].reverse();
      batchOrders.push({ name: 'icr_asc', borrowers: byIcrAsc });
      batchOrders.push({ name: 'icr_desc', borrowers: byIcrDesc });

      const batchEstimates = [];
      for (const o of batchOrders) {
        batchEstimates.push({
          name: o.name,
          borrowers: o.borrowers,
          ...(await estimateBatch(o.borrowers)),
        });
      }

      const firstOk = batchEstimates.find((b) => b.ok);
      if (firstOk && firstOk.name !== 'as_provided') {
        log.jsonWarn('testnet_strict_batch_order_hint', {
          component: 'testnet',
          reason: 'BATCH_ONLY_WORKS_IN_ALTERNATE_ORDER',
          recommendedOrder: firstOk.name,
          borrowers: firstOk.borrowers,
        });
      }
      log.jsonInfo('testnet_strict_batch_preflight', {
        component: 'testnet',
        trovePilotEngine: engine,
        recipient,
        singles: singleEstimates,
        batchCandidates: batchEstimates,
      });
    }

    const job = { borrowers: liquidatable, fallbackOnFail: !strictBatch };
    const balBefore =
      account === ZERO_ADDRESS
        ? 0n
        : await publicClient.getBalance({ address: account });

    const { result: execRes, events } = await captureJsonLogs(async () => {
      return await executeLiquidationJob({
        publicClient,
        walletClient,
        trovePilotEngine: config.trovePilotEngine,
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
    if (!config.dryRun && strictBatch) {
      // In strict mode we require the executor to submit exactly one batch covering all
      // intended borrowers. If estimation reverts (or the job is shrunk), fail loudly.
      if (execRes.processedBorrowers.length !== liquidatable.length) {
        throw new Error(
          `STRICT_BATCH=true: batch liquidation not executed for full set (expected=${liquidatable.length}, processed=${execRes.processedBorrowers.length}). ` +
            `This usually means TroveManager.batchLiquidateTroves() would revert (e.g. price moved, a trove is no longer liquidatable, or batch ordering constraints).`
        );
      }
    }

    const balAfter =
      account === ZERO_ADDRESS
        ? balBefore
        : await publicClient.getBalance({ address: account });
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
      addresses: canonicalAddresses,
      keeper: account === ZERO_ADDRESS ? state.keeper : { address: account },
      keeperRunOnce: {
        attemptedAtMs: now,
        dryRun: Boolean(config.dryRun),
        forceBorrowers: borrowers,
        maxToScan: maxToScanOverride,
        processedBorrowers: execRes.processedBorrowers,
        leftoverBorrowers: execRes.leftoverBorrowers,
        txHash,
        txConfirmed: Boolean(txConfirmed),
        receipt: receiptInfo,
        balanceBeforeWei:
          account === ZERO_ADDRESS ? undefined : balBefore.toString(),
        balanceAfterWei:
          account === ZERO_ADDRESS ? undefined : balAfter.toString(),
        balanceDeltaWei:
          account === ZERO_ADDRESS ? undefined : delta.toString(),
      },
    };
    const { latest: latestPath } = scriptPaths();
    const snapshot = writeStateWithHistory({
      stateFile,
      latestFile: latestPath,
      snapshotPrefix: `run_once_${runId}`,
      data: next,
    });
    log.jsonInfo('testnet_state_updated', {
      component: 'testnet',
      stateFile,
      latest: latestPath,
      snapshot,
      txHash,
    });
    return;
  }

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
    const balBefore =
      account === ZERO_ADDRESS
        ? 0n
        : await publicClient.getBalance({ address: account });
    const { result: execRes, events } = await captureJsonLogs(async () => {
      return await executeLiquidationJob({
        publicClient,
        walletClient,
        trovePilotEngine: config.trovePilotEngine,
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
    const balAfter =
      account === ZERO_ADDRESS
        ? balBefore
        : await publicClient.getBalance({ address: account });
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
      // Always persist canonical addresses from CONFIG_PATH/env for consistency.
      // This prevents stale `.state/latest.json` from pinning an old engine address.
      addresses: canonicalAddresses,
      keeper: account === ZERO_ADDRESS ? state.keeper : { address: account },
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
        balanceBeforeWei:
          account === ZERO_ADDRESS ? undefined : balBefore.toString(),
        balanceAfterWei:
          account === ZERO_ADDRESS ? undefined : balAfter.toString(),
        balanceDeltaWei:
          account === ZERO_ADDRESS ? undefined : delta.toString(),
      },
    };
    const { latest: latestPath } = scriptPaths();
    const snapshot = writeStateWithHistory({
      stateFile,
      latestFile: latestPath,
      snapshotPrefix: `run_once_${runId}`,
      data: next,
    });
    log.jsonInfo('testnet_state_updated', {
      component: 'testnet',
      stateFile,
      latest: latestPath,
      snapshot,
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
  const balBefore =
    account === ZERO_ADDRESS
      ? 0n
      : await publicClient.getBalance({ address: account });

  const { result: execRes, events } = await captureJsonLogs(async () => {
    const job = jobsQueue[0]!;
    return await executeLiquidationJob({
      publicClient,
      walletClient,
      trovePilotEngine: config.trovePilotEngine,
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

  const balAfter =
    account === ZERO_ADDRESS
      ? balBefore
      : await publicClient.getBalance({ address: account });
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
    // Always persist canonical addresses from CONFIG_PATH/env for consistency.
    addresses: canonicalAddresses,
    keeper: account === ZERO_ADDRESS ? state.keeper : { address: account },
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
      balanceBeforeWei:
        account === ZERO_ADDRESS ? undefined : balBefore.toString(),
      balanceAfterWei:
        account === ZERO_ADDRESS ? undefined : balAfter.toString(),
      balanceDeltaWei: account === ZERO_ADDRESS ? undefined : delta.toString(),
    },
  };

  const { latest: latestPath } = scriptPaths();
  const snapshot = writeStateWithHistory({
    stateFile,
    latestFile: latestPath,
    snapshotPrefix: `run_once_${runId}`,
    data: next,
  });
  log.jsonInfo('testnet_state_updated', {
    component: 'testnet',
    stateFile,
    latest: latestPath,
    snapshot,
    txHash,
  });
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
