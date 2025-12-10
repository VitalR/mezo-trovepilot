// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { IHintHelpers } from "./interfaces/IHintHelpers.sol";
import { ISortedTroves } from "./interfaces/ISortedTroves.sol";
import { Errors } from "./utils/Errors.sol";

/// @title TrovePilot RedemptionRouter
/// @notice Minimal, permissionless wrapper around `TroveManager.redeemCollateral` exposing quick and hinted flows.
/// @dev Stateless. All strategy (price/slippage/iterations) is off-chain. Spec reference: docs/CONTRACTS_V2.md.
contract RedemptionRouter {
    /// @notice Emitted after a redemption completes.
    /// @param jobId      Monotonic identifier for off-chain indexing.
    /// @param caller     Address that initiated the redemption.
    /// @param musdBurned Amount of MUSD requested/redeemed.
    /// @param truncated  Truncated amount returned by HintHelpers.
    /// @param maxIter    Max iterations used.
    /// @param hinted     True if redemption used hints.
    event RedemptionExecuted(
        uint256 indexed jobId,
        address indexed caller,
        uint256 musdBurned,
        uint256 truncated,
        uint256 maxIter,
        bool hinted
    );

    /// @notice TroveManager proxy used to perform redemptions.
    ITroveManager public immutable TROVE_MANAGER;
    /// @notice HintHelpers contract used to compute redemption hints.
    IHintHelpers public immutable HINT_HELPERS;
    /// @notice SortedTroves contract used to compute insert positions.
    ISortedTroves public immutable SORTED_TROVES;
    /// @notice Monotonic identifier for off-chain indexing.
    uint256 public jobId;

    /// @param _tm TroveManager proxy address.
    /// @param _hints HintHelpers address.
    /// @param _sorted SortedTroves address.
    constructor(address _tm, address _hints, address _sorted) {
        require(_tm != address(0) && _hints != address(0) && _sorted != address(0), Errors.ZeroAddress());
        TROVE_MANAGER = ITroveManager(_tm);
        HINT_HELPERS = IHintHelpers(_hints);
        SORTED_TROVES = ISortedTroves(_sorted);
    }

    /// @notice Quick redemption without hints (higher gas).
    /// @dev Matches Mezo Option A (no hints). All hints/NICR/iterations set to zero.
    /// @param _musdAmount Amount of MUSD to redeem; must be > 0.
    function redeemQuick(uint256 _musdAmount) external {
        require(_musdAmount > 0, Errors.ZeroAmount());
        TROVE_MANAGER.redeemCollateral(_musdAmount, address(0), address(0), address(0), 0, 0);
        emit RedemptionExecuted(++jobId, msg.sender, _musdAmount, _musdAmount, 0, false);
    }

    /// @notice Hint-assisted redemption with strict truncated match.
    /// @dev Matches Mezo Option B (with hints). Reverts unless `musdAmount == truncatedAmount` to enforce exactness.
    /// @param _musdAmount Requested MUSD to redeem; must be > 0 and equal to truncated from HintHelpers.
    /// @param _price Price input for HintHelpers (must match TroveManager pricing source).
    /// @param _maxIter Max trove iterations for hinting and redemption traversal.
    /// @param _upperSeed Seed upper hint candidate for SortedTroves.
    /// @param _lowerSeed Seed lower hint candidate for SortedTroves.
    function redeemHinted(uint256 _musdAmount, uint256 _price, uint256 _maxIter, address _upperSeed, address _lowerSeed)
        external
    {
        require(_musdAmount > 0, Errors.ZeroAmount());
        (address first, uint256 nicr, uint256 truncated) =
            HINT_HELPERS.getRedemptionHints(_musdAmount, _price, _maxIter);
        require(_musdAmount == truncated, Errors.TruncatedMismatch(truncated));

        (address upper, address lower) = SORTED_TROVES.findInsertPosition(nicr, _upperSeed, _lowerSeed);
        TROVE_MANAGER.redeemCollateral(_musdAmount, first, upper, lower, nicr, _maxIter);
        emit RedemptionExecuted(++jobId, msg.sender, _musdAmount, truncated, _maxIter, true);
    }
}
