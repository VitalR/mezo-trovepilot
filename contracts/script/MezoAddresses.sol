// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library MezoAddresses {
    uint256 public constant CHAIN_ID = 31_611; // Mezo Testnet.

    address public constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    address public constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address public constant HINT_HELPERS = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;
    address public constant SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address public constant BORROWER_OPERATIONS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;

    address public constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address public constant SKIP_ORACLE = 0x7b7c000000000000000000000000000000000015;
    address public constant PYTH_ORACLE = 0x2880aB155794e7179c9eE2e38200202908C17B43;
}
