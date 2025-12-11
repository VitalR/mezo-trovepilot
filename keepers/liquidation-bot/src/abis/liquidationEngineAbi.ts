export const liquidationEngineAbi = [
  {
    type: 'function',
    name: 'liquidateRange',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'borrowers', type: 'address[]' },
      { name: 'fallbackOnFail', type: 'bool' },
    ],
    outputs: [{ name: 'succeeded', type: 'uint256' }],
  },
] as const;
