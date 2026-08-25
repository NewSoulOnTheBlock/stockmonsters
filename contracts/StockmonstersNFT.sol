// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Stockmonsters NFT — caught creatures minted to player wallets
///
/// Design (see HANDOVER "Direction notes"):
/// - The GAME SERVER is authoritative: a catch happens in-game, the server
///   signs an EIP-712 mint voucher for it, and the PLAYER submits that
///   voucher here (player pays gas, server never holds funds).
/// - Each token is a unique individual: the voucher carries dexId, level,
///   IVs, nature and shiny, all stored on-chain so metadata is verifiable.
/// - A catch can be minted exactly once (voucher uid is consumed).
///
/// No external dependencies: minimal ERC-721 implemented inline so the file
/// compiles standalone with solc >=0.8.24 (add OpenZeppelin later if the
/// surface grows).
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

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _ownerOf[tokenId];
        require(owner != address(0), "NOT_MINTED");
    }

    function balanceOf(address owner) public view returns (uint256) {
        require(owner != address(0), "ZERO_ADDRESS");
        return _balanceOf[owner];
    }

    function approve(address spender, uint256 tokenId) external {
        address owner = _ownerOf[tokenId];
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender], "NOT_AUTHORIZED");
        getApproved[tokenId] = spender;
        emit Approval(owner, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(from == _ownerOf[tokenId], "WRONG_FROM");
        require(to != address(0), "ZERO_ADDRESS");
        require(
            msg.sender == from || isApprovedForAll[from][msg.sender] || msg.sender == getApproved[tokenId],
            "NOT_AUTHORIZED"
        );
        _balanceOf[from]--;
        _balanceOf[to]++;
        _ownerOf[tokenId] = to;
        delete getApproved[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    // --- Stockmonster data --------------------------------------------
    struct Monster {
        uint16 dexId;      // 1..600 range used by the game
        uint8 level;
        uint8 ivHp; uint8 ivAtk; uint8 ivDfe; uint8 ivSpd; uint8 ivAts; uint8 ivDfs;
        uint8 natureId;    // 0..24
        bool shiny;
        uint64 caughtAt;   // unix time the server witnessed the catch
    }

    mapping(uint256 => Monster) public monsters;
    uint256 public totalSupply;

    // --- server-signed mint vouchers (EIP-712) ------------------------
    address public gameSigner;
    address public owner;
    string public baseTokenURI;
    mapping(bytes32 => bool) public voucherUsed;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "MintVoucher(address player,uint16 dexId,uint8 level,uint8[6] ivs,uint8 natureId,bool shiny,uint64 caughtAt,bytes32 uid)"
    );

    event Minted(address indexed player, uint256 indexed tokenId, uint16 dexId, bool shiny, bytes32 uid);
    event GameSignerChanged(address indexed signer);

    constructor(address _gameSigner, string memory _baseTokenURI) {
        owner = msg.sender;
        gameSigner = _gameSigner;
        baseTokenURI = _baseTokenURI;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    function setGameSigner(address _signer) external onlyOwner {
        gameSigner = _signer;
        emit GameSignerChanged(_signer);
    }

    function setBaseTokenURI(string calldata uri) external onlyOwner {
        baseTokenURI = uri;
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)
        ));
    }

    /// @notice Mint a caught Stockmonster using a voucher signed by the game
    ///         server. `uid` is the server's unique id for the catch — each
    ///         voucher can be redeemed once, by the player it names.
    function mintCaught(
        uint16 dexId,
        uint8 level,
        uint8[6] calldata ivs,
        uint8 natureId,
        bool shiny,
        uint64 caughtAt,
        bytes32 uid,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        require(!voucherUsed[uid], "VOUCHER_USED");
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH, msg.sender, dexId, level,
            keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, uid
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        require(_recover(digest, signature) == gameSigner, "BAD_SIGNATURE");

        voucherUsed[uid] = true;
        tokenId = ++totalSupply;
        _ownerOf[tokenId] = msg.sender;
        _balanceOf[msg.sender]++;
        monsters[tokenId] = Monster(
            dexId, level, ivs[0], ivs[1], ivs[2], ivs[3], ivs[4], ivs[5],
            natureId, shiny, caughtAt
        );
        emit Transfer(address(0), msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, dexId, shiny, uid);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf[tokenId] != address(0), "NOT_MINTED");
        return string(abi.encodePacked(baseTokenURI, _toString(tokenId)));
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
        uint256 temp = value; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(buffer);
    }
}
