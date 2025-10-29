// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import { ERC20Mock } from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { VaultManager } from "../src/VaultManager.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";

contract MockTM_VMPS {
    function redeemCollateral(uint256, address, address, address, uint256, uint256) external { }
}

contract MockHints_VMPS {
    function getRedemptionHints(uint256, uint256, uint256) external pure returns (address, uint256, uint256) {
        return (address(0), 1e18, 0);
    }
}

contract MockSorted_VMPS {
    function findInsertPosition(uint256, address p, address n) external pure returns (address, address) {
        return (p, n);
    }
}

contract VaultManagerTest is Test {
    ERC20Mock musd;
    VaultManager vault;
    RedemptionRouter router;

    address owner = address(this);
    address user = address(0xABCD);

    function setUp() public {
        musd = new ERC20Mock();
        router = new RedemptionRouter(
            address(new MockTM_VMPS()), address(new MockHints_VMPS()), address(new MockSorted_VMPS())
        );
        vault = new VaultManager(address(musd), address(router), owner);

        musd.mint(user, 1000e18);
    }

    function test_UserSnapshot() public {
        vm.startPrank(user);
        IERC20(address(musd)).approve(address(vault), type(uint256).max);
        vault.setConfig(10e18, 5, 100, true);
        vault.fund(50e18);
        vm.stopPrank();

        (VaultManager.Config memory cfg, uint256 bal) = vault.userSnapshot(user);
        assertEq(cfg.musdPerRedeem, 10e18);
        assertEq(cfg.maxIterations, 5);
        assertEq(cfg.keeperFeeBps, 100);
        assertTrue(cfg.active);
        assertEq(bal, 50e18);
    }

    function test_PausableBlocksMutations() public {
        vault.pause();
        vm.startPrank(user);
        IERC20(address(musd)).approve(address(vault), type(uint256).max);
        vm.expectRevert();
        vault.fund(1e18);
        vm.expectRevert();
        vault.withdraw(0);
        vm.expectRevert();
        vault.autoDeposit(user, 0);
        vm.expectRevert();
        vault.execute(user, 1e18);
        vm.stopPrank();

        // Unpause and ensure fund works
        vault.unpause();
        vm.startPrank(user);
        vault.fund(1e18);
        vm.stopPrank();
    }
}
