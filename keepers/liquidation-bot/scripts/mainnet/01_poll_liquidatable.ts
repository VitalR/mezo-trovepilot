import type { Address } from 'viem';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import { scanTrovesBelowIcr } from '../../src/core/discovery.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { log } from '../../src/core/logging.js';
import { MCR_ICR } from '../../src/config.js';
import { parseDecimalToWei } from '../testnet/borrowMath.js';
import {
  applyMainnetEnvAliases,
  argNumber,
  argString,
  assertMainnet,
  buildPublicClient,
  selectMainnetRpcUrl,
  initScriptLogContext,
  loadAddressBook,
  parseArgs,
} from './_lib.js';

async function main() {
  const args = parseArgs();
  applyMainnetEnvAliases();

  const book = loadAddressBook();
  // Choose a working RPC endpoint (some environments cannot resolve rpc.mezo.org).
  // NOTE: MEZO_RPC_URL_MAINNET may be a comma-separated list; selection happens here.
  const rpcUrl = await selectMainnetRpcUrl({ book });
  process.env.MEZO_RPC_URL = rpcUrl;
  const publicClient = buildPublicClient(rpcUrl);
  await assertMainnet(publicClient, { book, rpcUrl });

  initScriptLogContext({
    script: '01_poll_liquidatable',
    network: process.env.NETWORK ?? 'mezo-mainnet',
  });

  const topN =
    argNumber(args, 'TOP') ??
    (process.env.TOP ? Number(process.env.TOP) : undefined) ??
    20;
  const maxToScan =
    argNumber(args, 'MAX_TO_SCAN') ??
    (process.env.MAX_TO_SCAN ? Number(process.env.MAX_TO_SCAN) : undefined) ??
    500;
  const stopAfterFirstAbove =
    (
      argString(args, 'STOP_AFTER_FIRST_ABOVE') ??
      process.env.STOP_AFTER_FIRST_ABOVE ??
      'true'
    ).toLowerCase() !== 'false';

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

  log.jsonInfo('mainnet_poll_start', {
    component: 'mainnet',
    rpcUrl,
    chainIdExpected: book.chainId,
    mcrIcrE18: MCR_ICR.toString(),
    thresholdIcrE18: thresholdIcrE18.toString(),
    maxToScan,
    topN,
    stopAfterFirstAbove,
  });

  const price = await getCurrentPrice({
    client: publicClient as unknown as KeeperPublicClient,
    priceFeed: book.mezo.price.priceFeed,
    minPrice: 0n,
    maxPrice: 0n,
    maxAgeSeconds: 0,
  });

  if (price === null) {
    throw new Error('Price sanity/staleness failed; cannot proceed');
  }

  const res = await scanTrovesBelowIcr({
    client: publicClient as unknown as KeeperPublicClient,
    troveManager: book.mezo.core.troveManager,
    sortedTroves: book.mezo.core.sortedTroves,
    price,
    thresholdIcrE18,
    maxToScan,
    stopAfterFirstAboveThreshold: stopAfterFirstAbove,
  });

  log.jsonInfo('mainnet_scan_summary', {
    component: 'mainnet',
    priceE18: price.toString(),
    thresholdIcrE18: thresholdIcrE18.toString(),
    scanned: res.stats.scanned,
    belowThreshold: res.stats.belowThreshold,
    earlyExit: res.stats.earlyExit,
  });

  const top = res.borrowers.slice(0, Math.max(0, topN));
  for (const t of top) {
    log.jsonInfo('mainnet_scan_candidate', {
      component: 'mainnet',
      borrower: t.borrower as Address,
      icrE18: t.icrE18.toString(),
      thresholdIcrE18: thresholdIcrE18.toString(),
      liquidatableByMcr: t.icrE18 < MCR_ICR,
    });
  }

  if (top.length === 0) {
    log.info(
      `price=${price.toString()} none below threshold=${thresholdIcrE18.toString()} scanned=${
        res.stats.scanned
      }`
    );
  } else {
    log.info(
      `price=${price.toString()} belowThreshold=${
        res.stats.belowThreshold
      } showingTop=${top.length}`
    );
  }
}

main().catch((err) => {
  log.jsonErrorWithError('script_fatal', err, { component: 'mainnet' });
  process.exitCode = 1;
});
