import { Address, isAddress } from 'viem';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import { scanTrovesBelowIcr } from '../../src/core/discovery.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import { MCR_ICR } from '../../src/config.js';
import {
  argNumber,
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
import { parseDecimalToWei } from './borrowMath.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs();

  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const ownerOverride =
    argString(args, 'OWNER') ?? process.env.OWNER ?? undefined;
  const ownerFromEnv =
    ownerOverride && isAddress(ownerOverride)
      ? (ownerOverride as Address)
      : undefined;

  const scan = (
    argString(args, 'SCAN') ??
    process.env.SCAN ??
    ''
  ).toLowerCase();
  const doScan = scan === 'true' || scan === '1' || scan === 'yes';
  const stopAfterFirstAbove =
    (
      argString(args, 'STOP_AFTER_FIRST_ABOVE') ??
      process.env.STOP_AFTER_FIRST_ABOVE ??
      'true'
    ).toLowerCase() !== 'false';
  const topN =
    argNumber(args, 'TOP') ??
    (process.env.TOP ? Number(process.env.TOP) : undefined) ??
    20;
  const maxToScan =
    argNumber(args, 'MAX_TO_SCAN') ??
    (process.env.MAX_TO_SCAN ? Number(process.env.MAX_TO_SCAN) : undefined) ??
    200;
  const thresholdPct =
    argString(args, 'THRESHOLD_PCT') ?? process.env.THRESHOLD_PCT;
  const thresholdIcr =
    argString(args, 'THRESHOLD_ICR') ?? process.env.THRESHOLD_ICR;
  const thresholdIcrE18 =
    thresholdIcr !== undefined
      ? parseDecimalToWei(thresholdIcr, 18)
      : thresholdPct !== undefined
      ? parseDecimalToWei(thresholdPct, 18) / 100n
      : MCR_ICR;

  const pollIntervalSec =
    argNumber(args, 'POLL_INTERVAL_SEC') ??
    (process.env.POLL_INTERVAL_SEC
      ? Number(process.env.POLL_INTERVAL_SEC)
      : undefined) ??
    15;
  const timeoutSec =
    argNumber(args, 'TIMEOUT_SEC') ??
    (process.env.TIMEOUT_SEC ? Number(process.env.TIMEOUT_SEC) : undefined) ??
    7200;

  const book = loadAddressBook();
  const rpcUrl = requireEnv('MEZO_RPC_URL');
  const publicClient = buildPublicClient(rpcUrl);
  await assertTestnet(publicClient, book);

  const state =
    doScan || ownerFromEnv
      ? undefined
      : readJsonFile<TestnetStateV1>(stateFile);
  if (!doScan && !ownerFromEnv && !state?.trove?.owner) {
    throw new Error(
      `Missing OWNER (env/arg) and STATE_FILE missing trove.owner: ${stateFile}`
    );
  }

  initScriptLogContext({
    script: '02_poll_liquidatable',
    keeper: state?.keeper?.address,
    network: process.env.NETWORK ?? book.network,
  });

  const owner = (ownerFromEnv ??
    (state?.trove?.owner as Address | undefined)) as Address | undefined;

  log.jsonInfo('testnet_poll_start', {
    component: 'testnet',
    stateFile,
    owner,
    pollIntervalSec,
    timeoutSec,
    mcrIcrE18: MCR_ICR.toString(),
    scan: doScan,
    thresholdIcrE18: thresholdIcrE18.toString(),
    maxToScan,
    topN,
    stopAfterFirstAbove,
  });

  const start = Date.now();
  while (true) {
    const elapsedSec = Math.floor((Date.now() - start) / 1000);
    if (elapsedSec > timeoutSec) {
      log.jsonError('testnet_poll_timeout', {
        component: 'testnet',
        stateFile,
        owner,
        elapsedSec,
        timeoutSec,
      });
      process.exitCode = 1;
      return;
    }

    const price = await getCurrentPrice({
      client: publicClient as unknown as KeeperPublicClient,
      priceFeed: (state?.addresses?.priceFeed ??
        book.mezo.price.priceFeed) as Address,
      minPrice: 0n,
      maxPrice: 0n,
      maxAgeSeconds: 0,
    });

    if (price === null) {
      log.jsonWarn('testnet_poll_price_unavailable', {
        component: 'testnet',
        elapsedSec,
      });
      await sleep(pollIntervalSec * 1000);
      continue;
    }

    if (doScan) {
      const res = await scanTrovesBelowIcr({
        client: publicClient as unknown as KeeperPublicClient,
        troveManager: book.mezo.core.troveManager,
        sortedTroves: book.mezo.core.sortedTroves,
        price,
        thresholdIcrE18,
        maxToScan,
        stopAfterFirstAboveThreshold: stopAfterFirstAbove,
      });

      log.jsonInfo('testnet_scan_summary', {
        component: 'testnet',
        elapsedSec,
        priceE18: price.toString(),
        thresholdIcrE18: thresholdIcrE18.toString(),
        scanned: res.stats.scanned,
        belowThreshold: res.stats.belowThreshold,
        earlyExit: res.stats.earlyExit,
      });

      const top = res.borrowers.slice(0, Math.max(0, topN));
      for (const t of top) {
        log.jsonInfo('testnet_scan_candidate', {
          component: 'testnet',
          borrower: t.borrower,
          icrE18: t.icrE18.toString(),
          thresholdIcrE18: thresholdIcrE18.toString(),
        });
      }

      if (top.length === 0) {
        log.info(
          `elapsed=${elapsedSec}s price=${price.toString()} none below threshold=${thresholdIcrE18.toString()} scanned=${
            res.stats.scanned
          }`
        );
      } else {
        log.info(
          `elapsed=${elapsedSec}s price=${price.toString()} belowThreshold=${
            res.stats.belowThreshold
          } showingTop=${top.length}`
        );
      }

      return;
    }

    const icr = (await publicClient.readContract({
      address: (state?.addresses?.troveManager ??
        book.mezo.core.troveManager) as Address,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [owner!, price],
    })) as unknown as bigint;

    const below = icr < MCR_ICR;
    const delta = icr >= MCR_ICR ? icr - MCR_ICR : MCR_ICR - icr;

    log.info(
      `elapsed=${elapsedSec}s price=${price.toString()} ICR=${icr.toString()} (${
        below ? 'LIQUIDATABLE' : 'safe'
      }) delta=${delta.toString()}`
    );
    log.jsonInfo('testnet_poll_sample', {
      component: 'testnet',
      elapsedSec,
      priceE18: price.toString(),
      icrE18: icr.toString(),
      mcrIcrE18: MCR_ICR.toString(),
      liquidatable: below,
      deltaToMcrE18: delta.toString(),
    });

    if (below) {
      log.jsonInfo('testnet_poll_liquidatable', {
        component: 'testnet',
        owner,
        elapsedSec,
        priceE18: price.toString(),
        icrE18: icr.toString(),
      });
      return;
    }

    await sleep(pollIntervalSec * 1000);
  }
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'testnet' });
  process.exitCode = 1;
});
