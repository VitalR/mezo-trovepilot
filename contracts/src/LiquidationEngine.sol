// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { Errors } from "./utils/Errors.sol";

/// @title TrovePilot LiquidationEngine
/// @notice Minimal, permissionless liquidation executor for Mezo troves.
/// @dev Stateless aside from a monotonic `jobId`. No fees, no governance, no scoring.
///      Spec reference: docs/CONTRACTS_V2.md (LiquidationEngine).
/// @custom:invariant Only state is `jobId`; no custodial balances should remain post-sweep.
contract LiquidationEngine is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted after a liquidation attempt completes.
    /// @param jobId         Monotonic identifier for off-chain indexing.
    /// @param keeper        Original caller of the engine.
    /// @param recipient     Address receiving rewards (native + MUSD).
    /// @param attempted     Number of troves attempted.
    /// @param succeeded     Number of successful liquidations.
    /// @param nativeReward  Native coin amount forwarded to keeper (delta of `address(this).balance`).
    /// @param musdReward    MUSD amount forwarded to keeper (delta of `MUSD.balanceOf(address(this))`).
    event LiquidationExecuted(
        uint256 indexed jobId,
        address indexed keeper,
        address indexed recipient,
        uint256 attempted,
        uint256 succeeded,
        uint256 nativeReward,
        uint256 musdReward
    );

    /// @notice Emitted when the engine is initialized.
    /// @param troveManager TroveManager proxy address.
    /// @param musd MUSD token address.
    /// @param owner Owner address.
    event LiquidationEngineInitialized(address indexed troveManager, address indexed musd, address indexed owner);

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

        emit LiquidationEngineInitialized(_troveManager, _musd, msg.sender);
    }

    /// @notice Liquidate a single trove directly via TroveManager.
    /// @dev This entrypoint has strict semantics: it either succeeds or reverts.
    /// @param _borrower The trove owner to liquidate.
    /// @param _recipient Address to receive rewards (native + MUSD). Must be non-zero.
    /// @return succeeded Always 1 on success (reverts if TroveManager reverts).
    function liquidateSingle(address _borrower, address _recipient) external nonReentrant returns (uint256 succeeded) {
        require(_borrower != address(0), Errors.ZeroAddress());
        require(_recipient != address(0), Errors.ZeroAddress());

        uint256 balanceBefore = address(this).balance;
        uint256 musdBefore = MUSD.balanceOf(address(this));

        TROVE_MANAGER.liquidate(_borrower);

        (uint256 nativeReward, uint256 musdReward) = _forwardRewards(balanceBefore, musdBefore, _recipient);
        emit LiquidationExecuted(++jobId, msg.sender, _recipient, 1, 1, nativeReward, musdReward);
        return 1;
    }

    /// @notice Batch liquidate provided borrowers.
    /// @dev Strict semantics: reverts if TroveManager batchLiquidateTroves reverts.
    /// @param _borrowers List of troves to liquidate.
    /// @param _recipient Address to receive rewards (native + MUSD). Must be non-zero.
    /// @return succeeded Always equals borrowers.length on success (reverts on failure).
    function liquidateBatch(address[] calldata _borrowers, address _recipient)
        external
        nonReentrant
        returns (uint256 succeeded)
    {
        require(_recipient != address(0), Errors.ZeroAddress());
        uint256 len = _borrowers.length;
        require(len > 0, Errors.EmptyArray());

        uint256 balanceBefore = address(this).balance;
        uint256 musdBefore = MUSD.balanceOf(address(this));

        TROVE_MANAGER.batchLiquidateTroves(_borrowers);

        (uint256 nativeReward, uint256 musdReward) = _forwardRewards(balanceBefore, musdBefore, _recipient);
        emit LiquidationExecuted(++jobId, msg.sender, _recipient, len, len, nativeReward, musdReward);
        return len;
    }

    /// @dev Forwards any newly accrued native + MUSD balances to `_recipient`.
    /// @param nativeBefore Native balance snapshot taken before liquidation calls.
    /// @param musdBefore MUSD balance snapshot taken before liquidation calls.
    /// @param _recipient Address receiving rewards (native + MUSD).
    /// @return nativeReward Native amount forwarded to keeper.
    /// @return musdReward MUSD amount forwarded to keeper.
    function _forwardRewards(uint256 nativeBefore, uint256 musdBefore, address _recipient)
        internal
        returns (uint256 nativeReward, uint256 musdReward)
    {
        uint256 musdAfter = MUSD.balanceOf(address(this));
        if (musdAfter > musdBefore) {
            unchecked {
                musdReward = musdAfter - musdBefore;
            }
            // Forward MUSD gas compensation to the keeper in the same tx (no claim step).
            MUSD.safeTransfer(_recipient, musdReward);
        }

        uint256 nativeAfter = address(this).balance;
        if (nativeAfter > nativeBefore) {
            unchecked {
                nativeReward = nativeAfter - nativeBefore;
            }
            (bool ok,) = payable(_recipient).call{ value: nativeReward }("");
            if (!ok) revert Errors.RewardPayoutFailed();
        }
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
