// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ISortedTroves (subset)
/// @notice Sorted linked-list of Troves keyed by NICR/ICR used to compute insertion hints.
/// @dev Used only to derive `upperHint`/`lowerHint` for partial redemption insertion.
interface ISortedTroves {
    /// @notice Find insert position for a given NICR around (prev,next) guesses.
    /// @param _NICR   Nominal ICR target to position.
    /// @param _prevId Candidate upper neighbor.
    /// @param _nextId Candidate lower neighbor.
    /// @return upperHint Final upper neighbor.
    /// @return lowerHint Final lower neighbor.
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address upperHint, address lowerHint);
}
