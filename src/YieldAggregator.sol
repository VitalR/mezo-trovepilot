// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TrovePilot: YieldAggregator (Stub)
/// @notice Minimal MUSD sink to demonstrate routing/compounding flows during the hackathon demo.
/// @dev This is a simple accounting contract. No external strategy integration in MVP.
contract YieldAggregator is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice Emitted when a notifier is set/unset.
    event NotifierUpdated(address indexed notifier, bool allowed);

    /// @notice Emitted on deposit credit.
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);

    /// @notice Emitted on withdrawal.
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);

    /// @dev Thrown when a non-notifier calls a restricted function.
    error NotifierOnly();
    /// @dev Thrown when requested amount exceeds balance.
    error InsufficientBalance();
    /// @dev Thrown when a zero address is provided.
    error ZeroAddress();

    /// @notice MUSD token used for accounting.
    IERC20 public immutable MUSD;

    /// @notice Addresses allowed to notify deposits (e.g., VaultManager).
    mapping(address notifier => bool isAllowed) public isNotifier;

    /// @notice User balances tracked inside the aggregator.
    mapping(address user => uint256 musdBalance) public balances;

    /// @param _musd MUSD ERC-20 address (proxy on Mezo).
    /// @param _owner Owner for admin actions (notifier management).
    constructor(address _musd, address _owner) Ownable(_owner) {
        if (_musd == address(0)) revert ZeroAddress();
        MUSD = IERC20(_musd);
    }

    /// @notice Grant or revoke notifier permission.
    /// @param _notifier Address allowed to call `notifyDeposit`.
    /// @param _on True to allow, false to revoke.
    function setNotifier(address _notifier, bool _on) external onlyOwner {
        isNotifier[_notifier] = _on;
        emit NotifierUpdated(_notifier, _on);
    }

    /// @notice Record a deposit made externally by a trusted notifier.
    /// @dev The notifier must have transferred the tokens to this contract before calling.
    /// @param _user Account to credit inside the aggregator.
    /// @param _amount Amount of MUSD to credit.
    function notifyDeposit(address _user, uint256 _amount) external {
        if (!isNotifier[msg.sender]) revert NotifierOnly();
        uint256 newBal = balances[_user] + _amount;
        balances[_user] = newBal;
        emit Deposited(_user, _amount, newBal);
    }

    /// @notice Withdraw caller's MUSD from the aggregator to caller's wallet.
    /// @param _amount Amount to withdraw.
    function withdraw(uint256 _amount) external {
        uint256 bal = balances[msg.sender];
        if (_amount > bal) revert InsufficientBalance();
        balances[msg.sender] = bal - _amount;
        MUSD.safeTransfer(msg.sender, _amount);
        emit Withdrawn(msg.sender, _amount, bal - _amount);
    }
}
