import { Account, Address, decodeEventLog } from 'viem';
import { PublicClient, WalletClient } from '../clients/mezoClient.js';
import { musdAbi } from '../abis/musdAbi.js';
import { trovePilotEngineAbi } from '../abis/trovePilotEngineAbi.js';
import { log } from './logging.js';
import { BotConfig } from '../config.js';
import { HintBundle } from './hinting.js';
import { RedeemPlan } from './strategy.js';

const MAX_UINT256 = (1n << 256n) - 1n;

type FeeInfo =
  | {
      mode: 'eip1559';
      source: 'config' | 'estimateFeesPerGas';
      known: true;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas: bigint;
      prioritySource: 'config' | 'estimateFeesPerGas';
      priorityKnown: boolean;
    }
  | {
      mode: 'legacy';
      source: 'getGasPrice';
      known: true;
      gasPrice: bigint;
    }
  | {
      mode: 'unknown';
      source: 'unknown';
      known: false;
    };

export function classifyError(err: unknown): {
  type: 'logic' | 'rate_limit' | 'nonce' | 'underpriced' | 'transient';
  message: string;
} {
  const msg = String(err ?? '');
  const lower = msg.toLowerCase();
  if (lower.includes('revert')) return { type: 'logic', message: msg };
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many')
  ) {
    return { type: 'rate_limit', message: msg };
  }
  if (lower.includes('nonce')) return { type: 'nonce', message: msg };
  if (lower.includes('underpriced') || lower.includes('replacement')) {
    return { type: 'underpriced', message: msg };
  }
  return { type: 'transient', message: msg };
}

function computeBackoffMs(attemptNumber: number) {
  return attemptNumber > 0 ? 500 * 2 ** (attemptNumber - 1) : 0;
}

async function sleepMs(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function buildFeeFields(fee: FeeInfo) {
  switch (fee.mode) {
    case 'eip1559':
      return {
        mode: 'eip1559',
        source: fee.source,
        known: fee.known,
        maxFeePerGas: fee.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
        gasPrice: undefined,
        prioritySource: fee.prioritySource,
        priorityKnown: fee.priorityKnown,
      };
    case 'legacy':
      return {
        mode: 'legacy',
        source: fee.source,
        known: fee.known,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        gasPrice: fee.gasPrice.toString(),
      };
    case 'unknown':
      return {
        mode: 'unknown',
        source: fee.source,
        known: fee.known,
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        gasPrice: undefined,
      };
    default: {
      const _exhaustive: never = fee;
      throw new Error('Unhandled fee mode in buildFeeFields()');
    }
  }
}

async function resolveFeeInfo(params: {
  publicClient: PublicClient;
  config: Pick<BotConfig, 'maxFeePerGas' | 'maxPriorityFeePerGas'>;
}): Promise<FeeInfo> {
  const { publicClient, config } = params;

  if (config.maxFeePerGas !== undefined) {
    let priorityFee: bigint = config.maxPriorityFeePerGas ?? 0n;
    let prioritySource: 'config' | 'estimateFeesPerGas' =
      config.maxPriorityFeePerGas !== undefined
        ? 'config'
        : 'estimateFeesPerGas';
    let priorityKnown: boolean = config.maxPriorityFeePerGas !== undefined;

    if (config.maxPriorityFeePerGas === undefined) {
      try {
        const fees = await publicClient.estimateFeesPerGas();
        if (fees.maxPriorityFeePerGas === undefined) {
          priorityKnown = false;
          priorityFee = 0n;
        } else {
          priorityKnown = true;
          priorityFee = fees.maxPriorityFeePerGas;
        }
      } catch {
        priorityKnown = false;
        priorityFee = 0n;
      }
    }

    return {
      mode: 'eip1559',
      source: 'config',
      maxFeePerGas: config.maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      prioritySource,
      priorityKnown,
      known: true,
    };
  }

  try {
    const fees = await publicClient.estimateFeesPerGas();
    // If maxFeePerGas is missing, we cannot safely treat fees as "known".
    // Fall back to legacy gasPrice, and if that fails, return unknown.
    if (fees.maxFeePerGas === undefined) {
      log.jsonInfo('fee_estimate_missing_maxFeePerGas', {
        component: 'executor',
        mode: 'eip1559',
        source: 'estimateFeesPerGas',
        priorityKnown: fees.maxPriorityFeePerGas !== undefined,
        priorityFee: (fees.maxPriorityFeePerGas ?? 0n).toString(),
        action: 'fallback_legacy',
      });
      throw new Error('estimateFeesPerGas_missing_maxFeePerGas');
    }
    const priorityFee = fees.maxPriorityFeePerGas ?? 0n;
    const priorityKnown = fees.maxPriorityFeePerGas !== undefined;
    return {
      mode: 'eip1559',
      source: 'estimateFeesPerGas',
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      prioritySource: 'estimateFeesPerGas',
      priorityKnown,
      known: true,
    };
  } catch {
    // fall through
  }

  try {
    const gasPrice = await publicClient.getGasPrice();
    return { mode: 'legacy', source: 'getGasPrice', gasPrice, known: true };
  } catch {
    return { mode: 'unknown', source: 'unknown', known: false };
  }
}

type EngineRedemptionExecutedEvent = {
  jobId?: string;
  musdRequested?: string;
  musdRedeemed?: string;
  musdRefunded?: string;
  collateralOut?: string;
  maxIter?: string;
};

export type ExecuteRedeemResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      receipt: {
        status?: string;
        blockNumber?: string;
        gasUsed?: string;
        effectiveGasPrice?: string;
      };
      spendWei?: bigint;
      caller: Address;
      recipient: Address;
      callerBalances?: {
        musdBefore?: bigint;
        musdAfter?: bigint;
        musdDelta?: bigint;
        nativeBefore?: bigint;
        nativeAfter?: bigint;
        nativeDelta?: bigint;
      };
      recipientBalances?: {
        musdBefore?: bigint;
        musdAfter?: bigint;
        musdDelta?: bigint;
        nativeBefore?: bigint;
        nativeAfter?: bigint;
        nativeDelta?: bigint;
      };
      engineEvent?: EngineRedemptionExecutedEvent;
    }
  | {
      ok: false;
      reason:
        | 'DRY_RUN'
        | 'ALLOWANCE_REQUIRED'
        | 'ESTIMATE_REVERT'
        | 'FEE_UNAVAILABLE'
        | 'SPEND_CAP'
        | 'GAS_CAP'
        | 'INSUFFICIENT_BALANCE'
        | 'TX_FAILED';
      errorType?: string;
      message?: string;
    };

export async function executeRedeemOnce(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  config: Pick<
    BotConfig,
    | 'musd'
    | 'trovePilotEngine'
    | 'dryRun'
    | 'autoApprove'
    | 'approveExact'
    | 'maxTxRetries'
    | 'minKeeperBalanceWei'
    | 'maxFeePerGas'
    | 'maxPriorityFeePerGas'
    | 'maxNativeSpentPerRun'
    | 'maxGasPerTx'
    | 'gasBufferPct'
  >;
  plan: RedeemPlan;
  hints: HintBundle;
  spendTracker?: { spent: bigint };
}): Promise<ExecuteRedeemResult> {
  const { publicClient, walletClient, config, plan, hints } = params;
  const spendTracker = params.spendTracker ?? { spent: 0n };

  if (!plan.ok) {
    return {
      ok: false,
      reason: 'TX_FAILED',
      message: `plan_not_ok:${plan.reason}`,
    };
  }

  const walletAccount: Account | Address | null = walletClient.account ?? null;
  const caller: Address | undefined =
    walletAccount && typeof walletAccount === 'object'
      ? (walletAccount as Account).address
      : (walletAccount as Address | null) ?? undefined;
  if (!caller) {
    throw new Error(
      'Missing fromAddress for non-dry-run execution; ensure a signer is configured.'
    );
  }
  const recipient: Address = plan.recipient;

  const emitJson = (event: string, data: Record<string, unknown>) =>
    log.jsonInfo(event, { component: 'executor', ...data });

  if (config.dryRun) {
    emitJson('job_skip', {
      reason: 'DRY_RUN',
      caller,
      recipient,
      requestedMusd: plan.requestedMusd.toString(),
      truncatedMusd: plan.truncatedMusd.toString(),
      effectiveMusd: plan.effectiveMusd.toString(),
    });
    return { ok: false, reason: 'DRY_RUN' };
  }

  const bufferPct = config.gasBufferPct ?? 0;
  const applyBuffer = (g: bigint) => (g * BigInt(100 + bufferPct)) / 100n;

  let feeInfo = await resolveFeeInfo({
    publicClient,
    config: {
      maxFeePerGas: config.maxFeePerGas,
      maxPriorityFeePerGas: config.maxPriorityFeePerGas,
    },
  });

  // Allowance check (+ optional approve).
  const allowance = (await publicClient.readContract({
    address: config.musd,
    abi: musdAbi,
    functionName: 'allowance',
    // IMPORTANT: allowance is for the caller (msg.sender), not the recipient.
    args: [caller, config.trovePilotEngine],
  } as const)) as unknown as bigint;

  if (allowance < plan.effectiveMusd) {
    emitJson('approve_needed', {
      musd: config.musd,
      caller,
      spender: config.trovePilotEngine,
      recipient,
      allowance: allowance.toString(),
      required: plan.effectiveMusd.toString(),
      autoApprove: config.autoApprove,
      approveExact: config.approveExact,
    });

    if (!config.autoApprove) {
      return { ok: false, reason: 'ALLOWANCE_REQUIRED' };
    }

    const approveAmount = config.approveExact
      ? plan.effectiveMusd
      : MAX_UINT256;
    // Best-effort approve gas estimate (do not gate on it; send with wallet defaults).
    let approveGas: bigint | undefined;
    try {
      const raw = await publicClient.estimateContractGas({
        address: config.musd,
        abi: musdAbi,
        functionName: 'approve',
        args: [config.trovePilotEngine, approveAmount],
        account: caller,
      });
      approveGas = applyBuffer(raw);
    } catch (err) {
      emitJson('approve_gas_unavailable', {
        errorType: classifyError(err).type,
        message: String(err),
      });
    }

    emitJson('approve_sent', {
      caller,
      recipient,
      amount: approveAmount.toString(),
      gas: approveGas?.toString(),
    });

    const approveTxArgs: Record<string, unknown> = {
      address: config.musd,
      abi: musdAbi,
      functionName: 'approve',
      args: [config.trovePilotEngine, approveAmount],
      account: caller,
      ...(approveGas ? { gas: approveGas } : {}),
    };
    const approveHash = (await walletClient.writeContract(
      approveTxArgs as any
    )) as `0x${string}`;

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });
    emitJson('approve_confirmed', {
      txHash: approveHash,
      status: approveReceipt.status,
      gasUsed: approveReceipt.gasUsed?.toString(),
      effectiveGasPrice: approveReceipt.effectiveGasPrice?.toString(),
    });
  }

  const readBalances = async (address: Address) => {
    const [musdBal, nativeBal] = await Promise.all([
      publicClient.readContract({
        address: config.musd,
        abi: musdAbi,
        functionName: 'balanceOf',
        args: [address],
      } as const) as unknown as bigint,
      publicClient.getBalance({ address }) as Promise<bigint>,
    ]);
    return { musdBal, nativeBal };
  };

  const [callerBefore, recipientBefore] = await Promise.all([
    readBalances(caller),
    recipient.toLowerCase() === caller.toLowerCase()
      ? Promise.resolve({ musdBal: 0n, nativeBal: 0n })
      : readBalances(recipient),
  ]);

  type PlanResult =
    | { ok: true; gasEstimate: bigint; estimatedCost?: bigint }
    | {
        ok: false;
        reason:
          | 'GAS_CAP'
          | 'SPEND_CAP'
          | 'FEE_UNAVAILABLE'
          | 'INSUFFICIENT_BALANCE'
          | 'ESTIMATE_REVERT';
      };

  const planTx = async (fee: FeeInfo): Promise<PlanResult> => {
    let rawGas: bigint;
    try {
      rawGas = await publicClient.estimateContractGas({
        address: config.trovePilotEngine,
        abi: trovePilotEngineAbi,
        functionName: 'redeemHintedTo',
        args: [
          plan.effectiveMusd,
          recipient,
          hints.firstHint,
          hints.upperHint,
          hints.lowerHint,
          hints.partialNICR,
          BigInt(plan.maxIterations),
        ],
        account: caller,
      } as const);
    } catch (err) {
      const c = classifyError(err);
      emitJson('job_plan_error', {
        reason: 'ESTIMATE_REVERT',
        errorType: c.type,
        message: c.message,
        caller,
        recipient,
      });
      return { ok: false, reason: 'ESTIMATE_REVERT' };
    }

    const gasEstimate = applyBuffer(rawGas);
    if (config.maxGasPerTx !== undefined && config.maxGasPerTx > 0n) {
      if (gasEstimate > config.maxGasPerTx) {
        emitJson('job_skip', {
          reason: 'GAS_CAP',
          caller,
          recipient,
          gasEstimate: gasEstimate.toString(),
          maxGasPerTx: config.maxGasPerTx.toString(),
        });
        return { ok: false, reason: 'GAS_CAP' };
      }
    }

    const feePerGas =
      fee.mode === 'eip1559'
        ? fee.maxFeePerGas
        : fee.mode === 'legacy'
        ? fee.gasPrice
        : undefined;
    const estimatedCost =
      feePerGas !== undefined ? gasEstimate * feePerGas : undefined;
    // Spend-cap gating (fail closed):
    // If a spend cap is enabled, we *only* proceed if projected cost is computable.
    if (
      config.maxNativeSpentPerRun !== undefined &&
      config.maxNativeSpentPerRun > 0n
    ) {
      if (estimatedCost === undefined) {
        emitJson('job_skip', {
          reason: 'FEE_UNAVAILABLE',
          caller,
          recipient,
          fee: buildFeeFields(fee),
        });
        return { ok: false, reason: 'FEE_UNAVAILABLE' };
      }
      if (spendTracker.spent + estimatedCost > config.maxNativeSpentPerRun) {
        emitJson('job_skip', {
          reason: 'SPEND_CAP',
          caller,
          recipient,
          projectedSpend: (spendTracker.spent + estimatedCost).toString(),
          cap: config.maxNativeSpentPerRun.toString(),
          fee: buildFeeFields(fee),
        });
        return { ok: false, reason: 'SPEND_CAP' };
      }
    }

    if (
      estimatedCost !== undefined ||
      config.minKeeperBalanceWei !== undefined
    ) {
      const balanceWei = await publicClient.getBalance({ address: caller });
      const minReq = config.minKeeperBalanceWei ?? 0n;
      const requiredForTx = estimatedCost ?? 0n;
      const required = requiredForTx > minReq ? requiredForTx : minReq;
      if (balanceWei < required) {
        emitJson('job_skip', {
          reason: 'INSUFFICIENT_BALANCE',
          caller,
          recipient,
          balanceWei: balanceWei.toString(),
          requiredWei: required.toString(),
          requiredForTxWei: estimatedCost?.toString(),
          minKeeperBalanceWei: config.minKeeperBalanceWei?.toString(),
          fee: buildFeeFields(fee),
        });
        return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
      }
    }

    emitJson('job_plan', {
      caller,
      recipient,
      gasEstimateRaw: rawGas.toString(),
      gasBuffered: gasEstimate.toString(),
      estimatedCost: estimatedCost?.toString(),
      estimatedCostKnown: estimatedCost !== undefined,
      maxGasPerTx: config.maxGasPerTx?.toString(),
      maxNativeSpentPerRun: config.maxNativeSpentPerRun?.toString(),
      fee: buildFeeFields(fee),
    });

    return { ok: true, gasEstimate, estimatedCost };
  };

  let initialPlan = await planTx(feeInfo);
  if (!initialPlan.ok) {
    return { ok: false, reason: initialPlan.reason as any };
  }
  // Keep gasEstimate in a separate variable (narrowing `initialPlan` through retries is awkward).
  let gasEstimate: bigint = initialPlan.gasEstimate;

  let attempt = 0;
  let lastClassified:
    | { type: ReturnType<typeof classifyError>['type']; message: string }
    | undefined;
  while (attempt <= (config.maxTxRetries ?? 0)) {
    try {
      if (attempt > 0) {
        const nextBackoffMs = computeBackoffMs(attempt);
        emitJson('retry_scheduled', {
          attempt,
          // TODO: remove backoffMs once downstream consumers migrate to nextBackoffMs
          backoffMs: nextBackoffMs,
          nextBackoffMs,
          replanPerformed: attempt === 1,
          reason: lastClassified?.type,
          message: lastClassified?.message,
          caller,
          recipient,
        });
        await sleepMs(nextBackoffMs);
        if (attempt === 1) {
          // Re-plan on attempt 1: refresh fee + gas estimate.
          feeInfo = await resolveFeeInfo({
            publicClient,
            config: {
              maxFeePerGas: config.maxFeePerGas,
              maxPriorityFeePerGas: config.maxPriorityFeePerGas,
            },
          });
          initialPlan = await planTx(feeInfo);
          if (!initialPlan.ok) {
            return { ok: false, reason: initialPlan.reason as any };
          }
          gasEstimate = initialPlan.gasEstimate;
        }
      }

      emitJson('tx_sent', {
        attemptNumber: attempt,
        caller,
        recipient,
        to: config.trovePilotEngine,
        functionName: 'redeemHintedTo',
        args: {
          musdAmount: plan.effectiveMusd.toString(),
          recipient,
          firstHint: hints.firstHint,
          upperHint: hints.upperHint,
          lowerHint: hints.lowerHint,
          partialNICR: hints.partialNICR.toString(),
          maxIter: String(plan.maxIterations),
        },
        fee: buildFeeFields(feeInfo),
        gas: gasEstimate.toString(),
      });

      // Fee override hygiene: never pass undefined fields (especially for EIP-1559).
      const feeOverrides: Record<string, unknown> = {};
      if (feeInfo.mode === 'eip1559') {
        if (feeInfo.maxFeePerGas !== undefined) {
          feeOverrides.maxFeePerGas = feeInfo.maxFeePerGas;
        }
        feeOverrides.maxPriorityFeePerGas = feeInfo.maxPriorityFeePerGas;
      } else if (feeInfo.mode === 'legacy') {
        feeOverrides.gasPrice = feeInfo.gasPrice;
      }

      const txArgs: Record<string, unknown> = {
        address: config.trovePilotEngine,
        abi: trovePilotEngineAbi,
        functionName: 'redeemHintedTo',
        args: [
          plan.effectiveMusd,
          recipient,
          hints.firstHint,
          hints.upperHint,
          hints.lowerHint,
          hints.partialNICR,
          BigInt(plan.maxIterations),
        ],
        account: caller,
        gas: gasEstimate,
        ...feeOverrides,
      };
      const txHash = (await walletClient.writeContract(
        txArgs as any
      )) as `0x${string}`;

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      emitJson('tx_confirmed', {
        txHash,
        status: receipt.status,
        gasUsed: receipt.gasUsed?.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
        blockNumber: receipt.blockNumber?.toString(),
      });

      if (receipt.status !== 'success') {
        return {
          ok: false,
          reason: 'TX_FAILED',
          message: 'receipt_status_failed',
        };
      }

      const [callerAfter, recipientAfter] = await Promise.all([
        readBalances(caller),
        recipient.toLowerCase() === caller.toLowerCase()
          ? Promise.resolve({ musdBal: 0n, nativeBal: 0n })
          : readBalances(recipient),
      ]);
      const callerBalances = {
        musdBefore: callerBefore.musdBal,
        musdAfter: callerAfter.musdBal,
        musdDelta: callerAfter.musdBal - callerBefore.musdBal,
        nativeBefore: callerBefore.nativeBal,
        nativeAfter: callerAfter.nativeBal,
        nativeDelta: callerAfter.nativeBal - callerBefore.nativeBal,
      };
      const recipientBalances =
        recipient.toLowerCase() === caller.toLowerCase()
          ? {
              musdBefore: callerBalances.musdBefore,
              musdAfter: callerBalances.musdAfter,
              musdDelta: callerBalances.musdDelta,
              nativeBefore: callerBalances.nativeBefore,
              nativeAfter: callerBalances.nativeAfter,
              nativeDelta: callerBalances.nativeDelta,
            }
          : {
              musdBefore: recipientBefore.musdBal,
              musdAfter: recipientAfter.musdBal,
              musdDelta: recipientAfter.musdBal - recipientBefore.musdBal,
              nativeBefore: recipientBefore.nativeBal,
              nativeAfter: recipientAfter.nativeBal,
              nativeDelta: recipientAfter.nativeBal - recipientBefore.nativeBal,
            };

      const spendWei =
        receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined
          ? (receipt.gasUsed as bigint) * (receipt.effectiveGasPrice as bigint)
          : undefined;
      if (spendWei !== undefined) {
        spendTracker.spent = (spendTracker.spent as bigint) + spendWei;
      }

      // Best-effort decode RedemptionExecuted event (from engine logs).
      let engineEvent: EngineRedemptionExecutedEvent | undefined;
      try {
        for (const l of receipt.logs ?? []) {
          if (
            (l.address ?? '').toLowerCase() !==
            config.trovePilotEngine.toLowerCase()
          )
            continue;
          try {
            const decoded = decodeEventLog({
              abi: trovePilotEngineAbi,
              data: l.data,
              topics: l.topics,
            });
            if (decoded.eventName === 'RedemptionExecuted') {
              const args = decoded.args as any;
              engineEvent = {
                jobId: args.jobId?.toString?.() ?? String(args.jobId),
                musdRequested:
                  args.musdRequested?.toString?.() ??
                  String(args.musdRequested),
                musdRedeemed:
                  args.musdRedeemed?.toString?.() ?? String(args.musdRedeemed),
                musdRefunded:
                  args.musdRefunded?.toString?.() ?? String(args.musdRefunded),
                collateralOut:
                  args.collateralOut?.toString?.() ??
                  String(args.collateralOut),
                maxIter: args.maxIter?.toString?.() ?? String(args.maxIter),
              };
              break;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      emitJson('redeem_result', {
        txHash,
        caller,
        recipient,
        requestedMusd: plan.requestedMusd.toString(),
        truncatedMusd: plan.truncatedMusd.toString(),
        effectiveMusd: plan.effectiveMusd.toString(),
        balances: {
          callerMusdDelta: callerBalances.musdDelta.toString(),
          recipientMusdDelta: recipientBalances.musdDelta.toString(),
          recipientNativeDelta: recipientBalances.nativeDelta.toString(),
        },
        engineEvent,
      });

      return {
        ok: true,
        txHash,
        receipt: {
          status: receipt.status,
          blockNumber: receipt.blockNumber?.toString(),
          gasUsed: receipt.gasUsed?.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
        },
        spendWei,
        caller,
        recipient,
        callerBalances,
        recipientBalances,
        engineEvent,
      };
    } catch (err) {
      const classified = classifyError(err);
      emitJson('tx_error', {
        attemptNumber: attempt,
        errorType: classified.type,
        message: classified.message,
        fee: buildFeeFields(feeInfo),
        caller,
        recipient,
      });
      lastClassified = classified;
      if (attempt >= (config.maxTxRetries ?? 0)) {
        return {
          ok: false,
          reason: 'TX_FAILED',
          errorType: classified.type,
          message: classified.message,
        };
      }
      attempt++;
      continue;
    }
    // success path returns above
  }

  return { ok: false, reason: 'TX_FAILED', message: 'unreachable' };
}
