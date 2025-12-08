// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title TrovePilot Errors
/// @notice Centralized custom errors shared across TrovePilot contracts.
/// @dev Keeps contract bytecode small and ensures consistency across modules.
library Errors {
    /// @notice Reverts when a zero address is provided where non-zero is required.
    error ZeroAddress();

    /// @notice Reverts when an expected non-zero amount is zero.
    error ZeroAmount();

    /// @notice Reverts when a supplied array is empty.
    error EmptyArray();

    /// @notice Reverts when HintHelpers returns a truncated amount
    /// that does not match caller-supplied musdAmount.
    error TruncatedMismatch(uint256 expected);

    /// @notice Reverts when a native token transfer fails.
    error NativeTransferFailed();

    /// @notice Reverts when liquidation reward cannot be forwarded.
    error RewardPayoutFailed();
}
