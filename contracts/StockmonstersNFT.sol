// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Stockmonsters NFT — sealed-box catch-to-mint ERC-721
///
/// Design (see DESIGN.md):
/// - The GAME SERVER is authoritative: a catch happens in-game, the server
///   signs an EIP-712 mint voucher for it, and the PLAYER submits that
///   voucher here (player pays gas, server never holds funds).
/// - Minting is SEALED. The voucher carries only keccak256 of the creature's
///   attributes plus a 256-bit server salt. Nothing about the creature is
///   readable on-chain until the owner calls `open()` with the reveal
///   payload. THE SEAL IS THE PRODUCT — do not add any function, event or
///   getter that leaks a sealed token's contents.
/// - A catch can be minted exactly once (voucher uid is consumed).
/// - `tokenURI` is rendered fully on-chain in two states (sealed / opened),
///   so no metadata server ever needs to hold the reveal payload.
///
/// No external dependencies: minimal ERC-721 + ERC-2981 + Base64 implemented
/// inline so the file compiles standalone with solc >= 0.8.24.
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

contract StockmonstersNFT {
    // --- ERC-721 core -------------------------------------------------
    string public constant name = "Stockmonsters";
    string public constant symbol = "STOCKMON";

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed spender, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function ownerOf(uint256 tokenId) public view returns (address owner_) {
        owner_ = _ownerOf[tokenId];
        require(owner_ != address(0), "NOT_MINTED");
    }

    function balanceOf(address owner_) public view returns (uint256) {
        require(owner_ != address(0), "ZERO_ADDRESS");
        return _balanceOf[owner_];
    }

    function approve(address spender, uint256 tokenId) external {
        address owner_ = _ownerOf[tokenId];
        require(owner_ != address(0), "NOT_MINTED");
        require(msg.sender == owner_ || isApprovedForAll[owner_][msg.sender], "NOT_AUTHORIZED");
        getApproved[tokenId] = spender;
        emit Approval(owner_, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner_ = _ownerOf[tokenId];
        require(owner_ != address(0), "NOT_MINTED");
        require(from == owner_, "WRONG_FROM");
        require(to != address(0), "ZERO_ADDRESS");
        require(
            msg.sender == from || isApprovedForAll[from][msg.sender] || msg.sender == getApproved[tokenId],
            "NOT_AUTHORIZED"
        );
        unchecked {
            _balanceOf[from]--;
            _balanceOf[to]++;
        }
        _ownerOf[tokenId] = to;
        delete getApproved[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, data);
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
            require(retval == IERC721Receiver.onERC721Received.selector, "UNSAFE_RECIPIENT");
        } catch (bytes memory reason) {
            if (reason.length == 0) revert("UNSAFE_RECIPIENT");
            assembly {
                revert(add(32, reason), mload(reason))
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 Metadata
            || interfaceId == 0x2a55205a; // ERC-2981 NFT Royalty Standard
    }

    // --- Stockmonster data --------------------------------------------
    struct Monster {
        uint16 dexId; // dex id used by the game (1..781)
        uint8 level;
        uint8 ivHp;
        uint8 ivAtk;
        uint8 ivDfe;
        uint8 ivSpd;
        uint8 ivAts;
        uint8 ivDfs;
        uint8 natureId; // 0..24, index into the alphabetical natures table
        bool shiny;
        uint64 caughtAt; // unix time the server witnessed the catch
    }

    mapping(uint256 => Monster) public monsters;
    uint256 public totalSupply;

    // --- ownership (two-step) -----------------------------------------
    address public owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    /// @notice Step 1 of 2. Nominate `newOwner`; nothing changes until they
    ///         call `acceptOwnership()` from that address. Pass address(0) to
    ///         cancel a pending handover.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2. Must be called by the nominated address, which
    ///         proves the key (or multisig) is live before it gets control.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "NOT_PENDING_OWNER");
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    // --- ERC-2981 royalties -------------------------------------------
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%, hard cap
    address public royaltyReceiver;
    uint96 public royaltyBps;

    event RoyaltyChanged(address indexed receiver, uint96 bps);

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(bps <= MAX_ROYALTY_BPS, "ROYALTY_TOO_HIGH");
        require(receiver != address(0) || bps == 0, "ZERO_RECEIVER");
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyChanged(receiver, bps);
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        require(_ownerOf[tokenId] != address(0), "NOT_MINTED");
        receiver = royaltyReceiver;
        royaltyAmount = receiver == address(0) ? 0 : (salePrice * royaltyBps) / 10_000;
    }

    // --- server-signed mint vouchers (EIP-712) ------------------------
    address public gameSigner;
    string public imageBaseURI; // e.g. "ipfs://<cid>/" — "<ticker>/regular.png" is appended
    string public sealedImageURI; // one image for every sealed box
    uint256 public claimFee = 0.01 ether; // advertised price; the SIGNED fee is authoritative
    mapping(bytes32 => bool) public voucherUsed;
    mapping(uint256 => bytes32) public attrCommit; // sealed until opened
    mapping(uint256 => bool) public opened;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("MintVoucher(address player,bytes32 attrCommit,bytes32 uid,uint256 fee,uint64 deadline)");

    event Minted(address indexed player, uint256 indexed tokenId, bytes32 uid);
    event Opened(uint256 indexed tokenId, uint16 dexId, bool shiny);
    event GameSignerChanged(address indexed signer);
    event ClaimFeeChanged(uint256 fee);

    constructor(address _gameSigner, string memory _imageBaseURI, string memory _sealedImageURI) {
        owner = msg.sender;
        gameSigner = _gameSigner;
        imageBaseURI = _imageBaseURI;
        sealedImageURI = _sealedImageURI;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function setGameSigner(address _signer) external onlyOwner {
        gameSigner = _signer;
        emit GameSignerChanged(_signer);
    }

    function setImageBaseURI(string calldata uri) external onlyOwner {
        imageBaseURI = uri;
    }

    function setSealedImageURI(string calldata uri) external onlyOwner {
        sealedImageURI = uri;
    }

    function setClaimFee(uint256 fee) external onlyOwner {
        claimFee = fee;
        emit ClaimFeeChanged(fee);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "WITHDRAW_FAILED");
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        // Recomputed per call from block.chainid: fork-safe, never cached.
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)));
    }

    /// @notice Claim a caught Stockmonster as a SEALED box. Optional — the
    ///         creature stays playable in-game either way.
    /// @param attrCommitment keccak256(abi.encode(dexId, level,
    ///        keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt,
    ///        salt)) computed by the server. `salt` MUST be 256 bits of CSPRNG
    ///        output — it is the only thing standing between the commitment
    ///        and an offline brute force of the other fields.
    /// @param fee the price the server quoted, bound into the signature so a
    ///        `setClaimFee` cannot brick or front-run an outstanding voucher.
    /// @param deadline unix time after which the voucher is dead.
    function mintCaught(bytes32 attrCommitment, bytes32 uid, uint256 fee, uint64 deadline, bytes calldata signature)
        external
        payable
        returns (uint256 tokenId)
    {
        require(block.timestamp <= deadline, "VOUCHER_EXPIRED");
        require(msg.value == fee, "WRONG_FEE");
        require(!voucherUsed[uid], "VOUCHER_USED");
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, msg.sender, attrCommitment, uid, fee, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        require(_recover(digest, signature) == gameSigner, "BAD_SIGNATURE");

        voucherUsed[uid] = true;
        unchecked {
            tokenId = ++totalSupply;
            _balanceOf[msg.sender]++;
        }
        _ownerOf[tokenId] = msg.sender;
        attrCommit[tokenId] = attrCommitment;
        emit Transfer(address(0), msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, uid);
    }

    /// @notice Open the sealed box: prove the attributes against the stored
    ///         commitment. Only the current owner (or their operator) may
    ///         open; the server hands the owner the reveal payload on demand.
    ///         The owner gate buys no cryptographic security — the commitment
    ///         already binds the data — it exists so a third party cannot
    ///         spoil a sealed listing.
    function open(
        uint256 tokenId,
        uint16 dexId,
        uint8 level,
        uint8[6] calldata ivs,
        uint8 natureId,
        bool shiny,
        uint64 caughtAt,
        bytes32 salt
    ) external {
        address owner_ = ownerOf(tokenId);
        require(msg.sender == owner_ || isApprovedForAll[owner_][msg.sender], "NOT_AUTHORIZED");
        require(!opened[tokenId], "ALREADY_OPENED");
        bytes32 commit =
            keccak256(abi.encode(dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt));
        require(commit == attrCommit[tokenId], "BAD_REVEAL");
        require(natureId < 25, "BAD_NATURE");
        opened[tokenId] = true;
        monsters[tokenId] = Monster(dexId, level, ivs[0], ivs[1], ivs[2], ivs[3], ivs[4], ivs[5], natureId, shiny, caughtAt);
        emit Opened(tokenId, dexId, shiny);
    }

    // --- species registry ---------------------------------------------
    // Batch-loaded post-deploy from stockmonsters-mmo/src/data/dex.json by
    // tools/register-species.mjs. The full 254-entry roster in one call
    // exceeds the block gas limit, hence the batching.
    struct Species {
        bool registered;
        uint8 type1; // index into TYPE_NAMES
        uint8 type2; // 255 = single-typed
        uint8 baseHp;
        uint8 baseAtk;
        uint8 baseDfe;
        uint8 baseSpd;
        uint8 baseAts;
        uint8 baseDfs;
        string speciesName;
        string ticker;
    }

    struct SpeciesInput {
        uint16 dexId;
        uint8 type1;
        uint8 type2;
        uint8[6] baseStats; // hp, atk, dfe, spd, ats, dfs
        string speciesName;
        string ticker;
    }

    mapping(uint16 => Species) public species;
    uint16 public speciesCount;
    bool public speciesFrozen;

    event SpeciesRegistered(uint16 indexed dexId, string speciesName);
    event SpeciesFrozen();

    /// @notice Load a batch of species. Call repeatedly (≈40 per tx).
    function registerSpecies(SpeciesInput[] calldata batch) external onlyOwner {
        require(!speciesFrozen, "SPECIES_FROZEN");
        for (uint256 i = 0; i < batch.length; i++) {
            SpeciesInput calldata s = batch[i];
            require(s.type1 < 18, "BAD_TYPE1");
            require(s.type2 < 18 || s.type2 == 255, "BAD_TYPE2");
            if (!species[s.dexId].registered) speciesCount++;
            species[s.dexId] = Species({
                registered: true,
                type1: s.type1,
                type2: s.type2,
                baseHp: s.baseStats[0],
                baseAtk: s.baseStats[1],
                baseDfe: s.baseStats[2],
                baseSpd: s.baseStats[3],
                baseAts: s.baseStats[4],
                baseDfs: s.baseStats[5],
                speciesName: s.speciesName,
                ticker: s.ticker
            });
            emit SpeciesRegistered(s.dexId, s.speciesName);
        }
    }

    /// @notice Make the registry immutable. Without this the owner could
    ///         rewrite the species behind an already-sold token.
    function freezeSpecies() external onlyOwner {
        speciesFrozen = true;
        emit SpeciesFrozen();
    }

    // --- stat maths (docs/psdk-mechanics.md §2.1, EVs are always 0) ----
    // maxHp   = (ivHp + 2*baseHp) * level / 100 + 10 + level
    // stat    = ((2*base + iv) * level / 100 + 5) * naturePercent / 100
    // All divisions are integer, and the nature multiply-then-floor is the
    // LAST operation — matching src/battle/stats.ts exactly.

    /// 25 natures, alphabetical, matching Object.keys(studio/natures.json).
    /// One byte each: high nibble = boosted stat index, low nibble = reduced
    /// stat index, over [atk, dfe, spd, ats, dfs]; 0xFF = neutral nature.
    bytes private constant NATURE_MODS = hex"03ff10024043ff41ff21132314013130240432ff341242ff20";

    function _natureMods(uint8 natureId) private pure returns (uint8 up, uint8 down) {
        uint8 packed = uint8(NATURE_MODS[natureId]);
        if (packed == 0xFF) return (0xFF, 0xFF);
        return (packed >> 4, packed & 0x0F);
    }

    function _naturePercent(uint8 natureId, uint8 statIdx) private pure returns (uint256) {
        (uint8 up, uint8 down) = _natureMods(natureId);
        if (statIdx == up) return 110;
        if (statIdx == down) return 90;
        return 100;
    }

    /// @notice The six display stats of an OPENED token, computed on-chain
    ///         from the stored IVs, nature and level against the registry.
    ///         Order: hp, atk, dfe, spd, ats, dfs.
    function finalStats(uint256 tokenId) public view returns (uint16[6] memory out) {
        require(opened[tokenId], "SEALED");
        Monster memory m = monsters[tokenId];
        Species memory s = species[m.dexId];
        require(s.registered, "SPECIES_UNKNOWN");
        uint256 lvl = m.level;
        out[0] = uint16(((uint256(m.ivHp) + 2 * uint256(s.baseHp)) * lvl) / 100 + 10 + lvl);
        uint8[5] memory bases = [s.baseAtk, s.baseDfe, s.baseSpd, s.baseAts, s.baseDfs];
        uint8[5] memory ivs = [m.ivAtk, m.ivDfe, m.ivSpd, m.ivAts, m.ivDfs];
        for (uint8 i = 0; i < 5; i++) {
            uint256 basis = ((2 * uint256(bases[i]) + uint256(ivs[i])) * lvl) / 100 + 5;
            out[i + 1] = uint16((basis * _naturePercent(m.natureId, i)) / 100);
        }
    }

    // --- on-chain metadata --------------------------------------------
    // 8-byte fixed-width slots, NUL-padded. Type ids are the index into the
    // alphabetical list of the 18 renamed Stockmonsters types; nature ids are
    // the index into the alphabetical keys of studio/natures.json. Both
    // orderings are re-derived and asserted by tools/register-species.mjs.
    bytes private constant TYPE_NAMES = hex"416c6c6f79000000426c617a65000000436f6d62617400004661650000000000"
        hex"466c6f726100000046726f73740000004e65757472616c005073696f6e696300"
        hex"536861646f770000537065637472650053746f6e65000000537761726d000000"
        hex"54657272610000005469646500000000546f786963000000566f6c7400000000"
        hex"57696e64000000005779726d00000000";

    bytes private constant NATURE_NAMES = hex"4164616d616e74004261736866756c00426f6c64000000004272617665000000"
        hex"43616c6d000000004361726566756c00446f63696c65000047656e746c650000"
        hex"48617264790000004861737479000000496d7069736800004a6f6c6c79000000"
        hex"4c617800000000004c6f6e656c7900004d696c64000000004d6f646573740000"
        hex"4e616976650000004e617567687479005175696574000000517569726b790000"
        hex"526173680000000052656c61786564005361737379000000536572696f757300"
        hex"54696d6964000000";

    function _slot(bytes memory table, uint256 idx) private pure returns (string memory) {
        uint256 start = idx * 8;
        uint256 len = 0;
        while (len < 8 && table[start + len] != 0) len++;
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = table[start + i];
        return string(out);
    }

    function typeName(uint8 typeId) public pure returns (string memory) {
        require(typeId < 18, "BAD_TYPE");
        return _slot(TYPE_NAMES, typeId);
    }

    function natureName(uint8 natureId) public pure returns (string memory) {
        require(natureId < 25, "BAD_NATURE");
        return _slot(NATURE_NAMES, natureId);
    }

    /// @notice Fully on-chain ERC-721 metadata, in two states.
    ///         SEALED  -> a generic box document that reveals NOTHING.
    ///         OPENED  -> the full attribute set, computed from stored IVs.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf[tokenId] != address(0), "NOT_MINTED");
        string memory json = opened[tokenId] ? _openedJson(tokenId) : _sealedJson(tokenId);
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    function _sealedJson(uint256 tokenId) private view returns (string memory) {
        return string.concat(
            '{"name":"Sealed Stockmonster Box #',
            _toString(tokenId),
            '","description":"A sealed box from the Stockmonsters world. Something was caught and locked inside; only a keccak256 commitment of its attributes exists on-chain. The owner can open it at any time to reveal what is inside - permanently and publicly.","image":"',
            sealedImageURI,
            '","attributes":[{"trait_type":"State","value":"Sealed"}]}'
        );
    }

    function _openedJson(uint256 tokenId) private view returns (string memory) {
        Monster memory m = monsters[tokenId];
        Species memory s = species[m.dexId];
        require(s.registered, "SPECIES_UNKNOWN");
        uint16[6] memory st = finalStats(tokenId);

        return string.concat(
            '{"name":"',
            s.speciesName,
            " #",
            _toString(tokenId),
            '","description":"',
            s.speciesName,
            " ($",
            s.ticker,
            ") - opened from Stockmonsters sealed box #",
            _toString(tokenId),
            '.","image":"',
            string.concat(imageBaseURI, s.ticker, m.shiny ? "/shiny.png" : "/regular.png"),
            '","attributes":[',
            _attributesJson(m, s, st),
            "]}"
        );
    }

    function _attributesJson(Monster memory m, Species memory s, uint16[6] memory st)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '{"trait_type":"State","value":"Opened"},',
            '{"trait_type":"Species","value":"',
            s.speciesName,
            '"},{"trait_type":"Ticker","value":"',
            s.ticker,
            '"},{"trait_type":"Type 1","value":"',
            typeName(s.type1),
            '"},',
            s.type2 == 255 ? "" : string.concat('{"trait_type":"Type 2","value":"', typeName(s.type2), '"},'),
            '{"trait_type":"Nature","value":"',
            natureName(m.natureId),
            '"},{"trait_type":"Shiny","value":"',
            m.shiny ? "Yes" : "No",
            '"},{"trait_type":"IVs","value":"',
            _ivString(m),
            '"},',
            _statsJson(m, st)
        );
    }

    function _statsJson(Monster memory m, uint16[6] memory st) private pure returns (string memory) {
        uint256 ivTotal =
            uint256(m.ivHp) + m.ivAtk + m.ivDfe + m.ivSpd + m.ivAts + m.ivDfs;
        return string.concat(
            '{"trait_type":"IV Total","value":',
            _toString(ivTotal),
            ',"max_value":186},{"trait_type":"Level","value":',
            _toString(m.level),
            ',"max_value":100},{"trait_type":"HP","value":',
            _toString(st[0]),
            '},{"trait_type":"Attack","value":',
            _toString(st[1]),
            '},{"trait_type":"Defense","value":',
            _toString(st[2]),
            '},{"trait_type":"Speed","value":',
            _toString(st[3]),
            '},{"trait_type":"Sp. Attack","value":',
            _toString(st[4]),
            '},{"trait_type":"Sp. Defense","value":',
            _toString(st[5]),
            '},{"display_type":"date","trait_type":"Caught","value":',
            _toString(m.caughtAt),
            "}"
        );
    }

    function _ivString(Monster memory m) private pure returns (string memory) {
        return string.concat(
            _toString(m.ivHp),
            "/",
            _toString(m.ivAtk),
            "/",
            _toString(m.ivDfe),
            "/",
            _toString(m.ivSpd),
            "/",
            _toString(m.ivAts),
            "/",
            _toString(m.ivDfs)
        );
    }

    // --- internals -----------------------------------------------------
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "BAD_SIG_LEN");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "BAD_SIG_V");
        // EIP-2: reject malleable s values
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "BAD_SIG_S");
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "BAD_SIGNATURE");
        return recovered;
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    bytes private constant B64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function _base64(bytes memory data) private pure returns (string memory) {
        if (data.length == 0) return "";
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        bytes memory result = new bytes(encodedLen);
        bytes memory table = B64_TABLE;
        uint256 i;
        uint256 j;
        for (; i + 3 <= data.length; i += 3) {
            uint256 chunk = (uint256(uint8(data[i])) << 16) | (uint256(uint8(data[i + 1])) << 8) | uint8(data[i + 2]);
            result[j++] = table[(chunk >> 18) & 63];
            result[j++] = table[(chunk >> 12) & 63];
            result[j++] = table[(chunk >> 6) & 63];
            result[j++] = table[chunk & 63];
        }
        uint256 remaining = data.length - i;
        if (remaining == 1) {
            uint256 chunk = uint256(uint8(data[i])) << 16;
            result[j++] = table[(chunk >> 18) & 63];
            result[j++] = table[(chunk >> 12) & 63];
            result[j++] = bytes1(0x3d);
            result[j++] = bytes1(0x3d);
        } else if (remaining == 2) {
            uint256 chunk = (uint256(uint8(data[i])) << 16) | (uint256(uint8(data[i + 1])) << 8);
            result[j++] = table[(chunk >> 18) & 63];
            result[j++] = table[(chunk >> 12) & 63];
            result[j++] = table[(chunk >> 6) & 63];
            result[j++] = bytes1(0x3d);
        }
        return string(result);
    }
}
