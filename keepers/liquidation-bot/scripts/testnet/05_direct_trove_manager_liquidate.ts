import { Address, isAddress } from 'viem';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import { loadConfig, MCR_ICR } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import {
  argBool,
  argString,
  assertTestnet,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  requireConfirm,
  scriptPaths,
  readJsonFile,
  writeStateWithHistory,
  ensureStateDir,
} from './_lib.js';
import type { TestnetStateV1 } from './_types.js';

/**
 * Experimental script: call TroveManager.liquidate(borrower) directly.
 *
 * This bypasses LiquidationEngine and avoids batchLiquidate/fallback logic so we can
 * isolate whether TroveManager itself is reverting.
 *
 * Safety:
 * - DRY_RUN=true by default
 * - Requires CONFIRM=true when DRY_RUN=false
 */
async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const borrowerRaw =
    argString(args, 'BORROWER') ?? process.env.BORROWER ?? undefined;
  if (!borrowerRaw || !isAddress(borrowerRaw)) {
    throw new Error(
      'Missing/invalid BORROWER. Provide --BORROWER=0x... (or BORROWER env).'
    );
  }
  const borrower = borrowerRaw as Address;

  const dryRun =
    argBool(args, 'DRY_RUN') ??
    (process.env.DRY_RUN
      ? process.env.DRY_RUN.toLowerCase() === 'true'
      : undefined) ??
    true;

  const book = loadAddressBook();
  const config = loadConfig();
  config.dryRun = dryRun;

  const { publicClient, walletClient, account } = buildClients(config);
  await assertTestnet(publicClient, book);
  const runId = initScriptLogContext({
    script: '05_direct_trove_manager_liquidate',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(config.dryRun);

  // Best-effort: load state if present; we update and snapshot it after.
  let state: TestnetStateV1 | undefined;
  try {
    state = readJsonFile<TestnetStateV1>(stateFile);
  } catch {
    state = undefined;
  }

  const price = await getCurrentPrice({
    client: publicClient as unknown as KeeperPublicClient,
    priceFeed: config.priceFeed,
    minPrice: config.minBtcPrice,
    maxPrice: config.maxBtcPrice,
    maxAgeSeconds: config.maxPriceAgeSeconds,
  });
  if (price === null)
    throw new Error('Price sanity/staleness failed; cannot proceed');

  const icr = (await publicClient.readContract({
    address: config.troveManager,
    abi: troveManagerAbi,
    functionName: 'getCurrentICR',
    args: [borrower, price],
  })) as unknown as bigint;

  log.jsonInfo('testnet_direct_liquidate_plan', {
    component: 'testnet',
    borrower,
    priceE18: price.toString(),
    icrE18: icr.toString(),
    mcrIcrE18: MCR_ICR.toString(),
    liquidatableByThisPrice: icr < MCR_ICR,
    troveManager: config.troveManager,
    dryRun: config.dryRun,
  });

  if (config.dryRun) {
    log.info('DRY RUN: would call TroveManager.liquidate(borrower)');
    return;
  }

  const balBefore = await publicClient.getBalance({ address: account });

  const hash = await walletClient.writeContract({
    address: config.troveManager,
    abi: troveManagerAbi,
    functionName: 'liquidate',
    args: [borrower],
    account: walletClient.account ?? account,
    // viem typings may require an explicit chain field depending on wallet client mode.
    chain: (walletClient as any).chain ?? null,
  });

  log.jsonInfo('tx_sent', {
    component: 'testnet',
    hash,
    borrower,
    runId,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const balAfter = await publicClient.getBalance({ address: account });

  ensureStateDir();
  const now = Date.now();
  const next: TestnetStateV1 = {
    ...(state ?? {
      version: 1,
      network: process.env.NETWORK ?? book.network,
      chainId: book.chainId,
      createdAtMs: now,
      updatedAtMs: now,
      addresses: {
        troveManager: config.troveManager,
        sortedTroves: config.sortedTroves,
        priceFeed: config.priceFeed,
        borrowerOperations: book.mezo.core.borrowerOperations,
        liquidationEngine: book.trovePilot.liquidationEngine,
        redemptionRouter: book.trovePilot.redemptionRouter,
      },
    }),
    updatedAtMs: now,
    keeper: { address: account },
    keeperRunOnce: {
      attemptedAtMs: now,
      dryRun: false,
      forceBorrower: borrower,
      processedBorrowers: [borrower],
      leftoverBorrowers: [],
      txHash: hash,
      txConfirmed: receipt.status === 'success',
      receipt: {
        status: String(receipt.status),
        gasUsed: receipt.gasUsed?.toString(),
        effectiveGasPrice: (receipt as any).effectiveGasPrice?.toString(),
      },
      balanceBeforeWei: balBefore.toString(),
      balanceAfterWei: balAfter.toString(),
      balanceDeltaWei: (balAfter - balBefore).toString(),
    },
  };

  const { latest: latestPath } = scriptPaths();
  const snapshot = writeStateWithHistory({
    stateFile,
    latestFile: latestPath,
    snapshotPrefix: `direct_tm_liquidate_${runId}`,
    data: next,
  });

  log.jsonInfo('testnet_state_updated', {
    component: 'testnet',
    stateFile,
    latest: latestPath,
    snapshot,
    txHash: hash,
    txStatus: receipt.status,
  });
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
