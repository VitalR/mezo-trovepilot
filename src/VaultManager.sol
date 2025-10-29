// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { RedemptionRouter } from "./RedemptionRouter.sol";
import { YieldAggregator } from "./YieldAggregator.sol";

/// @title TrovePilot: VaultManager (MVP)
/// @notice Opt-in helper that lets users pre-fund MUSD and allow any keeper to execute small redemptions
///         on their behalf, paying the keeper from the user's balance.
/// @dev This MVP focuses on enabling demonstrable automation flows for hackathon judging.
contract VaultManager is Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error Inactive();
    error InsufficientBalance();

    struct Config {
        uint256 musdPerRedeem; // exact MUSD per execution
        uint256 maxIterations; // max trove traversals
        uint16 keeperFeeBps; // fee paid to keeper from user's balance (in MUSD)
        bool active; // opt-in flag
    }

    IERC20 public immutable MUSD;
    RedemptionRouter public immutable router;
    YieldAggregator public aggregator; // optional aggregator sink

    mapping(address user => Config) public configs;
    mapping(address user => uint256 musdBalance) public balances;

    event ConfigUpdated(address indexed user, Config cfg);
    event Funded(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event Executed(
        address indexed user, address indexed keeper, uint256 musdRedeemed, uint256 keeperFee, uint256 price
    );

    /// @notice Construct the VaultManager.
    /// @param _musd   MUSD ERC-20 token address (proxy on Mezo).
    /// @param _router RedemptionRouter contract used to execute redemptions.
    /// @param _owner  Owner address for admin actions.
    constructor(address _musd, address _router, address _owner) Ownable(_owner) {
        if (_musd == address(0) || _router == address(0)) revert ZeroAddress();
        MUSD = IERC20(_musd);
        router = RedemptionRouter(_router);
        // pre-approve router for convenience; we manage amounts internally
        MUSD.forceApprove(address(router), type(uint256).max);
    }

    /// @notice Set the optional yield aggregator sink. Owner-only.
    /// @param _aggregator YieldAggregator address (zero to disable).
    function setAggregator(address _aggregator) external onlyOwner {
        aggregator = YieldAggregator(_aggregator);
    }

    /// @notice Pause state-mutating operations. Owner-only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause state-mutating operations. Owner-only.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Configure redemption parameters for the caller.
    /// @param _musdPerRedeem Exact MUSD to redeem per `execute`.
    /// @param _maxIterations Max trove traversals for hinted redemption.
    /// @param _keeperFeeBps  Keeper fee in basis points paid from caller's balance.
    /// @param _active        Whether automation is enabled for the caller.
    function setConfig(uint256 _musdPerRedeem, uint256 _maxIterations, uint16 _keeperFeeBps, bool _active) external {
        configs[msg.sender] = Config({
            musdPerRedeem: _musdPerRedeem, maxIterations: _maxIterations, keeperFeeBps: _keeperFeeBps, active: _active
        });
        emit ConfigUpdated(msg.sender, configs[msg.sender]);
    }

    /// @notice Deposit MUSD into the caller's internal balance used for automation and keeper fees.
    /// @param _amount MUSD amount to deposit.
    function fund(uint256 _amount) external whenNotPaused {
        MUSD.safeTransferFrom(msg.sender, address(this), _amount);
        balances[msg.sender] += _amount;
        emit Funded(msg.sender, _amount, balances[msg.sender]);
    }

    /// @notice Withdraw MUSD from the caller's internal balance back to their wallet.
    /// @param _amount MUSD amount to withdraw.
    function withdraw(uint256 _amount) external whenNotPaused {
        uint256 bal = balances[msg.sender];
        if (_amount > bal) revert InsufficientBalance();
        balances[msg.sender] = bal - _amount;
        MUSD.safeTransfer(msg.sender, _amount);
        emit Withdrawn(msg.sender, _amount, balances[msg.sender]);
    }

    /// @notice Deposit a portion of a user's internal balance to the aggregator on their behalf.
    /// @dev Anyone can trigger this if the user has balance and an aggregator is set.
    /// @param _user   Target user whose internal balance is used.
    /// @param _amount MUSD amount to deposit.
    function autoDeposit(address _user, uint256 _amount) external whenNotPaused {
        YieldAggregator agg = aggregator;
        if (address(agg) == address(0)) revert ZeroAddress();
        uint256 bal = balances[_user];
        if (_amount > bal) revert InsufficientBalance();
        balances[_user] = bal - _amount;
        // move funds to aggregator and credit the user
        MUSD.safeTransfer(address(agg), _amount);
        agg.notifyDeposit(_user, _amount);
    }

    /// @notice Execute a user's configured redemption using their pre-funded MUSD and pay the keeper fee from balance.
    /// @param _user  Target user who opted-in and funded the contract.
    /// @param _price System price for redemption hint computation (must match protocol source).
    function execute(address _user, uint256 _price) external whenNotPaused {
        Config memory cfg = configs[_user];
        if (!cfg.active) revert Inactive();

        // total required = redeem amount + keeper fee in MUSD
        uint256 keeperFee = (cfg.musdPerRedeem * cfg.keeperFeeBps) / 10_000;
        uint256 total = cfg.musdPerRedeem + keeperFee;
        if (balances[_user] < total) revert InsufficientBalance();

        // Spend user's MUSD held by this contract to redeem on their behalf
        // This contract is the caller to router; router will burn MUSD from this contract
        router.redeemExact(cfg.musdPerRedeem, _price, cfg.maxIterations);

        // Account and pay keeper in MUSD
        unchecked {
            balances[_user] -= total;
        }
        if (keeperFee != 0) {
            MUSD.safeTransfer(msg.sender, keeperFee);
        }

        emit Executed(_user, msg.sender, cfg.musdPerRedeem, keeperFee, _price);
    }

    /// @notice View helper to return a user's config and internal balance in one call.
    /// @param _user The account to query.
    /// @return cfg The stored `Config` for the user.
    /// @return balance The internal MUSD balance tracked for the user.
    function userSnapshot(address _user) external view returns (Config memory cfg, uint256 balance) {
        cfg = configs[_user];
        balance = balances[_user];
    }
}
