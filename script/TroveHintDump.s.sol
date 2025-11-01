// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";

import { MezoAddresses } from "./MezoAddresses.sol";

/// @title TroveHintDump
/// @notice Utility script to snapshot the first N troves from SortedTroves and emit a fallback CSV.
/// @dev Run with `forge script script/TroveHintDump.s.sol --rpc-url $MEZO_RPC --sig "run()"`.
///      Optionally set:
///        - `SORTED_TROVES_ADDR` to override the SortedTroves address
///        - `TROVE_DUMP_LIMIT`  to change how many troves to sample (default 8)
///        - `TROVE_DUMP_SKIP`   to skip the first K entries (default 0)
///        - `TROVE_DUMP_OUT`    to write the CSV to a file path (default empty = no file)
///        - `TROVE_DUMP_PREFIX` to prepend a string (e.g. `NEXT_PUBLIC_TROVE_FALLBACK_LIST=`)
contract TroveHintDump is Script {
    address internal constant ZERO = address(0);

    function run() external {
        address sorted = vm.envOr("SORTED_TROVES_ADDR", MezoAddresses.SORTED_TROVES);
        uint256 limit = vm.envOr("TROVE_DUMP_LIMIT", uint256(8));
        uint256 skip = vm.envOr("TROVE_DUMP_SKIP", uint256(0));
        string memory outPath = vm.envOr("TROVE_DUMP_OUT", string(""));
        string memory prefix = vm.envOr("TROVE_DUMP_PREFIX", string(""));

        if (sorted == ZERO) {
            console2.log("SORTED_TROVES address is zero; set SORTED_TROVES_ADDR env.");
            return;
        }

        if (limit == 0) {
            console2.log("Limit is zero; nothing to do.");
            return;
        }

        address[] memory troves = new address[](limit);
        uint256 captured;
        uint256 seen;
        uint256 guard;

        address cursor = _callAddress(sorted, abi.encodeWithSignature("getFirst()"));
        while (cursor != ZERO && captured < limit && guard < skip + limit + 256) {
            if (seen >= skip) {
                troves[captured] = cursor;
                captured += 1;
            }
            seen += 1;
            guard += 1;
            address next = _callAddress(sorted, abi.encodeWithSignature("getNext(address)", cursor));
            if (next == cursor) break; // guard pathological loops
            cursor = next;
        }

        if (captured == 0) {
            console2.log("No troves found.");
            console2.log("limit", limit);
            console2.log("skip", skip);
            return;
        }

        console2.log("Captured troves", captured);
        string memory csv;
        for (uint256 i = 0; i < captured; i++) {
            address trove = troves[i];
            console2.log("Trove #", i + 1);
            console2.log("Address", trove);
            string memory addrStr = vm.toString(trove);
            if (bytes(csv).length == 0) {
                csv = addrStr;
            } else {
                csv = string.concat(csv, ",", addrStr);
            }
        }

        string memory line = bytes(prefix).length > 0 ? string.concat(prefix, csv) : csv;
        console2.log("---");
        console2.log(line);

        if (bytes(outPath).length > 0) {
            vm.writeFile(outPath, line);
            console2.log("Written to", outPath);
        }
    }

    function _callAddress(address target, bytes memory data) internal returns (address) {
        string memory params =
            string.concat("[{\"to\":\"", vm.toString(target), "\",\"data\":\"", vm.toString(data), "\"},\"latest\"]");

        bytes memory raw;
        try vm.rpc("eth_call", params) returns (bytes memory resp) {
            raw = resp;
        } catch {
            return ZERO;
        }
        if (raw.length == 0) return ZERO;
        return abi.decode(raw, (address));
    }
}
