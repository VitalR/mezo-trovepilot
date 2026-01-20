import path from 'path';
import { Address, isAddress } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import { sortedTrovesAbi } from '../../src/abis/sortedTrovesAbi.js';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  sortedTrovesHintsAbi,
  troveManagerExtraAbi,
} from './_abis.js';
import {
  argBool,
  argNumber,
  argString,
  assertTestnet,
  ensureStateDir,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  requireConfirm,
  scriptPaths,
  writeJsonFile,
} from './_lib.js';
import {
  formatWeiToDecimal,
  parseDecimalToWei,
  solveDebtAmountForTargetIcr,
} from './borrowMath.js';
import { TestnetStateV1 } from './_types.js';

// Defaults (safe by default).
const MIN_COLLATERAL_BTC = '0.03';
const DEFAULT_COLLATERAL_BTC = MIN_COLLATERAL_BTC;
const DEFAULT_TARGET_ICR = 1.102; // 110.2%
const DEFAULT_DRY_RUN = true;

// Hinting parameters (deterministic defaults).
const DEFAULT_APPROX_TRIALS = 50;
const DEFAULT_APPROX_SEED = 42;

function requireAddress(v: unknown, name: string): Address {
  if (typeof v !== 'string' || !isAddress(v)) {
    throw new Error(`Invalid ${name}: ${String(v)}`);
  }
  return v as Address;
}

async function main() {
  const parsed = parseArgs();

  const collateralBtc =
    argString(parsed, 'COLLATERAL_BTC') ??
    process.env.COLLATERAL_BTC ??
    DEFAULT_COLLATERAL_BTC;
  const targetIcr =
    argNumber(parsed, 'TARGET_ICR') ??
    (process.env.TARGET_ICR ? Number(process.env.TARGET_ICR) : undefined) ??
    DEFAULT_TARGET_ICR;
  const dryRun =
    argBool(parsed, 'DRY_RUN') ??
    (process.env.DRY_RUN
      ? process.env.DRY_RUN.toLowerCase() === 'true'
      : undefined) ??
    DEFAULT_DRY_RUN;

  const approxTrials =
    argNumber(parsed, 'APPROX_TRIALS') ??
    (process.env.APPROX_TRIALS
      ? Number(process.env.APPROX_TRIALS)
      : undefined) ??
    DEFAULT_APPROX_TRIALS;
  const approxSeed =
    argNumber(parsed, 'APPROX_SEED') ??
    (process.env.APPROX_SEED ? Number(process.env.APPROX_SEED) : undefined) ??
    DEFAULT_APPROX_SEED;

  // Ensure we can read the full address book (borrowerOperations is not in BotConfig).
  const book = loadAddressBook();

  // Keeper config + clients (requires signer unless DRY_RUN and user still wants read-only).
  const config = loadConfig();
  const { publicClient, walletClient, account } = buildClients(config);

  await assertTestnet(publicClient, book);
  initScriptLogContext({
    script: '01_open_trove_near_mcr',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(dryRun);

  // Read on-chain price (1e18).
  const priceE18 = await getCurrentPrice({
    client: publicClient,
    priceFeed: config.priceFeed,
    minPrice: 0n,
    maxPrice: 0n,
    maxAgeSeconds: 0,
  });
  if (priceE18 === null) {
    throw new Error('Failed to read on-chain price');
  }

  const collateralWei = parseDecimalToWei(collateralBtc, 18);
  const minCollateralWei = parseDecimalToWei(MIN_COLLATERAL_BTC, 18);
  if (collateralWei < minCollateralWei) {
    throw new Error(
      `Refusing to open trove: COLLATERAL_BTC must be >= ${MIN_COLLATERAL_BTC} (got ${collateralBtc})`
    );
  }
  const targetIcrE18 = parseDecimalToWei(String(targetIcr), 18);
  const gasCompensationWei = (await publicClient.readContract({
    address: config.troveManager,
    abi: troveManagerExtraAbi,
    functionName: 'MUSD_GAS_COMPENSATION',
  })) as unknown as bigint;

  const getBorrowingFeeWei = async (debtAmountWei: bigint) =>
    (await publicClient.readContract({
      address: book.mezo.core.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [debtAmountWei],
    })) as unknown as bigint;

  const solve = await solveDebtAmountForTargetIcr({
    collateralWei,
    priceE18,
    targetIcrE18,
    gasCompensationWei,
    getBorrowingFeeWei,
  });

  // Hints per Mezo flow:
  // approxHint = hintHelpers.getApproxHint(nicr, trials, seed)
  // upper/lower = sortedTroves.findInsertPosition(nicr, approxHint, approxHint)
  const approx = (await publicClient.readContract({
    address: book.mezo.core.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getApproxHint',
    args: [solve.nicrE20, BigInt(approxTrials), BigInt(approxSeed)],
  })) as unknown as [Address, bigint, bigint];
  const [approxHint, approxDiff, approxSeedOut] = approx;
  const [upperHint, lowerHint] = (await publicClient.readContract({
    address: config.sortedTroves,
    abi: sortedTrovesHintsAbi,
    functionName: 'findInsertPosition',
    args: [solve.nicrE20, approxHint, approxHint],
  })) as unknown as [Address, Address];

  log.jsonInfo('testnet_open_trove_plan', {
    component: 'testnet',
    dryRun,
    addresses: {
      borrowerOperations: book.mezo.core.borrowerOperations,
      troveManager: config.troveManager,
      sortedTroves: config.sortedTroves,
      priceFeed: config.priceFeed,
    },
    params: {
      collateralBtc,
      collateralWei: collateralWei.toString(),
      targetIcr,
      priceE18: priceE18.toString(),
      collateralValueWei: solve.collateralValueWei.toString(),
      targetTotalDebtWei: solve.targetTotalDebtWei.toString(),
      gasCompensationWei: solve.gasCompensationWei.toString(),
      expectedFeeWei: solve.expectedFeeWei.toString(),
      expectedTotalDebtWei: solve.expectedTotalDebtWei.toString(),
      debtAmountWei: solve.debtAmountWei.toString(),
      modelIcrE18: solve.icrE18.toString(),
      hints: {
        nicrE20: solve.nicrE20.toString(),
        approxTrials,
        approxSeed,
        approxHint,
        approxDiff: approxDiff.toString(),
        approxSeedOut: approxSeedOut.toString(),
        upperHint,
        lowerHint,
      },
    },
  });

  if (dryRun) {
    log.info('DRY_RUN=true; not sending openTrove transaction');
    return;
  }

  const hash = (await (walletClient.writeContract as any)({
    address: book.mezo.core.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'openTrove',
    args: [solve.debtAmountWei, upperHint, lowerHint],
    value: collateralWei,
  })) as `0x${string}`;

  log.jsonInfo('testnet_open_trove_sent', {
    component: 'testnet',
    hash,
    owner: account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log.jsonInfo('testnet_open_trove_confirmed', {
    component: 'testnet',
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber?.toString(),
  });

  // Recompute ICR via TroveManager using current price.
  const icr = (await publicClient.readContract({
    address: config.troveManager,
    abi: troveManagerAbi,
    functionName: 'getCurrentICR',
    args: [account, priceE18],
  })) as unknown as bigint;

  // Persist state
  ensureStateDir();
  const { latest, stateDir } = scriptPaths();
  const createdAtMs = Date.now();
  const state: TestnetStateV1 = {
    version: 1,
    network: process.env.NETWORK ?? book.network,
    chainId: book.chainId,
    createdAtMs,
    updatedAtMs: createdAtMs,
    addresses: {
      troveManager: config.troveManager,
      sortedTroves: config.sortedTroves,
      priceFeed: config.priceFeed,
      borrowerOperations: book.mezo.core.borrowerOperations,
      trovePilotEngine: config.trovePilotEngine,
    },
    keeper: { address: account },
    trove: {
      owner: account,
      collateralBtc,
      collateralWei: collateralWei.toString(),
      targetIcr: String(targetIcr),
      debtAmountWei: solve.debtAmountWei.toString(),
      gasCompensationWei: gasCompensationWei.toString(),
      expectedFeeWei: solve.expectedFeeWei.toString(),
      expectedTotalDebtWei: solve.expectedTotalDebtWei.toString(),
      nicrE20: solve.nicrE20.toString(),
      approxHint,
      txHash: hash,
      priceAtOpen: priceE18.toString(),
      icrAtOpen: icr.toString(),
    },
  };

  const named = `trove_${createdAtMs}.json`;
  const stateFile = path.join(stateDir, named);
  writeJsonFile(stateFile, state);
  writeJsonFile(latest, state);

  log.info(`Wrote state: ${stateFile}`);
  log.info(`Updated latest: ${latest}`);
  log.info(
    `Opened trove for ${account} with collateral=${collateralBtc} BTC and debt=${formatWeiToDecimal(
      solve.debtAmountWei,
      18
    )} MUSD; ICR(1e18)=${icr.toString()}`
  );

  // Optional sanity check that the trove appears in sorted troves (best-effort).
  try {
    const next = (await publicClient.readContract({
      address: config.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getNext',
      args: [account],
    })) as unknown as Address;
    log.jsonInfo('testnet_open_trove_sortedTroves_probe', {
      component: 'testnet',
      owner: account,
      next,
    });
  } catch (err) {
    log.jsonWarnWithError('testnet_open_trove_sortedTroves_probe_failed', err, {
      component: 'testnet',
      owner: account,
    });
  }
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
