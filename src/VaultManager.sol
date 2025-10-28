// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { RedemptionRouter } from "./RedemptionRouter.sol";
import { YieldAggregator } from "./YieldAggregator.sol";

/// @title TrovePilot: VaultManager (MVP)
/// @notice Opt-in helper that lets users pre-fund MUSD and allow any keeper to execute small redemptions
///         on their behalf, paying the keeper from the user's balance.
/// @dev This MVP focuses on enabling demonstrable automation flows for hackathon judging.
contract VaultManager is Ownable2Step {
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

    constructor(address _musd, address _router, address _owner) Ownable(_owner) {
        if (_musd == address(0) || _router == address(0)) revert ZeroAddress();
        MUSD = IERC20(_musd);
        router = RedemptionRouter(_router);
        // pre-approve router for convenience; we manage amounts internally
        MUSD.safeApprove(address(router), type(uint256).max);
    }

    /// @notice Set the optional yield aggregator sink. Owner-only.
    /// @param _aggregator YieldAggregator address (zero to disable).
    function setAggregator(address _aggregator) external onlyOwner {
        aggregator = YieldAggregator(_aggregator);
    }

    function setConfig(uint256 musdPerRedeem, uint256 maxIterations, uint16 keeperFeeBps, bool active) external {
        configs[msg.sender] = Config({
            musdPerRedeem: musdPerRedeem, maxIterations: maxIterations, keeperFeeBps: keeperFeeBps, active: active
        });
        emit ConfigUpdated(msg.sender, configs[msg.sender]);
    }

    function fund(uint256 amount) external {
        MUSD.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Funded(msg.sender, amount, balances[msg.sender]);
    }

    function withdraw(uint256 amount) external {
        uint256 bal = balances[msg.sender];
        if (amount > bal) revert InsufficientBalance();
        balances[msg.sender] = bal - amount;
        MUSD.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    /// @notice Deposit a portion of user's internal balance to the aggregator on their behalf.
    /// @dev Anyone can trigger this if the user has balance and aggregator is set; good for automation.
    /// @param user Target user whose internal balance is used.
    /// @param amount MUSD amount to deposit.
    function autoDeposit(address user, uint256 amount) external {
        YieldAggregator agg = aggregator;
        if (address(agg) == address(0)) revert ZeroAddress();
        uint256 bal = balances[user];
        if (amount > bal) revert InsufficientBalance();
        balances[user] = bal - amount;
        // move funds to aggregator and credit the user
        MUSD.safeTransfer(address(agg), amount);
        agg.notifyDeposit(user, amount);
    }

    /// @notice Execute user's configured redemption using their pre-funded MUSD and pay keeper fee from balance.
    /// @param user Target user who opted-in and funded the contract
    /// @param price System price for redemption hint computation (same source as protocol)
    function execute(address user, uint256 price) external {
        Config memory cfg = configs[user];
        if (!cfg.active) revert Inactive();

        // total required = redeem amount + keeper fee in MUSD
        uint256 keeperFee = (cfg.musdPerRedeem * cfg.keeperFeeBps) / 10_000;
        uint256 total = cfg.musdPerRedeem + keeperFee;
        if (balances[user] < total) revert InsufficientBalance();

        // Spend user's MUSD held by this contract to redeem on their behalf
        // This contract is the caller to router; router will burn MUSD from this contract
        router.redeemExact(cfg.musdPerRedeem, price, cfg.maxIterations);

        // Account and pay keeper in MUSD
        unchecked {
            balances[user] -= total;
        }
        if (keeperFee != 0) {
            MUSD.safeTransfer(msg.sender, keeperFee);
        }

        emit Executed(user, msg.sender, cfg.musdPerRedeem, keeperFee, price);
    }
}

