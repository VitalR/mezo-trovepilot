import { Address } from 'viem';
import { troveManagerAbi } from '../../src/abis/troveManagerAbi.js';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs();

  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

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

  const state = readJsonFile<TestnetStateV1>(stateFile);
  if (!state.trove?.owner) {
    throw new Error(`STATE_FILE missing trove.owner: ${stateFile}`);
  }

  const book = loadAddressBook();
  const rpcUrl = requireEnv('MEZO_RPC_URL');
  const publicClient = buildPublicClient(rpcUrl);
  await assertTestnet(publicClient, book);

  initScriptLogContext({
    script: '02_poll_liquidatable',
    keeper: state.keeper?.address,
    network: process.env.NETWORK ?? book.network,
  });

  const owner = state.trove.owner as Address;

  log.jsonInfo('testnet_poll_start', {
    component: 'testnet',
    stateFile,
    owner,
    pollIntervalSec,
    timeoutSec,
    mcrIcrE18: MCR_ICR.toString(),
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
      priceFeed: state.addresses.priceFeed,
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

    const icr = (await publicClient.readContract({
      address: state.addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [owner, price],
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
