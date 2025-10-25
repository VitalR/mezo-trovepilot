// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ITroveManager } from "./interfaces/ITroveManager.sol";

/// @title TrovePilot: LiquidationBatcher
/// @notice Gas-efficient, permissionless wrapper to execute Mezo MUSD trove liquidations in batches and forward
/// rewards. @dev
/// - Wraps `TroveManager.batchLiquidate` and falls back to per-trove `liquidate` loop if needed.
/// - Forwards protocol rewards (e.g., 200 MUSD gas deposit + 0.5% collateral to liquidator) to the caller, minus
/// optional fee. - Designed to be called by anyone (humans or bots). No privileged keeper is required.
/// - Uses a minimal "owner" for parameter updates (fee, sinks, registry); no proxy pattern here.
contract LiquidationBatcher is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================
    //                      EVENTS & ERRORS
    // =============================================================

    /// @notice Emitted after a batch liquidation attempt.
    /// @param keeper   The caller/keeper that triggered the batch.
    /// @param attempted Number of troves attempted.
    /// @param executed  Number of troves successfully liquidated.
    /// @param gasUsed   Gas delta measured inside function (approximate).
    event BatchExecuted(address indexed keeper, uint256 attempted, uint256 executed, uint256 gasUsed);

    /// @notice Emitted when rewards are forwarded to the keeper.
    /// @param keeper  Destination that received rewards.
    /// @param nativeOut Native (BTC-as-gas) forwarded amount.
    /// @param musdOut  MUSD forwarded amount.
    /// @param feeBps   Protocol fee basis points in effect for this transfer.
    event RewardsForwarded(address indexed keeper, uint256 nativeOut, uint256 musdOut, uint16 feeBps);

    /// @notice Emitted when fee sink is updated.
    event FeeSinkUpdated(address indexed oldSink, address indexed newSink);

    /// @notice Emitted when fee BPS is updated.
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);

    /// @notice Emitted when MUSD token address is updated (used to forward MUSD gas deposit).
    event MusdTokenUpdated(address indexed oldAddr, address indexed newAddr);

    /// @notice Emitted when KeeperRegistry is updated.
    event KeeperRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    /// @dev Thrown when input arrays are empty.
    error EmptyInput();
    /// @dev Thrown when attempting to set an invalid fee (basis points > 10_000).
    error InvalidFeeBps();
    /// @dev Thrown when no reward assets are available to forward.
    error NothingToForward();
    /// @dev Thrown when a provided address is zero.
    error ZeroAddress();

    // =============================================================
    //                   IMMUTABLES & STORAGE
    // =============================================================

    /// @notice TroveManager contract used by the MUSD protocol.
    ITroveManager public immutable troveManager;

    /// @notice Optional ERC-20 address for MUSD to forward the gas deposit (if credited to this contract).
    address public musd;

    /// @notice Optional registry to record keeper activity (score/rewards) in future versions.
    address public keeperRegistry;

    /// @notice Address receiving protocol fees (if any).
    address public feeSink;

    /// @notice Protocol fee in basis points (1 bps = 0.01%). 0–10_000 (100%).
    uint16 public feeBps;

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /// @param _tm TroveManager address (proxy) from Mezo docs.
    /// @param _owner Owner address for admin actions (fee updates & sinks).
    /// @param _feeSink Initial fee sink (may be zero to disable).
    /// @param _feeBps Initial fee in basis points.
    constructor(address _tm, address _owner, address _feeSink, uint16 _feeBps) Ownable(_owner) {
        if (_tm == address(0)) revert ZeroAddress();
        if (_feeBps > 10_000) revert InvalidFeeBps();
        troveManager = ITroveManager(_tm);
        feeSink = _feeSink;
        feeBps = _feeBps;
    }

    // =============================================================
    //                        ADMIN ACTIONS
    // =============================================================

    /// @notice Set/adjust protocol fee BPS.
    /// @param _feeBps New fee in basis points (0–10_000).
    function setFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > 10_000) revert InvalidFeeBps();
        emit FeeBpsUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    /// @notice Set fee sink address receiving protocol fee.
    /// @param _feeSink New sink (zero disables native fee forwarding).
    function setFeeSink(address _feeSink) external onlyOwner {
        emit FeeSinkUpdated(feeSink, _feeSink);
        feeSink = _feeSink;
    }

    /// @notice Set MUSD token address to forward MUSD gas deposit to the keeper.
    /// @param _musd MUSD ERC-20 address (proxy).
    function setMusd(address _musd) external onlyOwner {
        emit MusdTokenUpdated(musd, _musd);
        musd = _musd;
    }

    /// @notice Set KeeperRegistry (optional; reserved for future scoring/incentives).
    function setKeeperRegistry(address _registry) external onlyOwner {
        emit KeeperRegistryUpdated(keeperRegistry, _registry);
        keeperRegistry = _registry;
    }

    // =============================================================
    //                     LIQUIDATION EXECUTION
    // =============================================================

    /// @notice Liquidate many troves in a single transaction (best-effort).
    /// @dev
    /// - Attempts `TroveManager.batchLiquidate` first (gas efficient).
    /// - If it reverts, falls back to per-trove `liquidate` loop (skips failures).
    /// - Forwards any native/MUSD rewards accrued to `msg.sender` (minus protocol fee).
    /// @param troves   Borrower addresses targeted for liquidation.
    /// @param maxCount Optional cap (0 = use full array).
    /// @return executed Number of successful liquidations.
    function batchLiquidate(address[] calldata troves, uint256 maxCount)
        external
        nonReentrant
        returns (uint256 executed)
    {
        uint256 startGas = gasleft();
        uint256 n = troves.length;
        if (n == 0) revert EmptyInput();
        if (maxCount != 0 && maxCount < n) n = maxCount;

        // Try batch; fall back to per-trove loop if batch reverts
        try troveManager.batchLiquidate(_slice(troves, n)) {
            executed = n;
        } catch {
            for (uint256 i; i < n; ++i) {
                // Each try-catch prevents a single failure from reverting the whole loop
                try troveManager.liquidate(troves[i]) {
                    unchecked {
                        ++executed;
                    }
                } catch { /* skip non-liquidatable */ }
            }
        }

        emit BatchExecuted(msg.sender, n, executed, startGas - gasleft());
        _forwardRewards(msg.sender);
    }

    // =============================================================
    //                      REWARD FORWARDING
    // =============================================================

    /// @dev Forward any native and MUSD rewards held by this contract to `to`, minus protocol fee.
    function _forwardRewards(address _to) internal {
        if (_to == address(0)) revert ZeroAddress();

        // ---- Native (BTC-as-gas) ----
        uint256 nativeBal = address(this).balance;
        if (nativeBal > 0) {
            uint256 feeNative = feeSink == address(0) ? 0 : (nativeBal * feeBps) / 10_000;
            if (feeNative != 0) {
                (bool okFee,) = feeSink.call{ value: feeNative }("");
                okFee; // ignore
            }
            uint256 toSend = nativeBal - feeNative;
            if (toSend != 0) {
                (bool ok,) = _to.call{ value: toSend }("");
                ok; // ignore
            }
            nativeNet = nativeBal - feeNative;
        }

        // ---- MUSD (gas deposit) ----
        uint256 musdOut;
        if (musd != address(0)) {
            IERC20 M = IERC20(musd);
            uint256 bal = M.balanceOf(address(this));
            if (bal > 0) {
                uint256 feeMusd = feeSink == address(0) ? 0 : (bal * feeBps) / 10_000;
                if (feeMusd != 0) M.safeTransfer(feeSink, feeMusd);
                musdOut = bal - feeMusd;
                if (musdOut != 0) M.safeTransfer(_to, musdOut);
            }
        }

        if (nativeBal == 0 && musdOut == 0) {
            emit RewardsForwarded(_to, 0, 0, feeBps);
            return;
        }
        emit RewardsForwarded(_to, nativeBal, musdOut, feeBps);
    }

    // =============================================================
    //                         INTERNAL UTIL
    // =============================================================

    /// @dev Return a calldata slice `[0..n)`.
    function _slice(address[] calldata _a, uint256 _n) internal pure returns (address[] calldata b) {
        assembly {
            b.offset := _a.offset
            b.length := _n
        }
    }

    // =============================================================
    //                          RECEIVE
    // =============================================================

    /// @notice Accept native rewards routed back by the protocol.
    receive() external payable { }
}
