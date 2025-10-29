// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";

contract KeeperRegistryTest is Test {
    KeeperRegistry registry;
    address owner = address(this);
    address k1 = address(0x1);
    address k2 = address(0x2);
    address k3 = address(0x3);

    function setUp() public {
        registry = new KeeperRegistry(owner);
        registry.setAuthorizer(owner, true);

        vm.prank(k1);
        registry.register(address(0));
        vm.prank(k2);
        registry.register(address(0));
        vm.prank(k3);
        registry.register(address(0));

        registry.bumpScore(k1, 10);
        registry.bumpScore(k2, 30);
        registry.bumpScore(k3, 20);
    }

    function test_GetTopKeepers_OrderedByScore() public view {
        (address[] memory addrs, uint96[] memory scores) = registry.getTopKeepers(2);
        assertEq(addrs.length, 2);
        assertEq(scores.length, 2);
        assertEq(addrs[0], k2);
        assertEq(scores[0], 30);
        assertEq(addrs[1], k3);
        assertEq(scores[1], 20);
    }
}

