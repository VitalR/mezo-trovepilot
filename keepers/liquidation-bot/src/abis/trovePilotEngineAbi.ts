export const trovePilotEngineAbi = [
  {
    type: 'function',
    name: 'jobId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'TROVE_MANAGER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'MUSD',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'liquidateSingle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_borrower', type: 'address' },
      { name: '_recipient', type: 'address' },
    ],
    outputs: [{ name: 'succeeded', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidateBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_borrowers', type: 'address[]' },
      { name: '_recipient', type: 'address' },
    ],
    outputs: [{ name: 'succeeded', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeemHintedTo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_musdAmount', type: 'uint256' },
      { name: '_recipient', type: 'address' },
      { name: '_firstHint', type: 'address' },
      { name: '_upperHint', type: 'address' },
      { name: '_lowerHint', type: 'address' },
      { name: '_partialNICR', type: 'uint256' },
      { name: '_maxIter', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sweep',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;
