// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ITroveManager (subset used by TrovePilot)
/// @notice Minimal interface for Mezo MUSD TroveManager calls used by liquidation/redemption wrappers.
/// @dev
/// - Function signatures match the Mezo docs; verify against the current deployed ABIs on Mezo Testnet/Mainnet.
/// - `redeemCollateral` parameters (hints/iterations) follow the docs' "Option A/B" patterns.
interface ITroveManager {
    /// @notice Liquidate a single trove by borrower address.
    /// @dev Permissionless. Caller receives protocol-defined incentives (e.g., gas deposit in MUSD + % collateral).
    function liquidate(address _borrower) external;

    /// @notice Batch-liquidate many troves in one call.
    /// @dev May revert if any provided trove is not liquidatable at current price; TrovePilot fallbacks per-trove when
    /// needed.
    function batchLiquidate(address[] calldata _borrowers) external;

    /// @notice Redeem MUSD for collateral from lowest ICR troves (ascending) using provided hints.
    /// @dev
    /// - The hint parameters reduce gas by narrowing the search and specifying partial positions.
    /// - `_maxIterations` bounds how many troves to traverse for this redemption.
    function redeemCollateral(
        uint256 _MUSDamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint256 _partialRedemptionHintNICR,
        uint256 _maxIterations
    ) external;
}
