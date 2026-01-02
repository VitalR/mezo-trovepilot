// Minimal ABIs for testnet scripts.
//
// We intentionally keep these narrow to avoid importing large artifacts and
// to minimize risk of schema drift. If a call reverts due to ABI mismatch,
// the script will fail loudly with a clear message.

export const borrowerOperationsAbi = [
  {
    type: 'function',
    name: 'openTrove',
    stateMutability: 'payable',
    inputs: [
      { name: '_debtAmount', type: 'uint256' },
      { name: '_upperHint', type: 'address' },
      { name: '_lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getBorrowingFee',
    stateMutability: 'view',
    inputs: [{ name: '_debt', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const sortedTrovesHintsAbi = [
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
    inputs: [{ name: '_id', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export const hintHelpersAbi = [
  {
    type: 'function',
    name: 'getApproxHint',
    stateMutability: 'view',
    inputs: [
      { name: '_CR', type: 'uint256' },
      { name: '_numTrials', type: 'uint256' },
      { name: '_inputRandomSeed', type: 'uint256' },
    ],
    outputs: [
      { name: 'hintAddress', type: 'address' },
      { name: 'diff', type: 'uint256' },
      { name: 'latestRandomSeed', type: 'uint256' },
    ],
  },
] as const;

export const troveManagerExtraAbi = [
  {
    type: 'function',
    name: 'MUSD_GAS_COMPENSATION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTroveStatus',
    stateMutability: 'view',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Event surface for post-state verification.
export const liquidationEngineEventsAbi = [
  {
    type: 'event',
    name: 'LiquidationExecuted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'keeper', type: 'address', indexed: true },
      { name: 'attempted', type: 'uint256', indexed: false },
      { name: 'succeeded', type: 'uint256', indexed: false },
      { name: 'fallbackUsed', type: 'bool', indexed: false },
    ],
    anonymous: false,
  },
] as const;
