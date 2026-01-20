export const troveManagerAbi = [
  {
    type: 'function',
    name: 'getCurrentICR',
    stateMutability: 'view',
    inputs: [
      { name: '_borrower', type: 'address' },
      { name: '_price', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidate',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'batchLiquidateTroves',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_borrowers', type: 'address[]' }],
    outputs: [],
  },
] as const;
