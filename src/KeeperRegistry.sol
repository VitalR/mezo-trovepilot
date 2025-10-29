// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TrovePilot: KeeperRegistry
/// @notice Lightweight on-chain registry to list keepers and accumulate a score (for leaderboards/incentives).
/// @dev
/// - Not strictly required by LiquidationBatcher/RedemptionRouter; provided as a neutral, composable module.
/// - In later versions, LiquidationBatcher can call `bumpScore` post-batch to reward active addresses.
contract KeeperRegistry is Ownable2Step {
    // =============================================================
    //                      EVENTS & ERRORS
    // =============================================================

    /// @notice Emitted when an authorizer is updated.
    /// @param authorizer Authorizer address that was updated.
    /// @param isAuthorized Whether the authorizer is authorized.
    event AuthorizerUpdated(address indexed authorizer, bool isAuthorized);

    /// @notice Emitted when a keeper registers.
    /// @param keeper Keeper address that was registered.
    /// @param payTo Optional custom payout address used by integrators.
    event KeeperRegistered(address indexed keeper, address payTo);

    /// @notice Emitted when a keeper's score is bumped.
    /// @param keeper Keeper address whose score was bumped.
    /// @param score New score value (after the bump).
    event ScoreBumped(address indexed keeper, uint96 score);

    /// @dev Thrown when a function restricted to an authorized caller is called by a non-authorized caller.
    error NotAuthorized();

    /// @dev Thrown when the number of keepers to return is too large.
    error TooManyKeepers();

    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice Keeper profile with listing status, cumulative score, and optional payout address.
    /// @param listed Indicates the keeper is listed/known in the registry.
    /// @param score  Accumulated score used for leaderboards or incentive weighting.
    /// @param payTo  Optional destination address to receive rewards/incentives for this keeper.
    struct Keeper {
        bool listed;
        uint96 score;
        address payTo; // optional "where to pay me" destination
    }

    /// @notice Keeper registry mapping (address => Keeper profile).
    mapping(address keeper => Keeper profile) public keepers;

    /// @notice Addresses authorized to call `bumpScore` (e.g., LiquidationBatcher).
    mapping(address authorizer => bool isAuthorized) public isAuthorizer;

    /// @notice Array of listed keepers for simple enumeration (best-effort, may contain stale entries if contracts
    /// change in future versions).
    address[] public keeperList;

    // =============================================================
    //                  CONSTRUCTOR & ADMIN ACTIONS
    // =============================================================

    /// @param _owner Operator/owner allowed to authorize bumpers, or bump directly.
    constructor(address _owner) Ownable(_owner) { }

    /// @notice Set/unset an address as authorized bumper (e.g., LiquidationBatcher).
    function setAuthorizer(address _who, bool _on) external onlyOwner {
        isAuthorizer[_who] = _on;
        emit AuthorizerUpdated(_who, _on);
    }

    // =============================================================
    //                        KEEPER FLOW
    // =============================================================

    /// @notice Register the caller as a keeper.
    /// @param _payTo Optional custom payout address used by integrators.
    function register(address _payTo) external {
        if (!keepers[msg.sender].listed) {
            keeperList.push(msg.sender);
        }
        keepers[msg.sender] = Keeper({ listed: true, score: 0, payTo: _payTo });
        emit KeeperRegistered(msg.sender, _payTo);
    }

    /// @notice Increment a keeper's score (authorized callers only).
    /// @param _keeper Keeper address whose score to increase.
    /// @param _add    Amount to add to the score.
    function bumpScore(address _keeper, uint96 _add) external {
        _onlyAuthorizer();
        Keeper storage k = keepers[_keeper];
        if (!k.listed) {
            // auto-list on first bump for convenience
            k.listed = true;
            keeperList.push(_keeper);
        }
        unchecked {
            k.score += _add;
        }
        emit ScoreBumped(_keeper, k.score);
    }

    /// @dev Internal function to check if the caller is an authorized bumper.
    function _onlyAuthorizer() internal view {
        require(isAuthorizer[msg.sender] || msg.sender == owner(), NotAuthorized());
    }

    // =============================================================
    //                         VIEW HELPERS
    // =============================================================

    /// @notice Return the top `count` keepers by `score`.
    /// @dev O(N*count) selection suitable for small enumerations in a UI context.
    /// @param _count Maximum number of keepers to return.
    /// @return addrs Array of keeper addresses ordered by descending score.
    /// @return scores Array of corresponding scores.
    function getTopKeepers(uint256 _count) external view returns (address[] memory addrs, uint96[] memory scores) {
        require(_count < 21, TooManyKeepers());
        uint256 n = keeperList.length;
        if (n == 0 || _count == 0) {
            return (new address[](0), new uint96[](0));
        }
        if (_count > n) _count = n;

        address[] memory list = keeperList;
        bool[] memory selected = new bool[](n);
        addrs = new address[](_count);
        scores = new uint96[](_count);

        for (uint256 k = 0; k < _count; ++k) {
            uint256 bestIdx = type(uint256).max;
            uint96 bestScore;
            for (uint256 i = 0; i < n; ++i) {
                if (selected[i]) continue;
                Keeper memory kp = keepers[list[i]];
                if (!kp.listed) continue;
                if (bestIdx == type(uint256).max || kp.score > bestScore) {
                    bestIdx = i;
                    bestScore = kp.score;
                }
            }
            if (bestIdx == type(uint256).max) {
                // No more
                break;
            }
            selected[bestIdx] = true;
            addrs[k] = list[bestIdx];
            scores[k] = bestScore;
        }
    }
}
