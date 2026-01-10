import { Address, decodeEventLog, isAddress } from 'viem';
import { log } from '../../src/core/logging.js';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import { sortedTrovesAbi } from '../../src/abis/sortedTrovesAbi.js';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { MCR_ICR } from '../../src/config.js';
import { liquidationEngineEventsAbi, troveManagerExtraAbi } from './_abis.js';
import {
  argString,
  assertTestnet,
  buildPublicClient,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
  requireEnv,
  scriptPaths,
  readJsonFile,
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const state = readJsonFile<TestnetStateV1>(stateFile);
  const ownerArg =
    argString(args, 'BORROWER') ?? process.env.BORROWER ?? undefined;
  const inferredOwner =
    state.trove?.owner ??
    state.keeperRunOnce?.forceBorrower ??
    state.keeperRunOnce?.processedBorrowers?.[0];
  const ownerRaw = ownerArg ?? inferredOwner;
  if (!ownerRaw || !isAddress(ownerRaw)) {
    throw new Error(
      'Missing borrower address. Provide --BORROWER=0x... (or BORROWER env), or populate trove.owner / keeperRunOnce.forceBorrower in state.'
    );
  }
  const owner = ownerRaw as Address;

  const book = loadAddressBook();
  const rpcUrl = requireEnv('MEZO_RPC_URL');
  const publicClient = buildPublicClient(rpcUrl);
  await assertTestnet(publicClient, book);

  initScriptLogContext({
    script: '04_verify_post_state',
    keeper: state.keeper?.address,
    network: process.env.NETWORK ?? book.network,
  });

  // Check 1: Is it still below MCR (should be closed/liquidated, but if not, still report).
  const price = await getCurrentPrice({
    client: publicClient as unknown as KeeperPublicClient,
    priceFeed: (state.addresses?.priceFeed ??
      book.mezo.price.priceFeed) as Address,
    minPrice: 0n,
    maxPrice: 0n,
    maxAgeSeconds: 0,
  });

  if (price === null) throw new Error('Unable to read price for verification');

  // Trove status (best-effort; Mezo/Liquity-style numeric enum).
  let troveStatus: bigint | null = null;
  try {
    troveStatus = (await publicClient.readContract({
      address: (state.addresses?.troveManager ??
        book.mezo.core.troveManager) as Address,
      abi: troveManagerExtraAbi,
      functionName: 'getTroveStatus',
      args: [owner],
    })) as unknown as bigint;
  } catch (err) {
    log.jsonInfoWithError('testnet_verify_trove_status_failed', err, {
      component: 'testnet',
      owner,
    });
  }

  let icr: bigint | null = null;
  try {
    icr = (await publicClient.readContract({
      address: (state.addresses?.troveManager ??
        book.mezo.core.troveManager) as Address,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [owner, price],
    })) as unknown as bigint;
  } catch (err) {
    log.jsonWarnWithError('testnet_verify_icr_failed', err, {
      component: 'testnet',
      owner,
    });
  }

  // Check 2: SortedTroves membership probe (best-effort; implementations vary).
  let sortedProbe: { prev?: Address; next?: Address; ok: boolean } = {
    ok: true,
  };
  try {
    const prev = (await publicClient.readContract({
      address: (state.addresses?.sortedTroves ??
        book.mezo.core.sortedTroves) as Address,
      abi: sortedTrovesAbi,
      functionName: 'getPrev',
      args: [owner],
    })) as unknown as Address;
    const next = (await publicClient.readContract({
      address: (state.addresses?.sortedTroves ??
        book.mezo.core.sortedTroves) as Address,
      abi: sortedTrovesAbi,
      functionName: 'getNext',
      args: [owner],
    })) as unknown as Address;
    sortedProbe = { ok: true, prev, next };
  } catch (err) {
    sortedProbe = { ok: false };
    log.jsonInfoWithError('testnet_verify_sortedTroves_probe_failed', err, {
      component: 'testnet',
      owner,
    });
  }

  // Check 3: TrovePilotEngine (LiquidationExecuted) events in liquidation tx (decoded).
  const engineEvents: Array<Record<string, unknown>> = [];
  const txHash =
    argString(args, 'TX_HASH') ??
    process.env.TX_HASH ??
    state.keeperRunOnce?.txHash;
  let liquidationTxConfirmed: boolean = false;
  // Prefer the canonical address book value (CONFIG_PATH), since `.state/latest.json`
  // may contain stale addresses from previous deployments.
  const engineAddress = book.trovePilot.trovePilotEngine as Address;
  if (txHash) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      liquidationTxConfirmed = receipt.status === 'success';
      for (const l of receipt.logs ?? []) {
        if ((l.address ?? '').toLowerCase() !== engineAddress.toLowerCase()) {
          continue;
        }
        try {
          const decoded = decodeEventLog({
            abi: liquidationEngineEventsAbi,
            data: l.data,
            topics: l.topics,
          });
          engineEvents.push({
            eventName: decoded.eventName,
            args: decoded.args as any,
          });
        } catch {
          // Ignore non-matching logs.
        }
      }
    } catch (err) {
      log.jsonWarnWithError(
        'testnet_verify_liquidation_event_check_failed',
        err,
        {
          component: 'testnet',
          txHash,
        }
      );
    }
  }

  const liquidatableNow = icr !== null ? icr < MCR_ICR : undefined;

  const borrowerStatus =
    troveStatus === null ? 'unknown' : troveStatus === 1n ? 'active' : 'closed';

  if (txHash && engineEvents.length === 0) {
    throw new Error(
      'Unable to decode TrovePilotEngine events for this tx. Ensure configs/addresses.testnet.json points to the current TrovePilotEngine deployment.'
    );
  }

  // Optional: show MUSD balances for engine vs keeper to understand gasComp flows.
  const musd = book.mezo.tokens?.musd;
  const keeperAddr =
    state.keeper?.address ??
    (engineEvents.find((e) => e.eventName === 'LiquidationExecuted') as any)
      ?.args?.keeper;
  let musdBalances:
    | {
        musd: Address;
        engine: string;
        keeper?: string;
        keeperAddress?: Address;
      }
    | undefined;
  if (musd) {
    try {
      const engineBal = (await publicClient.readContract({
        address: musd,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [engineAddress],
      })) as unknown as bigint;
      let keeperBal: bigint | undefined;
      let keeperAddress: Address | undefined;
      if (keeperAddr && isAddress(keeperAddr)) {
        keeperAddress = keeperAddr as Address;
        keeperBal = (await publicClient.readContract({
          address: musd,
          abi: erc20BalanceOfAbi,
          functionName: 'balanceOf',
          args: [keeperAddress],
        })) as unknown as bigint;
      }
      musdBalances = {
        musd,
        engine: engineBal.toString(),
        keeper: keeperBal?.toString(),
        keeperAddress,
      };
    } catch (err) {
      log.jsonWarnWithError('testnet_verify_musd_balance_failed', err, {
        component: 'testnet',
        musd,
      });
    }
  }

  log.jsonInfo('testnet_verify_summary', {
    component: 'testnet',
    stateFile,
    owner,
    txHash: txHash ?? undefined,
    liquidationTxConfirmed,
    engineEvents,
    borrowerStatus,
    troveStatus: troveStatus?.toString(),
    priceE18: price.toString(),
    icrE18: icr?.toString(),
    liquidatableNow,
    sortedProbe,
    keeperBalanceDeltaWei: state.keeperRunOnce?.balanceDeltaWei,
    musdBalances,
  });

  // Do not fail hard purely due to closed troves; verification is informative.
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
