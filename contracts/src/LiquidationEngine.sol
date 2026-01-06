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
    /// @param nativeReward  Native coin amount forwarded to keeper (delta of `address(this).balance`).
    /// @param musdReward    MUSD amount forwarded to keeper (delta of `MUSD.balanceOf(address(this))`).
    event LiquidationExecuted(
        uint256 indexed jobId,
        address indexed keeper,
        uint256 attempted,
        uint256 succeeded,
        bool fallbackUsed,
        uint256 nativeReward,
        uint256 musdReward
    );

    /// @notice Emitted when funds are swept out of the contract.
    /// @param caller    Address that initiated the sweep (owner).
    /// @param token     Token swept; address(0) for native.
    /// @param amount    Amount transferred.
    /// @param recipient Destination receiving the swept funds.
    event SweepExecuted(address indexed caller, address indexed token, uint256 amount, address indexed recipient);

    /// @notice TroveManager proxy used for liquidations.
    ITroveManager public immutable TROVE_MANAGER;

    /// @notice MUSD token used for keeper gas compensation during liquidations.
    /// @dev Mezo liquidations can credit MUSD gas compensation to `msg.sender`.
    /// Since this engine is the `msg.sender` for TroveManager calls, any MUSD gas comp
    /// is first credited to this contract and then forwarded to the keeper.
    IERC20 public immutable MUSD;

    /// @notice Monotonic identifier for off-chain indexing.
    uint256 public jobId;

    /// @param _troveManager TroveManager proxy address.
    /// @param _musd MUSD token address (ERC-20).
    constructor(address _troveManager, address _musd) Ownable(msg.sender) {
        require(_troveManager != address(0), Errors.ZeroAddress());
        require(_musd != address(0), Errors.ZeroAddress());
        TROVE_MANAGER = ITroveManager(_troveManager);
        MUSD = IERC20(_musd);
    }

    /// @notice Execute liquidations against provided borrowers.
    /// @dev Deterministic behavior:
    ///      - If `fallbackOnFail` is false, only `batchLiquidate` is attempted and will bubble the revert.
    ///      - If `fallbackOnFail` is true, try `batchLiquidate`; on revert attempt single `liquidate` per borrower
    /// once.
    /// @param borrowers List of troves to liquidate.
    /// @param fallbackOnFail Whether to fall back to per-borrower loop if batch reverts.
    /// @return succeeded Number of successful liquidations.
    function liquidateRange(address[] calldata borrowers, bool fallbackOnFail)
        external
        nonReentrant
        returns (uint256 succeeded)
    {
        // Rewards are observed as deltas on this contract, then forwarded to the keeper.
        // Native deltas capture Mezo native refunds/rewards routed to this engine.
        uint256 balanceBefore = address(this).balance;
        // MUSD deltas capture Mezo gas compensation credited to the liquidator (this engine).
        uint256 musdBefore = MUSD.balanceOf(address(this));
        uint256 len = borrowers.length;
        require(len > 0, Errors.EmptyArray());

        bool fallbackUsed = false;
        bool batchSuccess = true;

        if (!fallbackOnFail) {
            TROVE_MANAGER.batchLiquidate(borrowers);
            succeeded = len;
        } else {
            try TROVE_MANAGER.batchLiquidate(borrowers) {
                succeeded = len;
            } catch {
                batchSuccess = false;
                fallbackUsed = true;
            }

            if (!batchSuccess) {
                for (uint256 i = 0; i < len; ++i) {
                    try TROVE_MANAGER.liquidate(borrowers[i]) {
                        unchecked {
                            ++succeeded;
                        }
                    } catch { }
                }
            }
        }

        uint256 musdAfter = MUSD.balanceOf(address(this));
        uint256 musdReward = 0;
        if (musdAfter > musdBefore) {
            unchecked {
                musdReward = musdAfter - musdBefore;
            }
            // Forward MUSD gas compensation to the keeper in the same tx (no claim step).
            MUSD.safeTransfer(msg.sender, musdReward);
        }

        uint256 balanceAfter = address(this).balance;
        uint256 nativeReward = 0;
        if (balanceAfter > balanceBefore) {
            unchecked {
                nativeReward = balanceAfter - balanceBefore;
            }
            (bool ok,) = msg.sender.call{ value: nativeReward }("");
            if (!ok) revert Errors.RewardPayoutFailed();
        }

        emit LiquidationExecuted(++jobId, msg.sender, len, succeeded, fallbackUsed, nativeReward, musdReward);
    }

    /// @notice Emergency escape hatch. Should never be required during normal operation.
    /// @dev Sweeps full balance of a token or native coin to `_recipient`.
    /// @param _token Address of token to sweep; use address(0) for native coin.
    /// @param _recipient Recipient of the swept balance.
    function sweep(address _token, address _recipient) external onlyOwner nonReentrant {
        require(_recipient != address(0), Errors.ZeroAddress());

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
