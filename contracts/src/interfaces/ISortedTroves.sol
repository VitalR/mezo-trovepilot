// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ISortedTroves (Mezo)
/// @notice Sorted linked list of troves keyed by NICR.
interface ISortedTroves {
    /// @notice Find insert position for a target NICR.
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address upperHint, address lowerHint);
}
