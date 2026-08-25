// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Stock Monster Collection
/// @notice On-chain catch-and-mint for the Stock Monster Collection. Solidity port of the
/// off-chain reference implementation in src/ (catchRate.ts, traits.ts, mint.ts, metadata.ts) -
/// see README.md for the design rationale behind every formula/constant here.
/// @dev RANDOMNESS WARNING: `_random()` uses blockhash/prevrandao, which a miner/validator can
/// bias. This is a working placeholder for development and low-stakes testnet use only - swap
/// in Chainlink VRF (or equivalent) before any real-money mainnet launch. See README "Open
/// questions" section.
contract StockMonsterCollection is ERC721, Ownable {
    using Strings for uint256;
    using Strings for uint16;
    using Strings for uint8;

    uint256 public constant GLOBAL_SUPPLY_CAP = 5000;
    uint256 public constant SHINY_ODDS_DENOMINATOR = 8192;
    uint256 public constant IV_MAX = 31;

    enum BallType { REGULAR, GREAT, ULTRA }
    enum Status { NONE, SLEEP, FREEZE, PARALYZE, POISON, BURN }

    string[18] private TYPE_NAMES = [
        "Neutral", "Combat", "Wind", "Toxic", "Terra", "Stone", "Swarm", "Spectre", "Alloy",
        "Blaze", "Tide", "Flora", "Volt", "Psionic", "Frost", "Wyrm", "Shadow", "Fae"
    ];

    struct Species {
        bool registered;
        string name;
        string ticker;
        uint8 type1;
        int8 type2; // -1 means single-typed
        uint8 catchRate;
        uint8 baseHp;
        uint8 baseAttack;
        uint8 baseDefense;
        uint8 baseSpAttack;
        uint8 baseSpDefense;
        uint8 baseSpeed;
    }

    struct MintedTraits {
        uint16 dexId;
        uint8 level;
        uint16 hp;
        uint16 attack;
        uint16 defense;
        uint16 spAttack;
        uint16 spDefense;
        uint16 speed;
        bool shiny;
    }

    /// @dev IPFS folder root for creature art: {IMAGE_BASE_URI}/{dbSymbolOrTicker}/{regular|shiny}.png
    string public imageBaseUri;

    mapping(uint16 dexId => Species) public species;
    mapping(uint16 dexId => bool) public shinyClaimed;
    mapping(uint256 tokenId => MintedTraits) public traitsOf;

    uint256 public totalMinted;
    uint256 private _nextTokenId = 1;
    uint256 private _randNonce;

    event StockmonsterCaught(address indexed trainer, uint256 indexed tokenId, uint16 indexed dexId, bool shiny, uint8 level);
    event BrokeFree(address indexed trainer, uint16 indexed dexId, BallType ball);
    event SpeciesRegistered(uint16 indexed dexId, string name);

    constructor(address initialOwner, string memory initialImageBaseUri)
        ERC721("Stock Monster Collection", "STONK")
        Ownable(initialOwner)
    {
        imageBaseUri = initialImageBaseUri;
    }

    // ============================================================
    // Ball config - prices and catch bonuses, fixed per the spec.
    // ============================================================

    function ballPrice(BallType ball) public pure returns (uint256) {
        if (ball == BallType.REGULAR) return 0.002 ether;
        if (ball == BallType.GREAT) return 0.006 ether;
        return 0.01 ether; // ULTRA
    }

    /// @dev Returned as a (numerator, denominator) pair over 10 so 1.5x stays exact in integer math.
    function _ballBonus(BallType ball) internal pure returns (uint256 numerator, uint256 denominator) {
        if (ball == BallType.REGULAR) return (10, 10);
        if (ball == BallType.GREAT) return (15, 10);
        return (20, 10); // ULTRA
    }

    function _statusBonus(Status status) internal pure returns (uint256 numerator, uint256 denominator) {
        if (status == Status.SLEEP || status == Status.FREEZE) return (2, 1);
        if (status == Status.PARALYZE || status == Status.POISON || status == Status.BURN) return (3, 2);
        return (1, 1);
    }

    // ============================================================
    // Species registration - owner-only, batched to stay under any single block's gas limit.
    // ============================================================

    function registerSpecies(
        uint16[] calldata dexIds,
        string[] calldata names,
        string[] calldata tickers,
        uint8[] calldata type1s,
        int8[] calldata type2s,
        uint8[] calldata catchRates,
        uint8[6][] calldata baseStats
    ) external onlyOwner {
        uint256 n = dexIds.length;
        require(
            names.length == n && tickers.length == n && type1s.length == n && type2s.length == n
                && catchRates.length == n && baseStats.length == n,
            "length mismatch"
        );
        for (uint256 i = 0; i < n; i++) {
            require(catchRates[i] >= 1, "catchRate must be >=1");
            species[dexIds[i]] = Species({
                registered: true,
                name: names[i],
                ticker: tickers[i],
                type1: type1s[i],
                type2: type2s[i],
                catchRate: catchRates[i],
                baseHp: baseStats[i][0],
                baseAttack: baseStats[i][1],
                baseDefense: baseStats[i][2],
                baseSpAttack: baseStats[i][3],
                baseSpDefense: baseStats[i][4],
                baseSpeed: baseStats[i][5]
            });
            emit SpeciesRegistered(dexIds[i], names[i]);
        }
    }

    // ============================================================
    // Catch-rate math - exact integer port of the classic Gen III+ formula.
    // See src/catchRate.ts for the floating-point reference this mirrors term-for-term.
    // ============================================================

    /// @dev The "a" value: a >= 255 means guaranteed catch.
    function computeA(uint16 dexId, uint16 maxHp, uint16 currentHp, Status status, BallType ball)
        public
        view
        returns (uint256 a)
    {
        Species memory s = species[dexId];
        require(s.registered, "unknown species");
        require(maxHp > 0 && currentHp <= maxHp, "bad hp");

        uint256 hpFactor = uint256(3) * maxHp - uint256(2) * currentHp; // >=0: currentHp<=maxHp
        (uint256 bn, uint256 bd) = _ballBonus(ball);
        uint256 base = (hpFactor * s.catchRate * bn) / (3 * uint256(maxHp) * bd);
        (uint256 sn, uint256 sd) = _statusBonus(status);
        a = (base * sn) / sd;
    }

    /// @dev b = 65536 * (a/255)^(1/4), computed exactly via two integer-sqrt passes:
    /// fourthRoot(x) == isqrt(isqrt(x)), and 65536*(a/255)^0.25 == isqrt(isqrt(2^64 * a / 255)).
    function _shakeThreshold(uint256 a) private pure returns (uint256 b) {
        uint256 x = (a << 64) / 255;
        b = _isqrt(_isqrt(x));
    }

    function _isqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _random() private returns (uint256) {
        _randNonce++;
        return uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, msg.sender, _randNonce))
        );
    }

    /// @dev The classic 4-shake-check resolution. a>=255 short-circuits to guaranteed catch.
    function _resolveCatch(uint256 a) private returns (bool caught) {
        if (a >= 255) return true;
        if (a == 0) return false;

        uint256 b = _shakeThreshold(a);
        for (uint256 i = 0; i < 4; i++) {
            uint256 roll = _random() % 65536;
            if (roll >= b) return false;
        }
        return true;
    }

    // ============================================================
    // The main entry point.
    // ============================================================

    function throwBall(uint16 dexId, uint8 level, uint16 maxHp, uint16 currentHp, Status status, BallType ball)
        external
        payable
        returns (bool caught, uint256 tokenId)
    {
        require(msg.value == ballPrice(ball), "wrong payment for this ball");
        require(totalMinted < GLOBAL_SUPPLY_CAP, "supply exhausted");
        require(level >= 1 && level <= 100, "bad level");

        uint256 a = computeA(dexId, maxHp, currentHp, status, ball);
        caught = _resolveCatch(a);

        if (!caught) {
            emit BrokeFree(msg.sender, dexId, ball);
            return (false, 0);
        }

        tokenId = _nextTokenId++;
        totalMinted++;

        MintedTraits memory t = _generateTraits(dexId, level);
        traitsOf[tokenId] = t;

        _safeMint(msg.sender, tokenId);
        emit StockmonsterCaught(msg.sender, tokenId, dexId, t.shiny, level);
        return (true, tokenId);
    }

    function _generateTraits(uint16 dexId, uint8 level) private returns (MintedTraits memory t) {
        Species memory s = species[dexId];
        uint256 rand = _random();

        uint256 ivHp = rand & 0x1F; rand >>= 5;
        uint256 ivAtk = rand & 0x1F; rand >>= 5;
        uint256 ivDef = rand & 0x1F; rand >>= 5;
        uint256 ivSpAtk = rand & 0x1F; rand >>= 5;
        uint256 ivSpDef = rand & 0x1F; rand >>= 5;
        uint256 ivSpeed = rand & 0x1F; rand >>= 5;
        uint256 shinyRoll = rand % SHINY_ODDS_DENOMINATOR;

        bool shiny = (shinyRoll == 0) && !shinyClaimed[dexId];
        if (shiny) shinyClaimed[dexId] = true;

        t = MintedTraits({
            dexId: dexId,
            level: level,
            hp: uint16(((2 * uint256(s.baseHp) + ivHp) * level) / 100 + level + 10),
            attack: uint16(((2 * uint256(s.baseAttack) + ivAtk) * level) / 100 + 5),
            defense: uint16(((2 * uint256(s.baseDefense) + ivDef) * level) / 100 + 5),
            spAttack: uint16(((2 * uint256(s.baseSpAttack) + ivSpAtk) * level) / 100 + 5),
            spDefense: uint16(((2 * uint256(s.baseSpDefense) + ivSpDef) * level) / 100 + 5),
            speed: uint16(((2 * uint256(s.baseSpeed) + ivSpeed) * level) / 100 + 5),
            shiny: shiny
        });
    }

    // ============================================================
    // Metadata - fully on-chain, mirrors src/metadata.ts's attribute shape exactly.
    // ============================================================

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        MintedTraits memory t = traitsOf[tokenId];
        Species memory s = species[t.dexId];

        string memory displayName = t.shiny ? string.concat("Shiny ", s.name) : s.name;
        string memory image = string.concat(
            imageBaseUri, "/", s.ticker, "/", t.shiny ? "shiny.png" : "regular.png"
        );

        string memory json = string.concat(
            '{"name":"', displayName, ' #', tokenId.toString(),
            '","description":"A wild ', s.name, ' (', s.ticker,
            ') caught and minted on the Stock Monster Collection.",',
            '"image":"', image, '",',
            '"attributes":', _attributesJson(s, t)
        );
        json = string.concat(json, "}");

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributesJson(Species memory s, MintedTraits memory t) private view returns (string memory) {
        string memory type2Attr = s.type2 >= 0
            ? string.concat(',{"trait_type":"Type 2","value":"', TYPE_NAMES[uint8(s.type2)], '"}')
            : "";

        return string.concat(
            '[',
            '{"trait_type":"Species","value":"', s.name, '"},',
            '{"trait_type":"Ticker","value":"', s.ticker, '"},',
            '{"trait_type":"Type 1","value":"', TYPE_NAMES[s.type1], '"}',
            type2Attr, ',',
            '{"trait_type":"Level","value":', uint256(t.level).toString(), '},',
            '{"trait_type":"HP","value":', uint256(t.hp).toString(), '},',
            '{"trait_type":"Attack","value":', uint256(t.attack).toString(), '},',
            '{"trait_type":"Defense","value":', uint256(t.defense).toString(), '},',
            '{"trait_type":"Special Attack","value":', uint256(t.spAttack).toString(), '},',
            '{"trait_type":"Special Defense","value":', uint256(t.spDefense).toString(), '},',
            '{"trait_type":"Speed","value":', uint256(t.speed).toString(), '},',
            '{"trait_type":"Shiny","value":"', (t.shiny ? "Yes" : "No"), '"}',
            ']'
        );
    }

    // ============================================================
    // Admin
    // ============================================================

    function setImageBaseUri(string calldata newUri) external onlyOwner {
        imageBaseUri = newUri;
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}
