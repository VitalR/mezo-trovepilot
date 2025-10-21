// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IHintHelpers (subset)
/// @notice Helper contract for computing redemption hints and NICR values.
/// @dev Use to pre-compute `firstRedemptionHint` and `partialRedemptionHintNICR` off/on chain.
interface IHintHelpers {
    /// @notice Compute redemption hints for a given MUSD redemption amount and price.
    /// @param _MUSDamount Total MUSD to redeem.
    /// @param _price      System price (same price source TroveManager uses).
    /// @param _maxIterations Upper bound on troves to traverse while computing the hint.
    /// @return firstRedemptionHint Trove address to start redeeming from.
    /// @return partialRedemptionHintNICR Target NICR if the last trove is partially redeemed.
    /// @return truncatedMUSDamount Possibly reduced MUSD amount if hints indicate an earlier stop.
    function getRedemptionHints(uint256 _MUSDamount, uint256 _price, uint256 _maxIterations)
        external
        view
        returns (address firstRedemptionHint, uint256 partialRedemptionHintNICR, uint256 truncatedMUSDamount);
}
