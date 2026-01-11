export const hintHelpersAbi = [
  {
    type: 'function',
    name: 'getRedemptionHints',
    stateMutability: 'view',
    inputs: [
      { name: '_MUSDamount', type: 'uint256' },
      { name: '_price', type: 'uint256' },
      { name: '_maxIterations', type: 'uint256' },
    ],
    outputs: [
      { name: 'firstRedemptionHint', type: 'address' },
      { name: 'partialRedemptionHintNICR', type: 'uint256' },
      { name: 'truncatedMUSDamount', type: 'uint256' },
    ],
  },
] as const;
