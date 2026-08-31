// SPDX-License-Identifier: MIT
// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: stockmonsters-mmo/tools/gen-commit-vectors.mjs (which drives the real
// production signer in tools/voucher-lib.mjs). Regenerate with:
//   node stockmonsters-mmo/tools/gen-commit-vectors.mjs
// CI guard: `node ... --check` fails if this file is stale.
pragma solidity ^0.8.24;

library CommitVectors {
    uint256 internal constant COUNT = 4;
    uint256 internal constant CHAIN_ID = 31337;
    address internal constant DEPLOYER = 0x00000000000000000000000000000000000D3910;
    address internal constant NFT_ADDRESS = 0xfF516731e96e572bCF277642F438b2DE158EE900;
    address internal constant MARKET_ADDRESS = 0x0378e149151282401D2f6EFc2B163E5921AF7671;
    address internal constant GAME_SIGNER = 0x9950bc7D7d0bAF695CA9927361739B16b7BC48d3;
    address internal constant SELLER = 0xD6f48792A8223775C8438D6A7E04DCB5a1861525;

    struct Vector {
        uint16 dexId;
        uint8 level;
        uint8[6] ivs;
        uint8 natureId;
        bool shiny;
        uint64 caughtAt;
        bytes32 salt;
        address player;
        bytes32 uid;
        uint256 fee;
        uint64 deadline;
        bytes32 ivsHash;
        bytes32 attrCommit;
        bytes32 digest;
        bytes signature;
    }

    function vector(uint256 i) internal pure returns (Vector memory v) {
        if (i == 0) {
            v.dexId = 1;
            v.level = 12;
            v.ivs = [uint8(31), 20, 15, 31, 25, 10];
            v.natureId = 3;
            v.shiny = true;
            v.caughtAt = 1756000000;
            v.salt = 0x0000000000000000000000000000000000000000000000000000000000c0ffee;
            v.player = 0x000000000000000000000000000000000000bEEF;
            v.uid = 0x0000000000000000000000000000000000000000000000000000000000000001;
            v.fee = 10000000000000000;
            v.deadline = 4000000000;
            v.ivsHash = 0xca1034de36fac09f73b5bbf8afb47bac0e4d29b66136c926bd7beb3826f43973;
            v.attrCommit = 0x9542b10ffc524505bd1ab8d635d3b25e32bac4cea084765f869a8a9d283b4bf2;
            v.digest = 0xbcb11caca21bb9a21f7ba7373af2eb3c537bde4eec3f6e1c307a78831e7cea61;
            v.signature = hex"2e8b679acc5d3137e33b1abd69a3936ab686732d8668b62b05aebc24b6dd6f287b635af0e6e31eb98462bde47472e2e9c496b08f53d3c52981dadbfd988a288d1b";
        }
        else if (i == 1) {
            v.dexId = 254;
            v.level = 100;
            v.ivs = [uint8(31), 31, 31, 31, 31, 31];
            v.natureId = 24;
            v.shiny = false;
            v.caughtAt = 1700000001;
            v.salt = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
            v.player = 0x000000000000000000000000000000000000cafE;
            v.uid = 0x0000000000000000000000000000000000000000000000000000000000000002;
            v.fee = 10000000000000000;
            v.deadline = 4000000000;
            v.ivsHash = 0x9d5f74e51de01bf33c9c43b87896bca9fe747da91649839a4ef1e787221d9fe8;
            v.attrCommit = 0x963c9d9ee4bb109b455d5eed6f8dd48e00b7c86350d09e03d98e852d49a9f899;
            v.digest = 0xabd7b25043a8f55f4ee88e3425df9c658010a4ba9c1cbb1bc953f3ffdb785f2d;
            v.signature = hex"352b2b23fd60203e959c1ec51572a3c6e689f2d89d2667bed0b99cd596dafa72407fc9e460a402dd00e86140ca421692c39c5db5272d57b0043977aa763bacb51c";
        }
        else if (i == 2) {
            v.dexId = 781;
            v.level = 1;
            v.ivs = [uint8(0), 0, 0, 0, 0, 0];
            v.natureId = 0;
            v.shiny = false;
            v.caughtAt = 1;
            v.salt = 0x0000000000000000000000000000000000000000000000000000000000000001;
            v.player = 0x000000000000000000000000000000000000D00d;
            v.uid = 0x0000000000000000000000000000000000000000000000000000000000000003;
            v.fee = 1;
            v.deadline = 4000000000;
            v.ivsHash = 0x1e990e27f0d7976bf2adbd60e20384da0125b76e2885a96aa707bcb054108b0d;
            v.attrCommit = 0x64677a13a7b8f2abfb0bf3e35d14309f725f378582ac4545a042e2f8c40ceeb1;
            v.digest = 0x4f8dbd58b92d04b32306135b470e9020a276e113e9c5e4f87cd2721714f323df;
            v.signature = hex"d3e258958939ebbfd93b527b1d59752c405998784c2af3b4fe4e60bcd01c62b766adb01b2de365046f0204d32ccdf461e3adffb8fc1e4f4e192b6fe2965779bb1b";
        }
        else if (i == 3) {
            v.dexId = 65535;
            v.level = 255;
            v.ivs = [uint8(0), 31, 0, 31, 0, 31];
            v.natureId = 12;
            v.shiny = true;
            v.caughtAt = 18446744073709551615;
            v.salt = 0xdededededededededededededededededededededededededededededededede;
            v.player = 0x000000000000000000000000000000000000F00D;
            v.uid = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
            v.fee = 0;
            v.deadline = 4000000000;
            v.ivsHash = 0x2960a82ce060f27166abdc52e358681920bb7435b8bd50e0e649f436d9330d8a;
            v.attrCommit = 0xce6d809ec9f03e81bb85eec6b78c06dfa3888c07aa1f1f48c4e08b04d6f48921;
            v.digest = 0xc6121963048f124abc2fb6c29bffee1b6983f25df9d687cf56d83acb77192ede;
            v.signature = hex"a44ced33f1bbb1164af1a376d166fabf717bdd5cf7bce2a181c305b342685b073bb5f39c813fc0d401986ecd62f01ecc6fd0c5da21b55eb9048297457340aef61b";
        }
        else revert("NO_SUCH_VECTOR");
    }

    struct OrderVector {
        address seller;
        uint256 tokenId;
        uint256 price;
        uint256 minProceeds;
        uint64 deadline;
        uint64 epoch;
        uint256 salt;
        bool requireSealed;
        bytes32 attrCommit;
        address taker;
        address currency;
        bytes32 digest;
        bytes signature;
    }

    function orderVector() internal pure returns (OrderVector memory o) {
        o.seller = 0xD6f48792A8223775C8438D6A7E04DCB5a1861525;
        o.tokenId = 1;
        o.price = 1000000000000000000;
        o.minProceeds = 900000000000000000;
        o.deadline = 4000000000;
        o.epoch = 0;
        o.salt = 123456789;
        o.requireSealed = true;
        o.attrCommit = 0x9542b10ffc524505bd1ab8d635d3b25e32bac4cea084765f869a8a9d283b4bf2;
        o.taker = 0x0000000000000000000000000000000000000000;
        o.currency = 0x0000000000000000000000000000000000000000;
        o.digest = 0xbd3691a293f1fac3f1137db8d638bb0a42c9921a830315ac3b69a46c8cd0bfd2;
        o.signature = hex"105135e6efcf1ef9a4f259e10d2fe8241cbb247c65ffc2d79e9b64428cd9a7f5654c4363e58ab163f566810f0c3628306c4b6f7f9166a5f0d0f4b067b079118c1b";
    }
}
