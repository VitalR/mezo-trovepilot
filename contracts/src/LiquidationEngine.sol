// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { Errors } from "./utils/Errors.sol";

/// @title TrovePilot LiquidationEngine
/// @notice Minimal, permissionless liquidation executor for Mezo troves with deterministic fallback behavior.
/// @dev Stateless aside from a monotonic `jobId`. No fees, no governance, no scoring.
///      Spec reference: docs/CONTRACTS_V2.md (LiquidationEngine).
/// @custom:invariant Only state is `jobId`; no custodial balances should remain post-sweep.
contract LiquidationEngine is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted after a liquidation attempt completes.
    /// @param jobId         Monotonic identifier for off-chain indexing.
    /// @param keeper        Original caller of the engine.
    /// @param attempted     Number of troves attempted.
    /// @param succeeded     Number of successful liquidations.
    /// @param fallbackUsed  True if batch failed and per-borrower fallback was attempted.
    event LiquidationExecuted(
        uint256 indexed jobId, address indexed keeper, uint256 attempted, uint256 succeeded, bool fallbackUsed
    );

    /// @notice Emitted when funds are swept out of the contract.
    /// @param caller    Address that initiated the sweep (owner).
    /// @param token     Token swept; address(0) for native.
    /// @param amount    Amount transferred.
    /// @param recipient Destination receiving the swept funds.
    event SweepExecuted(address indexed caller, address indexed token, uint256 amount, address indexed recipient);

    /// @notice TroveManager proxy used for liquidations.
    ITroveManager public immutable troveManager;

    /// @notice Monotonic identifier for off-chain indexing.
    uint256 public jobId;

    /// @param _troveManager TroveManager proxy address.
    constructor(address _troveManager) Ownable(msg.sender) {
        if (_troveManager == address(0)) revert Errors.ZeroAddress();
        troveManager = ITroveManager(_troveManager);
    }

    /// @notice Execute liquidations against provided borrowers.
    /// @dev Deterministic behavior:
    ///      - If `fallbackOnFail` is false, only `batchLiquidate` is attempted and will bubble the revert.
    ///      - If `fallbackOnFail` is true, try `batchLiquidate`; on revert attempt single `liquidate` per borrower
    /// once. @param borrowers List of troves to liquidate.
    /// @param fallbackOnFail Whether to fall back to per-borrower loop if batch reverts.
    /// @return succeeded Number of successful liquidations.
    function liquidateRange(address[] calldata borrowers, bool fallbackOnFail)
        external
        nonReentrant
        returns (uint256 succeeded)
    {
        uint256 balanceBefore = address(this).balance;
        uint256 len = borrowers.length;
        require(len > 0, Errors.EmptyArray());

        bool fallbackUsed = false;
        bool batchSuccess = true;

        if (!fallbackOnFail) {
            troveManager.batchLiquidate(borrowers);
            succeeded = len;
        } else {
            try troveManager.batchLiquidate(borrowers) {
                succeeded = len;
            } catch {
                batchSuccess = false;
                fallbackUsed = true;
            }

            if (!batchSuccess) {
                for (uint256 i = 0; i < len; ++i) {
                    try troveManager.liquidate(borrowers[i]) {
                        unchecked {
                            ++succeeded;
                        }
                    } catch { }
                }
            }
        }

        uint256 balanceAfter = address(this).balance;
        if (balanceAfter > balanceBefore) {
            uint256 reward = balanceAfter - balanceBefore;
            (bool ok,) = msg.sender.call{ value: reward }("");
            if (!ok) revert Errors.RewardPayoutFailed();
        }

        emit LiquidationExecuted(++jobId, msg.sender, len, succeeded, fallbackUsed);
    }

    /// @notice Emergency escape hatch. Should never be required during normal operation.
    /// @dev Sweeps full balance of a token or native coin to `_recipient`.
    /// @param _token Address of token to sweep; use address(0) for native coin.
    /// @param _recipient Recipient of the swept balance.
    function sweep(address _token, address _recipient) external onlyOwner nonReentrant {
        if (_recipient == address(0)) revert Errors.ZeroAddress();

        if (_token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal != 0) {
                (bool ok,) = payable(_recipient).call{ value: bal }("");
                if (!ok) revert Errors.NativeTransferFailed();
                emit SweepExecuted(msg.sender, _token, bal, _recipient);
            }
            return;
        }

        uint256 balErc = IERC20(_token).balanceOf(address(this));
        if (balErc != 0) {
            IERC20(_token).safeTransfer(_recipient, balErc);
            emit SweepExecuted(msg.sender, _token, balErc, _recipient);
        }
    }

    /// @notice Accept native refunds routed back from Mezo liquidations.
    receive() external payable { }
}
