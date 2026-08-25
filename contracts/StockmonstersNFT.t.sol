// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockmonstersNFT} from "./StockmonstersNFT.sol";

interface Vm {
    function sign(uint256 pk, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 pk) external returns (address);
    function prank(address who) external;
    function deal(address who, uint256 amount) external;
    function expectRevert(bytes calldata) external;
}

contract StockmonstersNFTTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_PK = 0xA11CE;

    StockmonstersNFT nft;
    address player = address(0xBEEF);

    bytes32 constant VOUCHER_TYPEHASH =
        keccak256("MintVoucher(address player,bytes32 attrCommit,bytes32 uid)");

    function setUp() public {
        nft = new StockmonstersNFT(vm.addr(SIGNER_PK), "https://stockmonsters.example/meta/");
        vm.deal(player, 1 ether);
    }

    function _commit(
        uint16 dexId, uint8 level, uint8[6] memory ivs,
        uint8 natureId, bool shiny, uint64 caughtAt, bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt
        ));
    }

    function _sig(address to, bytes32 commitment, bytes32 uid, uint256 pk) internal returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Stockmonsters")), block.chainid, address(nft)
        ));
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, to, commitment, uid));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_sealedMintThenOpen() public {
        uint8[6] memory ivs = [31, 20, 15, 31, 25, 10];
        bytes32 salt = bytes32(uint256(0xC0FFEE));
        bytes32 commitment = _commit(4, 12, ivs, 3, true, 1756000000, salt);
        bytes memory sig = _sig(player, commitment, bytes32(uint256(1)), SIGNER_PK);

        vm.prank(player);
        uint256 id = nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(1)), sig);
        require(nft.ownerOf(id) == player, "owner");
        require(!nft.opened(id), "should be sealed");
        (uint16 dexBefore,,,,,,,,,,) = nft.monsters(id);
        require(dexBefore == 0, "attributes must be hidden while sealed");

        vm.prank(player);
        nft.open(id, 4, 12, ivs, 3, true, 1756000000, salt);
        require(nft.opened(id), "opened");
        (uint16 dexId,, uint8 ivHp,,,,,,, bool shiny,) = nft.monsters(id);
        require(dexId == 4 && ivHp == 31 && shiny, "revealed data");
    }

    function test_wrongFeeReverts() public {
        bytes32 commitment = bytes32(uint256(42));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(2)), SIGNER_PK);
        vm.expectRevert(bytes("WRONG_FEE"));
        vm.prank(player);
        nft.mintCaught{value: 0.005 ether}(commitment, bytes32(uint256(2)), sig);
    }

    function test_badRevealReverts() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes32 salt = bytes32(uint256(7));
        bytes32 commitment = _commit(7, 9, ivs, 0, false, 1756000000, salt);
        bytes memory sig = _sig(player, commitment, bytes32(uint256(3)), SIGNER_PK);
        vm.prank(player);
        uint256 id = nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(3)), sig);
        vm.expectRevert(bytes("BAD_REVEAL"));
        vm.prank(player);
        nft.open(id, 7, 99, ivs, 0, false, 1756000000, salt); // tampered level
    }

    function test_voucherSingleUseAndWrongSigner() public {
        bytes32 commitment = bytes32(uint256(9));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(4)), SIGNER_PK);
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(4)), sig);
        vm.expectRevert(bytes("VOUCHER_USED"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(4)), sig);

        bytes memory badSig = _sig(player, commitment, bytes32(uint256(5)), 0xBAD);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(5)), badSig);
    }

    function test_withdraw() public {
        bytes32 commitment = bytes32(uint256(10));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(6)), SIGNER_PK);
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(6)), sig);
        address payable sink = payable(address(0xCA5A));
        nft.withdraw(sink);
        require(sink.balance == 0.01 ether, "withdrawn");
    }
}
