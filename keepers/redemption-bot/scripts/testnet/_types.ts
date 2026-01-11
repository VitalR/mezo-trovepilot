import { Address } from 'viem';

export type TestnetStateV1 = {
  version: 1;
  network: string;
  chainId: number;
  createdAtMs: number;
  updatedAtMs: number;

  /**
   * Script-level actors for deterministic verification.
   * - caller: tx signer / msg.sender
   * - recipient: engine payout/refund receiver
   */
  actors?: {
    caller: Address;
    recipient: Address;
  };

  addresses: {
    trovePilotEngine: Address;
    hintHelpers: Address;
    sortedTroves: Address;
    priceFeed: Address;
    musd: Address;
  };

  keeper?: {
    address: Address;
  };

  quote?: {
    attemptedAtMs: number;
    caller?: Address;
    recipient?: Address;
    requestedMusd: string;
    truncatedMusd: string;
    effectiveMusd: string;
    maxIterations: number;
    strictTruncation: boolean;
    maxChunkMusd?: string;
    priceE18: string;
    hints: {
      firstHint: Address;
      partialNICR: string;
      upperHint: Address;
      lowerHint: Address;
      upperSeed: Address;
      lowerSeed: Address;
      derivedSeeds: boolean;
      scannedTail?: Address[];
      insertHintsComputed?: boolean;
    };
    calldata: {
      musdAmount: string;
      recipient: Address;
      firstHint: Address;
      upperHint: Address;
      lowerHint: Address;
      partialNICR: string;
      maxIter: string;
    };
  };

  allowance?: {
    checkedAtMs: number;
    caller?: Address;
    owner: Address;
    spender: Address;
    allowanceWei: string;
    requiredWei: string;
    approveTxHash?: `0x${string}`;
    approveConfirmed?: boolean;
    receipt?: {
      status?: string;
      blockNumber?: string;
      gasUsed?: string;
      effectiveGasPrice?: string;
    };
  };

  redeemOnce?: {
    attemptedAtMs: number;
    dryRun: boolean;
    txHash?: `0x${string}`;
    txConfirmed?: boolean;
    receipt?: {
      status?: string;
      blockNumber?: string;
      gasUsed?: string;
      effectiveGasPrice?: string;
    };
    caller?: Address;
    recipient: Address;
    recipientMusdBefore?: string;
    recipientMusdAfter?: string;
    recipientMusdDelta?: string;
    recipientNativeBefore?: string;
    recipientNativeAfter?: string;
    recipientNativeDelta?: string;
    engineEvent?: Record<string, unknown>;
  };
};
