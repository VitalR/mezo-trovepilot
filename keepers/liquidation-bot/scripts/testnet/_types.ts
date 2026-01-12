import { Address } from 'viem';

export type TestnetStateV1 = {
  version: 1;
  network: string;
  chainId: number;
  createdAtMs: number;
  updatedAtMs: number;

  addresses: {
    troveManager: Address;
    sortedTroves: Address;
    priceFeed: Address;
    borrowerOperations: Address;
    /**
     * Canonical unified wrapper address (TrovePilotEngine).
     * If missing, scripts should fall back to legacy `liquidationEngine`.
     */
    trovePilotEngine?: Address;
    /**
     * Deprecated legacy name (previous LiquidationEngine address field).
     * Kept for backwards compatibility with older state files.
     */
    liquidationEngine?: Address;
    redemptionRouter?: Address;
  };

  keeper?: {
    address: Address;
  };

  trove?: {
    owner: Address;
    collateralBtc: string;
    collateralWei: string;
    targetIcr: string;
    debtAmountWei: string;
    gasCompensationWei?: string;
    expectedFeeWei?: string;
    expectedTotalDebtWei?: string;
    nicrE20?: string;
    approxHint?: Address;
    gasDepositWei?: string;
    borrowingFeeRateE18?: string;
    txHash?: `0x${string}`;
    priceAtOpen?: string;
    icrAtOpen?: string;
  };

  keeperRunOnce?: {
    attemptedAtMs: number;
    dryRun: boolean;
    forceBorrower?: Address;
    forceBorrowers?: Address[];
    /**
     * Strict batch mode flag for FORCE_BORROWERS runs.
     * When true, the script should either execute exactly one full-length batch tx
     * or exit with `skipReason` and no tx.
     */
    strictBatch?: boolean;
    /**
     * FORCE_BORROWERS parsed list (original order).
     * Stored to help debug strict batch skips.
     */
    requestedBorrowers?: Address[];
    /**
     * Borrowers considered liquidatable at the time of precheck.
     */
    liquidatableBorrowers?: Address[];
    /**
     * If strict batch selected an alternate working order, this stores the chosen list.
     */
    chosenBatchBorrowers?: Address[];
    /**
     * Reason code when the run intentionally skipped without sending a tx.
     */
    skipReason?: string;
    /**
     * Optional structured context describing why we skipped (best-effort).
     * This may include derived executor skip reasons, cap values, etc.
     */
    skipReasonDetails?: Record<string, unknown>;
    maxToScan?: number;
    processedBorrowers?: Address[];
    leftoverBorrowers?: Address[];
    txHash?: `0x${string}`;
    txConfirmed?: boolean;
    receipt?: {
      status?: string;
      blockNumber?: string;
      gasUsed?: string;
      effectiveGasPrice?: string;
      transactionIndex?: number;
    };
    balanceBeforeWei?: string;
    balanceAfterWei?: string;
    balanceDeltaWei?: string;
  };
};
