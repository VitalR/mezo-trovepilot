// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { IKeeperRegistry } from "./interfaces/IKeeperRegistry.sol";

/// @title TrovePilot: LiquidationEngine
/// @notice Strategy-oriented, permissionless liquidation executor for Mezo troves with partial ranges, retries,
///         and on-chain job indexing.
/// @dev Replaces LiquidationBatcher. Backwards-compatible reward forwarding and keeper scoring.
contract LiquidationEngine is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================
    //                      EVENTS & ERRORS
    // =============================================================

    /// @notice Emitted after a liquidation job is recorded.
    /// @param jobId     Monotonic job id assigned by the engine.
    /// @param keeper    Caller (keeper) who ran the job.
    /// @param attempted Number of troves attempted in this job.
    /// @param executed  Number of successful liquidations.
    /// @param gasUsed   Approximate gas delta observed inside the function.
    event JobRecorded(
        uint256 indexed jobId, address indexed keeper, uint256 attempted, uint256 executed, uint256 gasUsed
    );

    /// @notice Emitted when rewards are forwarded.
    event RewardsForwarded(address indexed keeperOrPayTo, uint256 nativeOut, uint256 musdOut, uint16 feeBps);

    /// @notice Emitted on parameter updates.
    event FeeSinkUpdated(address indexed oldSink, address indexed newSink);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event MusdTokenUpdated(address indexed oldAddr, address indexed newAddr);
    event KeeperRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event PointsPerLiquidationUpdated(uint96 oldPoints, uint96 newPoints);

    error EmptyInput();
    error InvalidFeeBps();
    error ZeroAddress();

    // =============================================================
    //                   IMMUTABLES & STORAGE
    // =============================================================

    /// @notice TroveManager used for liquidations.
    ITroveManager public immutable troveManager;

    /// @notice Optional ERC-20 MUSD for forwarding gas deposit to keepers.
    address public musd;

    /// @notice Optional KeeperRegistry for scoring and payout overrides.
    address public keeperRegistry;

    /// @notice Protocol fee sink and BPS.
    address public feeSink;
    /// @notice Protocol fee in basis points (1 bps = 0.01%). 0–10_000 (100%).
    uint16 public feeBps;

    /// @notice Points awarded per successful liquidation to the caller in KeeperRegistry.
    uint96 public pointsPerLiquidation;

    /// @notice Monotonic job counter for on-chain indexing.
    uint256 public jobCounter;

    /// @notice Summary of a recorded job.
    struct JobSummary {
        address keeper;
        uint64 attempted;
        uint64 executed;
        uint64 timestamp;
        uint256 gasUsed;
    }

    /// @notice Job summaries by id.
    mapping(uint256 jobId => JobSummary summary) public jobs;

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /// @param _tm TroveManager address (proxy).
    /// @param _owner Owner for admin actions.
    /// @param _feeSink Initial fee sink (zero to disable fee routing).
    /// @param _feeBps Initial fee BPS.
    constructor(address _tm, address _owner, address _feeSink, uint16 _feeBps) Ownable(_owner) {
        if (_tm == address(0)) revert ZeroAddress();
        if (_feeBps > 10_000) revert InvalidFeeBps();
        troveManager = ITroveManager(_tm);
        feeSink = _feeSink;
        feeBps = _feeBps;
        pointsPerLiquidation = 1;
    }

    // =============================================================
    //                        ADMIN ACTIONS
    // =============================================================

    /// @notice Set/adjust protocol fee BPS.
    function setFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > 10_000) revert InvalidFeeBps();
        emit FeeBpsUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    /// @notice Set fee sink address (zero disables).
    function setFeeSink(address _feeSink) external onlyOwner {
        emit FeeSinkUpdated(feeSink, _feeSink);
        feeSink = _feeSink;
    }

    /// @notice Set MUSD token address for forwarding gas deposit.
    function setMusd(address _musd) external onlyOwner {
        emit MusdTokenUpdated(musd, _musd);
        musd = _musd;
    }

    /// @notice Set KeeperRegistry for payouts and scoring.
    function setKeeperRegistry(address _registry) external onlyOwner {
        emit KeeperRegistryUpdated(keeperRegistry, _registry);
        keeperRegistry = _registry;
    }

    /// @notice Configure the score increment per liquidation (0 disables scoring).
    function setPointsPerLiquidation(uint96 _points) external onlyOwner {
        emit PointsPerLiquidationUpdated(pointsPerLiquidation, _points);
        pointsPerLiquidation = _points;
    }

    // =============================================================
    //                     LIQUIDATION EXECUTION
    // =============================================================

    /// @notice Liquidate a slice of the provided `troves` array.
    /// @dev Strategy: try batch on the chosen slice, fallback to per-trove with up to `maxRetries` retries per trove.
    /// @param _troves Full trove address list (caller-provided).
    /// @param _start  Start index within `troves` to process.
    /// @param _count  Number of troves to attempt from `start`.
    /// @param _maxRetries Number of per-trove retries upon failure (0 = no retry).
    /// @return executed Number of successful liquidations.
    function liquidateRange(address[] calldata _troves, uint256 _start, uint256 _count, uint8 _maxRetries)
        external
        nonReentrant
        returns (uint256 executed)
    {
        if (_troves.length == 0 || _count == 0) revert EmptyInput();
        if (_start >= _troves.length) revert EmptyInput();
        uint256 n = _count;
        if (_start + n > _troves.length) n = _troves.length - _start;

        uint256 startGas = gasleft();

        // Attempt batch liquidation on the chosen slice
        address[] calldata sliceArr = _slice(_troves, _start, n);
        try troveManager.batchLiquidate(sliceArr) {
            executed = n;
        } catch {
            // Fallback to per-trove loop with optional retries
            for (uint256 i = 0; i < n; ++i) {
                address borrower = _troves[_start + i];
                bool ok;
                try troveManager.liquidate(borrower) {
                    ok = true;
                } catch {
                    // retry heuristic
                    uint8 attempts;
                    while (!ok && attempts < _maxRetries) {
                        unchecked {
                            ++attempts;
                        }
                        try troveManager.liquidate(borrower) {
                            ok = true;
                        } catch { }
                    }
                }
                if (ok) {
                    unchecked {
                        ++executed;
                    }
                }
            }
        }

        // Record job and emit
        uint256 gasUsed = startGas - gasleft();
        uint256 jobId = ++jobCounter;
        jobs[jobId] = JobSummary({
            keeper: msg.sender,
            attempted: uint64(n),
            executed: uint64(executed),
            timestamp: uint64(block.timestamp),
            gasUsed: gasUsed
        });
        emit JobRecorded(jobId, msg.sender, n, executed, gasUsed);

        // Resolve payout addr and scoring
        address payout = _resolvePayoutAndScore(msg.sender, executed);

        // Forward rewards
        _forwardRewards(payout);
    }

    // =============================================================
    //                      REWARD FORWARDING
    // =============================================================

    /// @dev Forward any native and MUSD rewards held by this contract to `_to`, minus protocol fee.
    function _forwardRewards(address _to) internal {
        if (_to == address(0)) revert ZeroAddress();

        // native
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
        }

        // MUSD
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

        emit RewardsForwarded(_to, nativeBal, musdOut, feeBps);
    }

    /// @dev Resolve payout address from KeeperRegistry and bump score.
    function _resolvePayoutAndScore(address _caller, uint256 _executed) internal returns (address payout) {
        payout = _caller;
        address _registry = keeperRegistry;
        if (_registry == address(0)) return payout;

        // Resolve payTo override
        try IKeeperRegistry(_registry).keepers(_caller) returns (bool, /*listed*/ uint96, /*score*/ address payTo) {
            if (payTo != address(0)) payout = payTo;
        } catch { }

        // Bump score
        if (_executed != 0 && pointsPerLiquidation != 0) {
            uint256 totalPoints = uint256(pointsPerLiquidation) * _executed;
            if (totalPoints > type(uint96).max) totalPoints = type(uint96).max;
            try IKeeperRegistry(_registry).bumpScore(_caller, uint96(totalPoints)) { } catch { }
        }
    }

    // =============================================================
    //                         INTERNAL UTIL
    // =============================================================

    /// @dev Return a calldata slice `[start..start+len)` from `_a`.
    function _slice(address[] calldata _a, uint256 _start, uint256 _len) internal pure returns (address[] calldata b) {
        assembly {
            b.offset := add(_a.offset, mul(_start, 0x20))
            b.length := _len
        }
    }

    /// @notice Accept native rewards routed back by the protocol.
    receive() external payable { }

    // =============================================================
    //                         VIEW HELPERS
    // =============================================================

    /// @notice Return the most recent job summaries, up to `n` entries.
    /// @dev Results are ordered from oldest to newest within the returned window.
    /// @param _n Maximum number of recent jobs to return.
    /// @return recent Array of `JobSummary` entries.
    function getRecentJobs(uint256 _n) external view returns (JobSummary[] memory recent) {
        uint256 total = jobCounter;
        if (total == 0 || _n == 0) {
            return new JobSummary[](0);
        }
        uint256 count = _n < total ? _n : total;
        uint256 startId = total - count + 1;
        recent = new JobSummary[](count);
        for (uint256 i = 0; i < count; ++i) {
            recent[i] = jobs[startId + i];
        }
    }
}
