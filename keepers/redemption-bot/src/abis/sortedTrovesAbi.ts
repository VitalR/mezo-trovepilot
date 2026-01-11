export const sortedTrovesAbi = [
  {
    type: 'function',
    name: 'findInsertPosition',
    stateMutability: 'view',
    inputs: [
      { name: '_NICR', type: 'uint256' },
      { name: '_prevId', type: 'address' },
      { name: '_nextId', type: 'address' },
    ],
    outputs: [
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'getLast',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getPrev',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getNext',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
