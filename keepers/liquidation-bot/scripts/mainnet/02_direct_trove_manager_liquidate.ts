import { Address, isAddress } from 'viem';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import { loadConfig, MCR_ICR } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import {
  applyMainnetEnvAliases,
  argBool,
  argString,
  assertMainnet,
  selectMainnetRpcUrl,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  requireConfirm,
  scriptPaths,
  readJsonFile,
  writeStateWithHistory,
  ensureStateDir,
} from './_lib.js';

type MainnetStateV1 = {
  version: 1;
  network: string;
  chainId: number;
  createdAtMs: number;
  updatedAtMs: number;
  keeper?: { address: Address };
  addresses?: {
    troveManager?: Address;
    sortedTroves?: Address;
    priceFeed?: Address;
  };
  mainnetDirectLiquidate?: {
    attemptedAtMs: number;
    dryRun: boolean;
    borrower: Address;
    txHash?: `0x${string}`;
    txConfirmed?: boolean;
    receipt?: { status?: string; gasUsed?: string; effectiveGasPrice?: string };
    balanceBeforeWei?: string;
    balanceAfterWei?: string;
    balanceDeltaWei?: string;
  };
};

/**
 * Mainnet script: call TroveManager.liquidate(borrower) directly.
 *
 * Safety:
 * - DRY_RUN=true by default
 * - Requires CONFIRM=true when DRY_RUN=false
 * - Enforces chainId=31612
 */
async function main() {
  const args = parseArgs();
  applyMainnetEnvAliases();

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

  // Choose a working RPC endpoint (some environments cannot resolve rpc.mezo.org).
  // Must happen before loadConfig/buildClients so the keeper core uses the selected URL.
  if (!process.env.MEZO_RPC_URL) {
    process.env.MEZO_RPC_URL = await selectMainnetRpcUrl({ book });
  }
  const config = loadConfig();
  config.dryRun = dryRun;

  const { publicClient, walletClient, account } = buildClients(config);
  await assertMainnet(publicClient, {
    book,
    rpcUrl: process.env.MEZO_RPC_URL,
  });
  const runId = initScriptLogContext({
    script: '02_direct_trove_manager_liquidate',
    keeper: account,
    network: process.env.NETWORK ?? 'mezo-mainnet',
  });

  requireConfirm(config.dryRun);

  // Best-effort: load state if present; we update and snapshot it after.
  let state: MainnetStateV1 | undefined;
  try {
    state = readJsonFile<MainnetStateV1>(stateFile);
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

  log.jsonInfo('mainnet_direct_liquidate_plan', {
    component: 'mainnet',
    borrower,
    priceE18: price.toString(),
    icrE18: icr.toString(),
    mcrIcrE18: MCR_ICR.toString(),
    liquidatableByThisPrice: icr < MCR_ICR,
    troveManager: config.troveManager,
    dryRun: config.dryRun,
  });

  if (icr >= MCR_ICR) {
    log.jsonWarn('mainnet_direct_liquidate_skip', {
      component: 'mainnet',
      reason: 'NOT_LIQUIDATABLE_BY_PRICE',
      borrower,
      icrE18: icr.toString(),
      mcrIcrE18: MCR_ICR.toString(),
    });
    return;
  }

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
    component: 'mainnet',
    hash,
    borrower,
    runId,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const balAfter = await publicClient.getBalance({ address: account });

  ensureStateDir();
  const now = Date.now();
  const next: MainnetStateV1 = {
    ...(state ?? {
      version: 1,
      network: process.env.NETWORK ?? 'mezo-mainnet',
      chainId: book.chainId,
      createdAtMs: now,
      updatedAtMs: now,
      addresses: {
        troveManager: config.troveManager,
        sortedTroves: config.sortedTroves,
        priceFeed: config.priceFeed,
      },
    }),
    updatedAtMs: now,
    keeper: { address: account },
    mainnetDirectLiquidate: {
      attemptedAtMs: now,
      dryRun: false,
      borrower,
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
    snapshotPrefix: `mainnet_direct_tm_liquidate_${runId}`,
    data: next,
  });

  log.jsonInfo('mainnet_state_updated', {
    component: 'mainnet',
    stateFile,
    latest: latestPath,
    snapshot,
    txHash: hash,
    txStatus: receipt.status,
  });
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'mainnet' });
  process.exitCode = 1;
});
