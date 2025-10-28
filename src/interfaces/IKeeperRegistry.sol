// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IKeeperRegistry (subset)
/// @notice Minimal interface to interact with KeeperRegistry from LiquidationBatcher
interface IKeeperRegistry {
    /// @notice Public getter for keeper profiles
    /// @return listed Whether keeper is listed
    /// @return score  Current score
    /// @return payTo  Optional payout override address
    function keepers(address keeper) external view returns (bool listed, uint96 score, address payTo);

    /// @notice Increment a keeper's score (authorized callers only in the registry)
    function bumpScore(address _keeper, uint96 _add) external;
}
