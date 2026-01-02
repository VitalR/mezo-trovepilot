import { Address, decodeEventLog } from 'viem';
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

async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const state = readJsonFile<TestnetStateV1>(stateFile);
  if (!state.trove?.owner) throw new Error('Missing trove owner in state');
  const owner = state.trove.owner as Address;

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
    priceFeed: state.addresses.priceFeed,
    minPrice: 0n,
    maxPrice: 0n,
    maxAgeSeconds: 0,
  });

  if (price === null) throw new Error('Unable to read price for verification');

  // Trove status (best-effort; Mezo/Liquity-style numeric enum).
  let troveStatus: bigint | null = null;
  try {
    troveStatus = (await publicClient.readContract({
      address: state.addresses.troveManager,
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
      address: state.addresses.troveManager,
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
      address: state.addresses.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getPrev',
      args: [owner],
    })) as unknown as Address;
    const next = (await publicClient.readContract({
      address: state.addresses.sortedTroves,
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

  // Check 3: LiquidationEngine events in liquidation tx (decoded).
  const engineEvents: Array<Record<string, unknown>> = [];
  const txHash = state.keeperRunOnce?.txHash;
  let liquidationTxConfirmed: boolean = false;
  if (txHash) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      liquidationTxConfirmed = receipt.status === 'success';
      for (const l of receipt.logs ?? []) {
        if (
          (l.address ?? '').toLowerCase() !==
          state.addresses.liquidationEngine.toLowerCase()
        ) {
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
          // Ignore non-matching logs; LiquidationEngine has a small surface.
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
  });

  // Do not fail hard purely due to closed troves; verification is informative.
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
