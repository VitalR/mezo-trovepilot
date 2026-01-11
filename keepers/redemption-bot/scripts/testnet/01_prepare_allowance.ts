import { Address } from 'viem';
import { loadConfig } from '../../src/config.js';
import { buildClients } from '../../src/clients/mezoClient.js';
import { musdAbi } from '../../src/abis/musdAbi.js';
import { log } from '../../src/core/logging.js';
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
} from './_lib.js';
import { TestnetStateV1 } from './_types.js';

async function main() {
  const args = parseArgs();
  const { latest } = scriptPaths();
  const stateFile =
    argString(args, 'STATE_FILE') ?? process.env.STATE_FILE ?? latest;

  const book = loadAddressBook();
  const config = loadConfig();
  const dryRun =
    argBool(args, 'DRY_RUN') ??
    (process.env.DRY_RUN
      ? process.env.DRY_RUN.toLowerCase() === 'true'
      : undefined) ??
    undefined;
  if (dryRun !== undefined) config.dryRun = dryRun;

  const { publicClient, walletClient, account } = buildClients(config);
  await assertTestnet(publicClient as any, book);
  initScriptLogContext({
    script: '01_prepare_allowance',
    keeper: account,
    network: process.env.NETWORK ?? book.network,
  });

  requireConfirm(config.dryRun);

  const caller: Address = account;
  const recipient: Address = account; // scripts default to caller==recipient
  const spender: Address = book.trovePilot.trovePilotEngine;
  const required = BigInt(process.env.REDEEM_MUSD_AMOUNT ?? '0');

  // Ensure we can create a state file even if missing.
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
      actors: { caller, recipient },
      addresses: {
        trovePilotEngine: book.trovePilot.trovePilotEngine,
        hintHelpers: book.mezo.core.hintHelpers,
        sortedTroves: book.mezo.core.sortedTroves,
        priceFeed: book.mezo.price.priceFeed,
        musd: book.mezo.tokens.musd,
      },
      keeper: { address: caller },
    };
  }
  state.actors = { caller, recipient };

  const allowance = (await publicClient.readContract({
    address: book.mezo.tokens.musd,
    abi: musdAbi,
    functionName: 'allowance',
    args: [caller, spender],
  } as const)) as unknown as bigint;

  log.jsonInfo('allowance_status', {
    component: 'testnet',
    musd: book.mezo.tokens.musd,
    caller,
    spender,
    allowance: allowance.toString(),
    required: required.toString(),
    autoApprove: config.autoApprove,
    approveExact: config.approveExact,
    dryRun: config.dryRun,
  });

  const nowMs = Date.now();
  state.updatedAtMs = nowMs;
  state.allowance = {
    checkedAtMs: nowMs,
    caller,
    owner: caller,
    spender,
    allowanceWei: allowance.toString(),
    requiredWei: required.toString(),
  };

  writeStateWithHistory({
    stateFile,
    latestFile: latest,
    snapshotPrefix: 'prepare_allowance',
    data: state,
  });

  // Optional auto-approve: kept deliberately minimal; main bot handles approve+redeem.
  if (
    !config.dryRun &&
    config.autoApprove &&
    required > 0n &&
    allowance < required
  ) {
    const approveAmount = config.approveExact ? required : (1n << 256n) - 1n;
    const txHash = (await walletClient.writeContract({
      address: book.mezo.tokens.musd,
      abi: musdAbi,
      functionName: 'approve',
      args: [spender, approveAmount],
      account: caller,
    } as any)) as `0x${string}`;

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    state.updatedAtMs = Date.now();
    state.allowance = {
      checkedAtMs: nowMs,
      caller,
      owner: caller,
      spender,
      allowanceWei: allowance.toString(),
      requiredWei: required.toString(),
      approveTxHash: txHash,
      approveConfirmed: receipt.status === 'success',
      receipt: {
        status: receipt.status,
        blockNumber: receipt.blockNumber?.toString(),
        gasUsed: receipt.gasUsed?.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      },
    };
    writeStateWithHistory({
      stateFile,
      latestFile: latest,
      snapshotPrefix: 'prepare_allowance_approved',
      data: state,
    });
    log.jsonInfo('approve_confirmed', {
      component: 'testnet',
      txHash,
      status: receipt.status,
    });
  }
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exitCode = 1;
});
