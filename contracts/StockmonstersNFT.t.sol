// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockmonstersNFT} from "./StockmonstersNFT.sol";

interface Vm {
    function sign(uint256 pk, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 pk) external returns (address);
    function prank(address who) external;
    function expectRevert(bytes calldata) external;
}

contract StockmonstersNFTTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_PK = 0xA11CE;

    StockmonstersNFT nft;
    address player = address(0xBEEF);

    bytes32 constant VOUCHER_TYPEHASH = keccak256(
        "MintVoucher(address player,uint16 dexId,uint8 level,uint8[6] ivs,uint8 natureId,bool shiny,uint64 caughtAt,bytes32 uid)"
    );

    function setUp() public {
        nft = new StockmonstersNFT(vm.addr(SIGNER_PK), "https://stockmonsters.example/meta/");
    }

    function _voucherSig(
        address to, uint16 dexId, uint8 level, uint8[6] memory ivs,
        uint8 natureId, bool shiny, uint64 caughtAt, bytes32 uid, uint256 pk
    ) internal returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Stockmonsters")), block.chainid, address(nft)
        ));
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH, to, dexId, level,
            keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, uid
        ));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_mintWithValidVoucher() public {
        uint8[6] memory ivs = [31, 20, 15, 31, 25, 10];
        bytes memory sig = _voucherSig(player, 4, 12, ivs, 3, true, 1756000000, bytes32(uint256(1)), SIGNER_PK);
        vm.prank(player);
        uint256 id = nft.mintCaught(4, 12, ivs, 3, true, 1756000000, bytes32(uint256(1)), sig);
        require(nft.ownerOf(id) == player, "owner");
        (uint16 dexId,, uint8 ivHp,,,,,, uint8 natureId, bool shiny,) = nft.monsters(id);
        require(dexId == 4 && ivHp == 31 && natureId == 3 && shiny, "data");
    }

    function test_voucherIsSingleUse() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes memory sig = _voucherSig(player, 7, 9, ivs, 0, false, 1756000000, bytes32(uint256(2)), SIGNER_PK);
        vm.prank(player);
        nft.mintCaught(7, 9, ivs, 0, false, 1756000000, bytes32(uint256(2)), sig);
        vm.expectRevert(bytes("VOUCHER_USED"));
        vm.prank(player);
        nft.mintCaught(7, 9, ivs, 0, false, 1756000000, bytes32(uint256(2)), sig);
    }

    function test_rejectsWrongSigner() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes memory sig = _voucherSig(player, 7, 9, ivs, 0, false, 1756000000, bytes32(uint256(3)), 0xBAD);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(player);
        nft.mintCaught(7, 9, ivs, 0, false, 1756000000, bytes32(uint256(3)), sig);
    }

    function test_rejectsVoucherForAnotherPlayer() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes memory sig = _voucherSig(player, 7, 9, ivs, 0, false, 1756000000, bytes32(uint256(4)), SIGNER_PK);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(address(0xD00D)); // not the voucher's player
        nft.mintCaught(7, 9, ivs, 0, false, 1756000000, bytes32(uint256(4)), sig);
    }
}
