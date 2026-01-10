// Deprecated: kept for backwards compatibility with older deployments/scripts.
// New code should import `trovePilotEngineAbi`.
export const liquidationEngineAbi = [
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
] as const;
