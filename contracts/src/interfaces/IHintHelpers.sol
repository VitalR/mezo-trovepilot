// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IHintHelpers (Mezo)
/// @notice Helper for computing redemption hints used in Mezo redemptions.
interface IHintHelpers {
    /// @notice Compute redemption hints for a given amount and price.
    /// @return firstRedemptionHint Trove to start from.
    /// @return partialRedemptionHintNICR NICR to use for partial redemption insertion.
    /// @return truncatedMUSDamount Potentially truncated amount redeemable.
    function getRedemptionHints(uint256 _MUSDamount, uint256 _price, uint256 _maxIterations)
        external
        view
        returns (address firstRedemptionHint, uint256 partialRedemptionHintNICR, uint256 truncatedMUSDamount);
}
