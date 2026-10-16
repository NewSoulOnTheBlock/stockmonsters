// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// Every Stock Monster is one token. The token id is the monster's identity in
/// the game: (personality << 32) | original trainer id, so one NFT per
/// individual monster and no lookup table.
///
/// Minting: the game server checks the monster is real and signs a voucher
/// (EIP-712 Mint). The player sends it and pays the gas. Traits live off-chain
/// at tokenURI (served by the game), so levelling up costs nothing.
///
/// Trading: both players agree in-game. The partner signs an EIP-712 Swap with
/// their wallet (no gas); the player who asked for the trade submits it and
/// pays the gas. Both tokens move in one call or neither does.
contract StockMonsters is ERC721, Ownable, EIP712 {
    using Strings for uint256;

    bytes32 public constant MINT_TYPEHASH = keccak256("Mint(address to,uint256 tokenId,uint256 deadline)");
    bytes32 public constant SWAP_TYPEHASH = keccak256("Swap(uint256 give,uint256 get,uint256 nonce,uint256 deadline)");

    /// The game server's voucher key. Holds no funds; can only approve mints.
    address public signer;
    /// Bumping your nonce voids every swap you signed and nobody has sent yet.
    mapping(address => uint256) public swapNonce;

    string private _base;        // e.g. https://www.stockmonsters.app/nft/meta/
    string private _contractURI; // collection metadata for marketplaces

    event SignerChanged(address signer);
    event Swapped(uint256 indexed tokenA, uint256 indexed tokenB, address a, address b);
    event SwapsCancelled(address indexed owner, uint256 nonce);
    /// ERC-4906
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    error Expired();
    error BadSignature();
    error NotYourToken();

    constructor(address owner_, address signer_, string memory base_, string memory contractURI_)
        ERC721("Stock Monsters", "STKMON")
        Ownable(owner_)
        EIP712("Stock Monsters", "1")
    {
        signer = signer_;
        _base = base_;
        _contractURI = contractURI_;
        emit SignerChanged(signer_);
    }

    // ---- minting -------------------------------------------------------------

    /// Mints `tokenId` to the caller with a voucher from the game server.
    /// A token can only exist once, so a voucher can't be used twice.
    function mint(uint256 tokenId, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(MINT_TYPEHASH, msg.sender, tokenId, deadline)));
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();
        _mint(msg.sender, tokenId);
    }

    // ---- trading -------------------------------------------------------------

    /// Swaps the caller's `give` for `get`. `signature` is the owner of `get`
    /// agreeing to hand it over for `give` (from their side: give=get, get=give).
    /// Works for smart-contract wallets too (ERC-1271).
    function swap(uint256 give, uint256 get, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        if (ownerOf(give) != msg.sender) revert NotYourToken();
        address other = ownerOf(get);
        uint256 nonce = swapNonce[other];
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SWAP_TYPEHASH, get, give, nonce, deadline)));
        if (!SignatureChecker.isValidSignatureNow(other, digest, signature)) revert BadSignature();
        swapNonce[other] = nonce + 1;
        _transfer(msg.sender, other, give);
        _transfer(other, msg.sender, get);
        emit Swapped(give, get, msg.sender, other);
    }

    /// Voids every swap signature you've given out that hasn't been used.
    function cancelSwaps() external {
        uint256 n = ++swapNonce[msg.sender];
        emit SwapsCancelled(msg.sender, n);
    }

    // ---- metadata ------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_base, tokenId.toString(), ".json");
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0x49064906 || super.supportsInterface(id); // ERC-4906
    }

    /// Nudges marketplaces to re-read traits (e.g. after a batch of level-ups).
    function refreshMetadata(uint256 fromTokenId, uint256 toTokenId) external onlyOwner {
        if (fromTokenId == toTokenId) emit MetadataUpdate(fromTokenId);
        else emit BatchMetadataUpdate(fromTokenId, toTokenId);
    }

    // ---- admin ---------------------------------------------------------------

    function setSigner(address signer_) external onlyOwner {
        signer = signer_;
        emit SignerChanged(signer_);
    }

    function setURIs(string calldata base_, string calldata contractURI_) external onlyOwner {
        _base = base_;
        _contractURI = contractURI_;
        emit BatchMetadataUpdate(0, type(uint256).max);
    }
}
