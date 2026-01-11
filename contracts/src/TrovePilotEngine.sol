// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { Errors } from "./utils/Errors.sol";

/// @title TrovePilotEngine
/// @notice Permissionless liquidation + redemption wrapper for Mezo with explicit `recipient` forwarding.
/// @dev Design notes:
///      - No on-chain hint computation; callers provide redemption hints.
///      - Liquidations are strict: TroveManager reverts are bubbled (no try/catch or fallback loops).
///      - Redemptions require atomic custody of MUSD (transferFrom -> redeem -> refund unused) and `receive()` for
/// native collateral.
///      - All payouts/refunds are forwarded using balance deltas to avoid leaking pre-existing dust.
///      - `jobId` is monotonic and increments exactly once per successful external call.
///      - `Ownable2Step` gates an emergency escape hatch (`sweep`) only.
contract TrovePilotEngine is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted after a liquidation completes.
    /// @param jobId        Monotonic identifier for off-chain indexing.
    /// @param caller       Address that initiated the call.
    /// @param recipient    Address receiving forwarded deltas (native + MUSD).
    /// @param attempted    Number of troves attempted.
    /// @param succeeded    Number of successful liquidations.
    /// @param nativeReward Native coin amount forwarded to `recipient` (delta of `address(this).balance`).
    /// @param musdReward   MUSD amount forwarded to `recipient` (delta of `MUSD.balanceOf(address(this))`).
    event LiquidationExecuted(
        uint256 indexed jobId,
        address indexed caller,
        address indexed recipient,
        uint256 attempted,
        uint256 succeeded,
        uint256 nativeReward,
        uint256 musdReward
    );

    /// @notice Emitted after a redemption completes.
    /// @param jobId         Monotonic identifier for off-chain indexing.
    /// @param caller        Address that initiated the call.
    /// @param recipient     Address receiving collateral and any MUSD refund.
    /// @param musdRequested MUSD amount requested for redemption (pulled from caller).
    /// @param musdRedeemed  MUSD amount actually redeemed/burned by core.
    /// @param musdRefunded  Unused MUSD refunded to `recipient` (remaining balance after redemption).
    /// @param collateralOut Native collateral forwarded to `recipient` (delta of `address(this).balance`).
    /// @param maxIter       Max iterations passed to TroveManager.
    /// @param hinted        True if redemption used caller-provided hints (always true for this function).
    event RedemptionExecuted(
        uint256 indexed jobId,
        address indexed caller,
        address indexed recipient,
        uint256 musdRequested,
        uint256 musdRedeemed,
        uint256 musdRefunded,
        uint256 collateralOut,
        uint256 maxIter,
        bool hinted
    );

    /// @notice Emitted when funds are swept out of the contract.
    /// @param caller    Address that initiated the sweep (owner).
    /// @param token     Token swept; address(0) for native.
    /// @param amount    Amount transferred.
    /// @param recipient Destination receiving the swept funds.
    event SweepExecuted(address indexed caller, address indexed token, uint256 amount, address indexed recipient);

    /// @notice Emitted when the trove pilot engine is initialized.
    /// @param troveManager TroveManager proxy address.
    /// @param musd MUSD token address.
    /// @param owner Owner address.
    event TrovePilotEngineInitialized(address indexed troveManager, address indexed musd, address indexed owner);

    /// @notice TroveManager proxy used for liquidations and redemptions.
    ITroveManager public immutable TROVE_MANAGER;

    /// @notice MUSD token used for redemption burns and liquidation gas compensation.
    IERC20 public immutable MUSD;

    /// @notice Monotonic identifier for off-chain indexing.
    uint256 public jobId;

    /// @notice Initializes a new engine instance.
    /// @dev Reverts if any constructor address is zero.
    /// @param _troveManager TroveManager proxy address.
    /// @param _musd MUSD token address (ERC-20).
    /// @param _owner Owner address for `Ownable2Step` administration (sweep/ownership transfer).
    constructor(address _troveManager, address _musd, address _owner) Ownable(_owner) {
        // Explicitly validate `_owner` even though OZ `Ownable` also enforces it (audit clarity).
        require(_troveManager != address(0) && _musd != address(0) && _owner != address(0), Errors.ZeroAddress());
        TROVE_MANAGER = ITroveManager(_troveManager);
        MUSD = IERC20(_musd);

        emit TrovePilotEngineInitialized(_troveManager, _musd, _owner);
    }

    /// @notice Liquidate a single trove directly via TroveManager.
    /// @dev Strict semantics: reverts if TroveManager reverts; on success `attempted == succeeded == 1`.
    /// @param _borrower The trove owner to liquidate.
    /// @param _recipient Address to receive deltas (native + MUSD). Must be non-zero.
    /// @return succeeded Always 1 on success (reverts on failure).
    function liquidateSingle(address _borrower, address _recipient) external nonReentrant returns (uint256 succeeded) {
        require(_borrower != address(0) && _recipient != address(0), Errors.ZeroAddress());

        uint256 nativeBefore = address(this).balance;
        uint256 musdBefore = MUSD.balanceOf(address(this));

        TROVE_MANAGER.liquidate(_borrower);

        (uint256 nativeDelta, uint256 musdDelta) = _forwardDeltasTo(nativeBefore, musdBefore, _recipient);
        emit LiquidationExecuted(++jobId, msg.sender, _recipient, 1, 1, nativeDelta, musdDelta);
        return 1;
    }

    /// @notice Batch liquidate provided borrowers.
    /// @dev Strict semantics: reverts if TroveManager batchLiquidateTroves reverts; on success `attempted == succeeded
    /// == borrowers.length`. @param _borrowers List of troves to liquidate. Must be non-empty.
    /// @param _recipient Address to receive deltas (native + MUSD). Must be non-zero.
    /// @return succeeded Always equals borrowers.length on success (reverts on failure).
    function liquidateBatch(address[] calldata _borrowers, address _recipient)
        external
        nonReentrant
        returns (uint256 succeeded)
    {
        require(_recipient != address(0), Errors.ZeroAddress());
        uint256 len = _borrowers.length;
        require(len > 0, Errors.EmptyArray());

        uint256 nativeBefore = address(this).balance;
        uint256 musdBefore = MUSD.balanceOf(address(this));

        TROVE_MANAGER.batchLiquidateTroves(_borrowers);

        (uint256 nativeDelta, uint256 musdDelta) = _forwardDeltasTo(nativeBefore, musdBefore, _recipient);
        emit LiquidationExecuted(++jobId, msg.sender, _recipient, len, len, nativeDelta, musdDelta);
        return len;
    }

    /// @notice Redeem MUSD for collateral using caller-supplied hints, forwarding all outputs to `recipient`.
    /// @dev Redemption requires atomic custody: TroveManager burns MUSD from `msg.sender` and sends collateral to
    /// `msg.sender`, therefore this engine must temporarily hold MUSD and must be able to receive native collateral.
    /// @param _musdAmount Amount of MUSD to attempt to redeem; must be > 0.
    /// @param _recipient Address to receive collateral and any MUSD refund; must be non-zero.
    /// @param _firstHint TroveManager first redemption hint.
    /// @param _upperHint TroveManager upper partial redemption insert hint.
    /// @param _lowerHint TroveManager lower partial redemption insert hint.
    /// @param _partialNICR TroveManager partial redemption NICR hint.
    /// @param _maxIter TroveManager max iterations for redemption traversal.
    function redeemHintedTo(
        uint256 _musdAmount,
        address _recipient,
        address _firstHint,
        address _upperHint,
        address _lowerHint,
        uint256 _partialNICR,
        uint256 _maxIter
    ) external nonReentrant {
        require(_musdAmount > 0, Errors.ZeroAmount());
        require(_recipient != address(0), Errors.ZeroAddress());

        uint256 nativeBefore = address(this).balance;
        uint256 musdBefore = MUSD.balanceOf(address(this));

        // Pull MUSD from the caller into the engine so TroveManager can burn from `msg.sender` (this contract).
        MUSD.safeTransferFrom(msg.sender, address(this), _musdAmount);

        // Bubble revert; do not attempt truncation on-chain.
        TROVE_MANAGER.redeemCollateral(_musdAmount, _firstHint, _upperHint, _lowerHint, _partialNICR, _maxIter);

        (uint256 collateralOut, uint256 musdRefunded) = _forwardDeltasTo(nativeBefore, musdBefore, _recipient);
        require(musdRefunded <= _musdAmount, Errors.InvalidRefundAmount());
        uint256 musdRedeemed = _musdAmount - musdRefunded;
        emit RedemptionExecuted(
            ++jobId, msg.sender, _recipient, _musdAmount, musdRedeemed, musdRefunded, collateralOut, _maxIter, true
        );
    }

    /// @notice Emergency escape hatch. Should never be required during normal operation.
    /// @dev Sweeps full balance of a token or native coin to `recipient`.
    /// @param _token Address of token to sweep; use address(0) for native coin.
    /// @param _recipient Recipient of the swept balance; must be non-zero.
    function sweep(address _token, address _recipient) external onlyOwner nonReentrant {
        require(_recipient != address(0), Errors.ZeroAddress());

        if (_token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal != 0) {
                _sendNative(_recipient, bal);
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

    /// @notice Accept native collateral routed back from Mezo redemptions/liquidations.
    receive() external payable { }

    /// @dev Forwards any newly accrued native + MUSD deltas to `_recipient`.
    /// @param _nativeBefore Native balance snapshot taken before the core call.
    /// @param _musdBefore MUSD balance snapshot taken before the core call.
    /// @param _recipient Address receiving forwarded deltas (native + MUSD).
    /// @return nativeDelta Native amount forwarded (balance delta).
    /// @return musdDelta MUSD amount forwarded (balance delta).
    function _forwardDeltasTo(uint256 _nativeBefore, uint256 _musdBefore, address _recipient)
        internal
        returns (uint256 nativeDelta, uint256 musdDelta)
    {
        uint256 musdAfter = MUSD.balanceOf(address(this));
        if (musdAfter > _musdBefore) {
            unchecked {
                musdDelta = musdAfter - _musdBefore;
            }
            MUSD.safeTransfer(_recipient, musdDelta);
        }

        uint256 nativeAfter = address(this).balance;
        if (nativeAfter > _nativeBefore) {
            unchecked {
                nativeDelta = nativeAfter - _nativeBefore;
            }
            _sendNative(_recipient, nativeDelta);
        }
    }

    /// @dev Sends native coin using `.call` and reverts on failure (consistent with Mezo ActivePool).
    /// @param _recipient Address to receive native coin.
    /// @param _amount Amount of native coin to send.
    function _sendNative(address _recipient, uint256 _amount) internal {
        (bool ok,) = payable(_recipient).call{ value: _amount }("");
        if (!ok) revert Errors.NativeTransferFailed();
    }
}
