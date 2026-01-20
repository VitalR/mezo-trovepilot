import { Address, decodeEventLog, isAddress } from 'viem';
import { log } from '../../src/core/logging.js';
import type { PublicClient as KeeperPublicClient } from '../../src/clients/mezoClient.js';
import { getCurrentPrice } from '../../src/core/price.js';
import { musdAbi } from '../../src/abis/musdAbi.js';
import { trovePilotEngineAbi } from '../../src/abis/trovePilotEngineAbi.js';
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
  writeStateWithHistory,
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const state = readJsonFile<TestnetStateV1>(stateFile);
  const book = loadAddressBook();
  const rpcUrl = requireEnv('MEZO_RPC_URL');
  const publicClient = buildPublicClient(rpcUrl);
  await assertTestnet(publicClient, book);

  initScriptLogContext({
    script: '04_verify_post_state',
    keeper: state.keeper?.address,
    network: process.env.NETWORK ?? book.network,
  });

  const callerRaw =
    argString(args, 'CALLER') ??
    process.env.CALLER ??
    state.redeemOnce?.caller ??
    state.actors?.caller ??
    state.keeper?.address;
  const callerParsed =
    callerRaw && isAddress(callerRaw) ? (callerRaw as Address) : undefined;

  const recipientRaw =
    argString(args, 'RECIPIENT') ??
    process.env.RECIPIENT ??
    state.redeemOnce?.recipient ??
    state.actors?.recipient ??
    state.keeper?.address;
  if (!recipientRaw || !isAddress(recipientRaw)) {
    throw new Error(
      'Missing recipient address. Provide --RECIPIENT=0x... or ensure state has redeemOnce.recipient.'
    );
  }
  const recipient = recipientRaw as Address;
  // Keep actors deterministic for auditability.
  const caller: Address = callerParsed ?? recipient;

  const price = await getCurrentPrice({
    client: publicClient as unknown as KeeperPublicClient,
    priceFeed: (state.addresses?.priceFeed ??
      book.mezo.price.priceFeed) as Address,
    minPrice: 0n,
    maxPrice: 0n,
    maxAgeSeconds: 0,
  });
  if (price === null) throw new Error('Unable to read price for verification');

  const txHash =
    argString(args, 'TX_HASH') ??
    process.env.TX_HASH ??
    state.redeemOnce?.txHash;

  const engineAddress = (state.addresses?.trovePilotEngine ??
    book.trovePilot.trovePilotEngine) as Address;
  const musdAddress = (state.addresses?.musd ??
    book.mezo.tokens.musd) as Address;

  let txConfirmed: boolean | undefined;
  const engineEvents: Array<Record<string, unknown>> = [];
  if (txHash) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      txConfirmed = receipt.status === 'success';
      for (const l of receipt.logs ?? []) {
        if ((l.address ?? '').toLowerCase() !== engineAddress.toLowerCase())
          continue;
        try {
          const decoded = decodeEventLog({
            abi: trovePilotEngineAbi,
            data: l.data,
            topics: l.topics,
          });
          engineEvents.push({
            eventName: decoded.eventName,
            args: decoded.args as any,
          });
        } catch {
          // ignore non-matching logs
        }
      }
    } catch (err) {
      log.jsonWarnWithError('testnet_verify_tx_failed', err, {
        component: 'testnet',
        txHash,
      });
    }
  }

  // Live deltas (best-effort)
  let liveBalances:
    | {
        musd: Address;
        recipient: Address;
        recipientMusd: string;
        recipientNative: string;
        caller?: Address;
        callerMusd?: string;
        callerNative?: string;
      }
    | undefined;
  try {
    const [recipientMusdBal, recipientNativeBal] = await Promise.all([
      publicClient.readContract({
        address: musdAddress,
        abi: musdAbi,
        functionName: 'balanceOf',
        args: [recipient],
      } as const) as unknown as bigint,
      publicClient.getBalance({ address: recipient }) as Promise<bigint>,
    ]);
    liveBalances = {
      musd: musdAddress,
      recipient,
      recipientMusd: recipientMusdBal.toString(),
      recipientNative: recipientNativeBal.toString(),
    };

    if (caller && caller.toLowerCase() !== recipient.toLowerCase()) {
      try {
        const [callerMusdBal, callerNativeBal] = await Promise.all([
          publicClient.readContract({
            address: musdAddress,
            abi: musdAbi,
            functionName: 'balanceOf',
            args: [caller],
          } as const) as unknown as bigint,
          publicClient.getBalance({ address: caller }) as Promise<bigint>,
        ]);
        liveBalances.caller = caller;
        liveBalances.callerMusd = callerMusdBal.toString();
        liveBalances.callerNative = callerNativeBal.toString();
      } catch (err) {
        log.jsonWarnWithError(
          'testnet_verify_caller_balance_read_failed',
          err,
          {
            component: 'testnet',
            caller,
          }
        );
      }
    }
  } catch (err) {
    log.jsonWarnWithError('testnet_verify_balance_read_failed', err, {
      component: 'testnet',
      recipient,
    });
  }

  // Optional: read engine jobId and current allowance (caller -> engine) best-effort.
  let engineJobId: string | undefined;
  try {
    const jid = (await publicClient.readContract({
      address: engineAddress,
      abi: trovePilotEngineAbi,
      functionName: 'jobId',
    } as const)) as unknown as bigint;
    engineJobId = jid.toString();
  } catch (err) {
    log.jsonWarnWithError('testnet_verify_engine_jobId_failed', err, {
      component: 'testnet',
      engineAddress,
    });
  }

  let allowanceCallerToEngine: string | undefined;
  try {
    const a = (await publicClient.readContract({
      address: musdAddress,
      abi: musdAbi,
      functionName: 'allowance',
      args: [caller, engineAddress],
    } as const)) as unknown as bigint;
    allowanceCallerToEngine = a.toString();
  } catch (err) {
    log.jsonWarnWithError('testnet_verify_allowance_failed', err, {
      component: 'testnet',
      caller,
      engineAddress,
    });
  }

  // Persist the live allowance back into state for auditability (best-effort).
  if (allowanceCallerToEngine !== undefined) {
    const nowMs = Date.now();
    const requiredWei =
      state.quote?.effectiveMusd ?? state.allowance?.requiredWei ?? '0';
    state.updatedAtMs = nowMs;
    state.actors = { caller, recipient };
    state.allowance = {
      ...(state.allowance ?? {
        checkedAtMs: nowMs,
        owner: caller,
        spender: engineAddress,
        allowanceWei: allowanceCallerToEngine,
        requiredWei,
      }),
      checkedAtMs: nowMs,
      caller,
      owner: caller,
      spender: engineAddress,
      allowanceWei: allowanceCallerToEngine,
      requiredWei,
    };
    writeStateWithHistory({
      stateFile,
      latestFile: latest,
      snapshotPrefix: 'testnet_verify',
      data: state,
    });
  }

  log.jsonInfo('testnet_verify_summary', {
    component: 'testnet',
    stateFile,
    caller,
    recipient,
    txHash: txHash ?? undefined,
    txConfirmed,
    engineAddress,
    engineJobId,
    allowanceCallerToEngine,
    engineEvents,
    quote: state.quote,
    redeemOnce: state.redeemOnce,
    priceE18: price.toString(),
    liveBalances,
  });
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
