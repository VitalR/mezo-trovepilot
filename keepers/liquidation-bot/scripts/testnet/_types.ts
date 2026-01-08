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
    liquidationEngine: Address;
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
