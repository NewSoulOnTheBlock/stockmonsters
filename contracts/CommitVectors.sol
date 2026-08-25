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
    address internal constant NFT_ADDRESS = 0xC5883F1A3c7Fd984bBf8DF90Ced24dd199479611;
    address internal constant MARKET_ADDRESS = 0xfF516731e96e572bCF277642F438b2DE158EE900;
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
            v.digest = 0xcad5a04e54451e85bacce50a5899f14613af60bb7c9158b3a07be92275dec995;
            v.signature = hex"6d34bf1eee68b4420494cbbae81739d465a1ae047479b399856ae63ea3c65c231da55c7a62e79e59addf287983bfef41ee39f49708de9d472d20d6121bdd8d3a1b";
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
            v.digest = 0xc4641b51ad9f0cbff740fd6d2eab7d395183384ad379b7942e0c355e7bb86204;
            v.signature = hex"2c3ee4c9829bb80f015927dccae986b0d10db9883aa4104db74e0b35b2700ade7aa3492d3472c641f3997c75f92ba9a121ccdb0f89bab0f5756b9a4a7c8a51231b";
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
            v.digest = 0xa1ade400e696dc44806f4cf27c3e8dd60d1eebc4254cf9037d9f43f0331c1f53;
            v.signature = hex"52faf1fccb237ef7a70a38836178fb88cb1f6396a77c4ae4aaee875cd8f1ee2840543ab227c40ef00e6ee6c887b593178612fa2a19641945e1d2d4714e1a233d1c";
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
            v.digest = 0x41e49e0d378c36af8ca82204322b6ce2dd5323ea0cb050fe88bf4f841a0153be;
            v.signature = hex"95247d6c961ca5fbe6bc14c17ae194376341fc5fa447f95593a7db7eb88c021c1a58f951a258abf6ef6546e2bcf761178655e21651e60715f3dc59292a83b92a1c";
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
        o.digest = 0xe032b7bfb65d88ecd4705223ab77bfa8750c3a4652906811189174541ca63af1;
        o.signature = hex"44229700faae877fb2224a33e1d4b871f993301e4f0468eebbfb6b9be3f638ed62e18a671d2913d7cba3f3a5a8a9af0c7e082a043d565f5b072ea9790157cba11c";
    }
}
