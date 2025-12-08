// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";

import { MezoAddresses } from "./MezoAddresses.sol";
import { IPriceOracle } from "../src/interfaces/IPriceOracle.sol";

contract OracleCheckScript is Script {
    function run() external {
        bytes memory callData = abi.encodeWithSignature("latestRoundData()");
        string memory params = string.concat(
            "[{\"to\":\"",
            vm.toString(MezoAddresses.PRICE_ORACLE_CALLER),
            "\",\"data\":\"",
            vm.toString(callData),
            "\"},\"latest\"]"
        );

        bytes memory raw = vm.rpc("eth_call", params);
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            abi.decode(raw, (uint80, int256, uint256, uint256, uint80));

        console2.log("roundId", uint256(roundId));
        console2.log("answer", answer);
        console2.log("startedAt", startedAt);
        console2.log("updatedAt", updatedAt);
        console2.log("answeredInRound", uint256(answeredInRound));
    }
}
