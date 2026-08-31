// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deployers} from "./Deployers.sol";

import {StockmonstersNFT} from "./StockmonstersNFT.sol";
import {
    Vm,
    TestLib,
    AcceptingReceiver,
    RejectingReceiver,
    RevertingReceiver,
    NonReceiver
} from "./TestHelpers.sol";

contract StockmonstersNFTTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_PK = 0xA11CE;
    uint64 constant FAR_FUTURE = 4_000_000_000;

    StockmonstersNFT nft;
    address player = address(0xBEEF);
    address stranger = address(0xBAD1);
    address newOwner = address(0x5AFE);

    bytes32 constant VOUCHER_TYPEHASH =
        keccak256("MintVoucher(address player,bytes32 attrCommit,bytes32 uid,uint256 fee,uint64 deadline)");

    // Byte-for-byte copy of the sealed document the contract must emit. If you
    // change the contract's wording you must change it here too — that is the
    // point: the sealed document is a security boundary and it gets a golden test.
    string constant SEALED_DESCRIPTION =
        "A sealed box from the Stockmonsters world. Something was caught and locked inside; only a keccak256 commitment of its attributes exists on-chain. The owner can open it at any time to reveal what is inside - permanently and publicly.";

    function setUp() public {
        nft = Deployers.nft(vm.addr(SIGNER_PK), "ipfs://images/", "ipfs://sealed-box.png", address(this));
        vm.deal(player, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _commit(
        uint16 dexId,
        uint8 level,
        uint8[6] memory ivs,
        uint8 natureId,
        bool shiny,
        uint64 caughtAt,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt)
        );
    }

    function _sig(address to, bytes32 commitment, bytes32 uid, uint256 fee, uint64 deadline, uint256 pk)
        internal
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, to, commitment, uid, fee, deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _mint(address to, bytes32 commitment, bytes32 uid) internal returns (uint256) {
        bytes memory sig = _sig(to, commitment, uid, 0.01 ether, FAR_FUTURE, SIGNER_PK);
        vm.prank(to);
        return nft.mintCaught{value: 0.01 ether}(commitment, uid, 0.01 ether, FAR_FUTURE, sig);
    }

    /// Applion — dexId 1, Flora/Toxic, base 45/49/49/45/65/65 (src/data/dex.json)
    function _registerApplion() internal {
        StockmonstersNFT.SpeciesInput[] memory batch = new StockmonstersNFT.SpeciesInput[](2);
        batch[0] = StockmonstersNFT.SpeciesInput({
            dexId: 1,
            type1: 4, // Flora
            type2: 14, // Toxic
            baseStats: [uint8(45), 49, 49, 45, 65, 65],
            speciesName: "Applion",
            ticker: "AAPL"
        });
        // A single-typed species, to exercise the omitted "Type 2" branch.
        batch[1] = StockmonstersNFT.SpeciesInput({
            dexId: 2,
            type1: 6, // Neutral
            type2: 255,
            baseStats: [uint8(40), 40, 40, 40, 40, 40],
            speciesName: "Loner",
            ticker: "LONE"
        });
        nft.registerSpecies(batch);
    }

    // ------------------------------------------------ group 1: sealed core

    function test_sealedMintThenOpen() public {
        uint8[6] memory ivs = [31, 20, 15, 31, 25, 10];
        bytes32 salt = bytes32(uint256(0xC0FFEE));
        bytes32 commitment = _commit(4, 12, ivs, 3, true, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(1)));

        require(nft.ownerOf(id) == player, "owner");
        require(nft.balanceOf(player) == 1, "balance");
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
        bytes memory sig = _sig(player, commitment, bytes32(uint256(2)), 0.01 ether, FAR_FUTURE, SIGNER_PK);
        vm.expectRevert(bytes("WRONG_FEE"));
        vm.prank(player);
        nft.mintCaught{value: 0.005 ether}(commitment, bytes32(uint256(2)), 0.01 ether, FAR_FUTURE, sig);
    }

    /// The signed fee is authoritative, so a `setClaimFee` cannot brick or
    /// front-run an outstanding voucher.
    function test_signedFeeSurvivesClaimFeeChange() public {
        bytes32 commitment = bytes32(uint256(43));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(43)), 0.01 ether, FAR_FUTURE, SIGNER_PK);
        nft.setClaimFee(5 ether); // owner front-runs the pending mint
        vm.prank(player);
        uint256 id = nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(43)), 0.01 ether, FAR_FUTURE, sig);
        require(nft.ownerOf(id) == player, "voucher still redeemable at its signed price");
    }

    function test_expiredVoucherReverts() public {
        vm.warp(1000);
        bytes32 commitment = bytes32(uint256(44));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(44)), 0.01 ether, 999, SIGNER_PK);
        vm.expectRevert(bytes("VOUCHER_EXPIRED"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(44)), 0.01 ether, 999, sig);
    }

    function test_badRevealReverts() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes32 salt = bytes32(uint256(7));
        bytes32 commitment = _commit(7, 9, ivs, 0, false, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(3)));
        vm.expectRevert(bytes("BAD_REVEAL"));
        vm.prank(player);
        nft.open(id, 7, 99, ivs, 0, false, 1756000000, salt); // tampered level
    }

    function test_badRevealSaltReverts() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes32 commitment = _commit(7, 9, ivs, 0, false, 1756000000, bytes32(uint256(7)));
        uint256 id = _mint(player, commitment, bytes32(uint256(31)));
        vm.expectRevert(bytes("BAD_REVEAL"));
        vm.prank(player);
        nft.open(id, 7, 9, ivs, 0, false, 1756000000, bytes32(uint256(8))); // guessed salt
    }

    function test_openTwiceReverts() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes32 salt = bytes32(uint256(77));
        bytes32 commitment = _commit(1, 9, ivs, 0, false, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(32)));
        vm.prank(player);
        nft.open(id, 1, 9, ivs, 0, false, 1756000000, salt);
        vm.expectRevert(bytes("ALREADY_OPENED"));
        vm.prank(player);
        nft.open(id, 1, 9, ivs, 0, false, 1756000000, salt);
    }

    /// A third party must not be able to spoil a sealed listing, even holding
    /// the correct reveal payload.
    function test_onlyOwnerOrOperatorCanOpen() public {
        uint8[6] memory ivs = [1, 2, 3, 4, 5, 6];
        bytes32 salt = bytes32(uint256(78));
        bytes32 commitment = _commit(1, 9, ivs, 0, false, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(33)));

        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        vm.prank(stranger);
        nft.open(id, 1, 9, ivs, 0, false, 1756000000, salt);

        vm.prank(player);
        nft.setApprovalForAll(stranger, true);
        vm.prank(stranger);
        nft.open(id, 1, 9, ivs, 0, false, 1756000000, salt);
        require(nft.opened(id), "operator may open");
    }

    function test_voucherSingleUseAndWrongSigner() public {
        bytes32 commitment = bytes32(uint256(9));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(4)), 0.01 ether, FAR_FUTURE, SIGNER_PK);
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(4)), 0.01 ether, FAR_FUTURE, sig);
        vm.expectRevert(bytes("VOUCHER_USED"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(4)), 0.01 ether, FAR_FUTURE, sig);

        bytes memory badSig = _sig(player, commitment, bytes32(uint256(5)), 0.01 ether, FAR_FUTURE, 0xBAD);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(5)), 0.01 ether, FAR_FUTURE, badSig);
    }

    /// The voucher binds the player, so a watcher cannot steal a mint out of
    /// the mempool.
    function test_voucherIsBoundToPlayer() public {
        bytes32 commitment = bytes32(uint256(11));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(12)), 0.01 ether, FAR_FUTURE, SIGNER_PK);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(stranger);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(12)), 0.01 ether, FAR_FUTURE, sig);
    }

    function test_malleableSignatureRejected() public {
        bytes32 commitment = bytes32(uint256(13));
        bytes memory sig = _sig(player, commitment, bytes32(uint256(14)), 0.01 ether, FAR_FUTURE, SIGNER_PK);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        // s' = n - s, v flipped: a different-looking signature over the same digest.
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(bytes("BAD_SIG_S"));
        vm.prank(player);
        nft.mintCaught{value: 0.01 ether}(commitment, bytes32(uint256(14)), 0.01 ether, FAR_FUTURE, malleable);
    }

    // --------------------------------------- group 2: the sealed-box invariant

    /// Nothing readable on-chain may distinguish two sealed boxes with wildly
    /// different contents. This is the product's core promise.
    function test_sealedBoxLeaksNothing() public {
        _registerApplion();
        uint8[6] memory maxIvs = [31, 31, 31, 31, 31, 31];
        uint8[6] memory minIvs = [0, 0, 0, 0, 0, 0];
        uint256 a = _mint(player, _commit(1, 100, maxIvs, 0, true, 1756000000, bytes32(uint256(1))), bytes32(uint256(101)));
        uint256 b = _mint(player, _commit(2, 1, minIvs, 24, false, 1, bytes32(uint256(2))), bytes32(uint256(102)));

        // 1. the struct getter is all zeros
        _requireMonsterStructEmpty(a);
        _requireMonsterStructEmpty(b);

        // 2. derived views refuse to answer
        vm.expectRevert(bytes("SEALED"));
        nft.finalStats(a);

        // 3. the raw storage slot behind monsters[a] is untouched
        bytes32 slot = keccak256(abi.encode(a, uint256(4))); // mapping(uint256=>Monster) monsters
        require(vm.load(address(nft), slot) == bytes32(0), "no monster storage while sealed");

        // 4. the metadata documents are byte-identical apart from the id
        string memory jsonA = TestLib.decodeTokenURI(nft.tokenURI(a));
        string memory jsonB = TestLib.decodeTokenURI(nft.tokenURI(b));
        require(TestLib.eq(jsonA, _expectedSealedJson(a)), "sealed doc A is the golden document");
        require(TestLib.eq(jsonB, _expectedSealedJson(b)), "sealed doc B is the golden document");
        require(!TestLib.contains(jsonA, "Applion"), "no species leak");
        require(!TestLib.contains(jsonA, "AAPL"), "no ticker leak");
        require(!TestLib.contains(jsonA, "Shiny"), "no shiny leak");
        require(!TestLib.contains(jsonA, "Level"), "no level leak");
        require(!TestLib.contains(jsonA, "IV"), "no iv leak");

        // 5. two boxes with identical contents but different salts are not
        //    linkable by their commitments either
        bytes32 c1 = _commit(1, 100, maxIvs, 0, true, 1756000000, bytes32(uint256(9)));
        bytes32 c2 = _commit(1, 100, maxIvs, 0, true, 1756000000, bytes32(uint256(10)));
        require(c1 != c2, "salt hides duplicates");
    }

    function _requireMonsterStructEmpty(uint256 id) internal view {
        (
            uint16 dexId,
            uint8 level,
            uint8 ivHp,
            uint8 ivAtk,
            uint8 ivDfe,
            uint8 ivSpd,
            uint8 ivAts,
            uint8 ivDfs,
            uint8 natureId,
            bool shiny,
            uint64 caughtAt
        ) = nft.monsters(id);
        require(
            dexId == 0 && level == 0 && ivHp == 0 && ivAtk == 0 && ivDfe == 0 && ivSpd == 0 && ivAts == 0
                && ivDfs == 0 && natureId == 0 && !shiny && caughtAt == 0,
            "sealed monster struct must be empty"
        );
    }

    function _expectedSealedJson(uint256 id) internal view returns (string memory) {
        return string.concat(
            '{"name":"Sealed Stockmonster Box #',
            _dec(id),
            '","description":"',
            SEALED_DESCRIPTION,
            '","image":"',
            nft.sealedImageURI(),
            '","attributes":[{"trait_type":"State","value":"Sealed"}]}'
        );
    }

    function _dec(uint256 value) internal pure returns (string memory) {
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

    // ------------------------------------------------ group 3: access control

    function test_accessControl_setGameSigner() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.setGameSigner(stranger);
    }

    function test_accessControl_setClaimFee() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.setClaimFee(1 ether);
    }

    function test_accessControl_setImageBaseURI() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.setImageBaseURI("evil://");
    }

    function test_accessControl_setSealedImageURI() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.setSealedImageURI("evil://");
    }

    function test_accessControl_withdraw() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.withdraw(payable(stranger));
    }

    function test_accessControl_setDefaultRoyalty() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.setDefaultRoyalty(stranger, 500);
    }

    function test_accessControl_registerSpecies() public {
        StockmonstersNFT.SpeciesInput[] memory batch = new StockmonstersNFT.SpeciesInput[](1);
        batch[0] = StockmonstersNFT.SpeciesInput({
            dexId: 1,
            type1: 0,
            type2: 255,
            baseStats: [uint8(1), 1, 1, 1, 1, 1],
            speciesName: "Fake",
            ticker: "FAKE"
        });
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.registerSpecies(batch);
    }

    function test_accessControl_freezeSpecies() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.freezeSpecies();
    }

    function test_accessControl_transferOwnership() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        nft.transferOwnership(stranger);
    }

    function test_withdraw() public {
        _mint(player, bytes32(uint256(10)), bytes32(uint256(6)));
        address payable sink = payable(address(0xCA5A));
        nft.withdraw(sink);
        require(sink.balance == 0.01 ether, "withdrawn");
    }

    // -------------------------------------------------- group 4: ownership

    function test_twoStepOwnershipTransfer() public {
        require(nft.owner() == address(this), "deployer owns");
        nft.transferOwnership(newOwner);
        require(nft.owner() == address(this), "not transferred until accepted");
        require(nft.pendingOwner() == newOwner, "pending set");

        vm.expectRevert(bytes("NOT_PENDING_OWNER"));
        vm.prank(stranger);
        nft.acceptOwnership();

        vm.prank(newOwner);
        nft.acceptOwnership();
        require(nft.owner() == newOwner, "transferred");
        require(nft.pendingOwner() == address(0), "pending cleared");

        // the old owner is now powerless
        vm.expectRevert(bytes("NOT_OWNER"));
        nft.setClaimFee(1 ether);
    }

    function test_ownershipHandoverCanBeCancelled() public {
        nft.transferOwnership(newOwner);
        nft.transferOwnership(address(0));
        vm.expectRevert(bytes("NOT_PENDING_OWNER"));
        vm.prank(newOwner);
        nft.acceptOwnership();
        require(nft.owner() == address(this), "still ours");
    }

    // -------------------------------------------------- group 5: royalties

    function test_royaltyDefaultsToNone() public {
        uint256 id = _mint(player, bytes32(uint256(20)), bytes32(uint256(20)));
        (address receiver, uint256 amount) = nft.royaltyInfo(id, 1 ether);
        require(receiver == address(0) && amount == 0, "no royalty by default");
        vm.expectRevert(bytes("NOT_MINTED"));
        nft.royaltyInfo(999, 1 ether);
        vm.expectRevert(bytes("ZERO_RECEIVER"));
        nft.setDefaultRoyalty(address(0), 500);
    }

    function test_royaltyMathAndCap() public {
        uint256 id = _mint(player, bytes32(uint256(21)), bytes32(uint256(21)));
        address receiver = address(0xF00D);
        nft.setDefaultRoyalty(receiver, 750); // 7.5%
        (address r, uint256 amount) = nft.royaltyInfo(id, 1 ether);
        require(r == receiver && amount == 0.075 ether, "7.5% of 1 ETH");

        (, uint256 odd) = nft.royaltyInfo(id, 12345);
        require(odd == 925, "rounds down: 12345 * 750 / 10000 = 925.875 -> 925");

        vm.expectRevert(bytes("ROYALTY_TOO_HIGH"));
        nft.setDefaultRoyalty(receiver, 1001);

        nft.setDefaultRoyalty(receiver, nft.MAX_ROYALTY_BPS()); // exactly at the cap is fine
    }

    function test_supportsInterface() public view {
        require(nft.supportsInterface(0x01ffc9a7), "ERC-165");
        require(nft.supportsInterface(0x80ac58cd), "ERC-721");
        require(nft.supportsInterface(0x5b5e139f), "ERC-721 Metadata");
        require(nft.supportsInterface(0x2a55205a), "ERC-2981");
        require(!nft.supportsInterface(0xffffffff), "ERC-165 sentinel must be false");
        require(!nft.supportsInterface(0xdeadbeef), "unknown");
    }

    // ------------------------------------------- group 6: ERC-721 conformance

    function test_safeTransferFromToEOA() public {
        uint256 id = _mint(player, bytes32(uint256(30)), bytes32(uint256(40)));
        vm.prank(player);
        nft.safeTransferFrom(player, stranger, id);
        require(nft.ownerOf(id) == stranger, "moved");
        require(nft.balanceOf(player) == 0 && nft.balanceOf(stranger) == 1, "balances");
    }

    function test_safeTransferFromToAcceptingContract() public {
        AcceptingReceiver rx = new AcceptingReceiver();
        uint256 id = _mint(player, bytes32(uint256(31)), bytes32(uint256(41)));
        vm.prank(player);
        nft.safeTransferFrom(player, address(rx), id, hex"1234");
        require(nft.ownerOf(id) == address(rx), "moved");
        require(rx.lastOperator() == player && rx.lastFrom() == player && rx.lastTokenId() == id, "hook args");
        require(keccak256(rx.lastData()) == keccak256(hex"1234"), "hook data");
    }

    function test_safeTransferFromToRejectingContractReverts() public {
        RejectingReceiver rx = new RejectingReceiver();
        uint256 id = _mint(player, bytes32(uint256(32)), bytes32(uint256(42)));
        vm.expectRevert(bytes("UNSAFE_RECIPIENT"));
        vm.prank(player);
        nft.safeTransferFrom(player, address(rx), id);
        require(nft.ownerOf(id) == player, "not moved");
    }

    function test_safeTransferFromBubblesReceiverRevert() public {
        RevertingReceiver rx = new RevertingReceiver();
        uint256 id = _mint(player, bytes32(uint256(33)), bytes32(uint256(43)));
        vm.expectRevert(bytes("I_HATE_NFTS"));
        vm.prank(player);
        nft.safeTransferFrom(player, address(rx), id);
    }

    function test_safeTransferFromToNonReceiverReverts() public {
        NonReceiver rx = new NonReceiver();
        uint256 id = _mint(player, bytes32(uint256(34)), bytes32(uint256(44)));
        vm.expectRevert(bytes("UNSAFE_RECIPIENT"));
        vm.prank(player);
        nft.safeTransferFrom(player, address(rx), id);
    }

    function test_plainTransferFromToNonReceiverStillWorks() public {
        NonReceiver rx = new NonReceiver();
        uint256 id = _mint(player, bytes32(uint256(35)), bytes32(uint256(45)));
        vm.prank(player);
        nft.transferFrom(player, address(rx), id);
        require(nft.ownerOf(id) == address(rx), "unsafe transfer is still allowed");
    }

    function test_transferFromUnauthorizedReverts() public {
        uint256 id = _mint(player, bytes32(uint256(36)), bytes32(uint256(46)));
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        vm.prank(stranger);
        nft.transferFrom(player, stranger, id);
    }

    function test_approvalIsClearedOnTransfer() public {
        uint256 id = _mint(player, bytes32(uint256(37)), bytes32(uint256(47)));
        vm.prank(player);
        nft.approve(stranger, id);
        require(nft.getApproved(id) == stranger, "approved");
        vm.prank(stranger);
        nft.transferFrom(player, stranger, id);
        require(nft.getApproved(id) == address(0), "approval cleared");
    }

    function test_transferOfNonexistentTokenReverts() public {
        vm.expectRevert(bytes("NOT_MINTED"));
        nft.transferFrom(address(0), stranger, 999);
        vm.expectRevert(bytes("NOT_MINTED"));
        nft.approve(stranger, 999);
        vm.expectRevert(bytes("NOT_MINTED"));
        nft.ownerOf(999);
    }

    // ------------------------------------------ group 7: species + metadata

    function test_registerSpeciesValidatesTypes() public {
        StockmonstersNFT.SpeciesInput[] memory batch = new StockmonstersNFT.SpeciesInput[](1);
        batch[0] = StockmonstersNFT.SpeciesInput({
            dexId: 3,
            type1: 18,
            type2: 255,
            baseStats: [uint8(1), 1, 1, 1, 1, 1],
            speciesName: "Bad",
            ticker: "BAD"
        });
        vm.expectRevert(bytes("BAD_TYPE1"));
        nft.registerSpecies(batch);

        batch[0].type1 = 0;
        batch[0].type2 = 18;
        vm.expectRevert(bytes("BAD_TYPE2"));
        nft.registerSpecies(batch);
    }

    function test_speciesFreezeIsPermanent() public {
        _registerApplion();
        require(nft.speciesCount() == 2, "two species");
        nft.freezeSpecies();
        StockmonstersNFT.SpeciesInput[] memory batch = new StockmonstersNFT.SpeciesInput[](1);
        batch[0] = StockmonstersNFT.SpeciesInput({
            dexId: 1,
            type1: 0,
            type2: 255,
            baseStats: [uint8(255), 255, 255, 255, 255, 255],
            speciesName: "Rugged",
            ticker: "RUG"
        });
        vm.expectRevert(bytes("SPECIES_FROZEN"));
        nft.registerSpecies(batch);
    }

    /// Reference line computed by hand from docs/psdk-mechanics.md §2.1 for
    /// Applion at level 50, 31 IVs, Adamant (+atk / -ats).
    function test_finalStatsMatchPsdkFormula() public {
        _registerApplion();
        uint8[6] memory ivs = [31, 31, 31, 31, 31, 31];
        bytes32 salt = bytes32(uint256(1234));
        bytes32 commitment = _commit(1, 50, ivs, 0, false, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(60)));
        vm.prank(player);
        nft.open(id, 1, 50, ivs, 0, false, 1756000000, salt);

        uint16[6] memory st = nft.finalStats(id);
        require(st[0] == 120, "hp");
        require(st[1] == 75, "atk (adamant +10%)");
        require(st[2] == 69, "dfe");
        require(st[3] == 65, "spd");
        require(st[4] == 76, "ats (adamant -10%)");
        require(st[5] == 85, "dfs");
    }

    /// The same creature with a neutral nature must differ in exactly the two
    /// stats the nature touches.
    function test_natureModifiesTheRightStats() public {
        _registerApplion();
        uint8[6] memory ivs = [31, 31, 31, 31, 31, 31];
        bytes32 s1 = bytes32(uint256(1));
        bytes32 c1 = _commit(1, 50, ivs, 8, false, 1, s1); // hardy = neutral
        uint256 id = _mint(player, c1, bytes32(uint256(61)));
        vm.prank(player);
        nft.open(id, 1, 50, ivs, 8, false, 1, s1);
        uint16[6] memory st = nft.finalStats(id);
        require(st[1] == 69 && st[4] == 85, "neutral nature leaves the basis alone");
        require(TestLib.eq(nft.natureName(8), "Hardy"), "nature name");
        require(TestLib.eq(nft.natureName(0), "Adamant"), "nature name 0");
        require(TestLib.eq(nft.natureName(24), "Timid"), "nature name 24");
        require(TestLib.eq(nft.typeName(0), "Alloy") && TestLib.eq(nft.typeName(17), "Wyrm"), "type names");
    }

    function test_openedTokenURI() public {
        _registerApplion();
        uint8[6] memory ivs = [31, 20, 15, 31, 25, 10];
        bytes32 salt = bytes32(uint256(555));
        bytes32 commitment = _commit(1, 50, ivs, 0, true, 1756000000, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(62)));
        vm.prank(player);
        nft.open(id, 1, 50, ivs, 0, true, 1756000000, salt);

        string memory json = TestLib.decodeTokenURI(nft.tokenURI(id));
        require(TestLib.contains(json, '"name":"Applion #'), "name");
        require(TestLib.contains(json, '"image":"ipfs://images/AAPL/shiny.png"'), "shiny image path");
        require(TestLib.contains(json, '{"trait_type":"State","value":"Opened"}'), "state");
        require(TestLib.contains(json, '{"trait_type":"Type 1","value":"Flora"}'), "type 1");
        require(TestLib.contains(json, '{"trait_type":"Type 2","value":"Toxic"}'), "type 2");
        require(TestLib.contains(json, '{"trait_type":"Nature","value":"Adamant"}'), "nature");
        require(TestLib.contains(json, '{"trait_type":"Shiny","value":"Yes"}'), "shiny");
        require(TestLib.contains(json, '{"trait_type":"IVs","value":"31/20/15/31/25/10"}'), "ivs");
        require(TestLib.contains(json, '"trait_type":"IV Total","value":132'), "iv total");
        require(TestLib.contains(json, '"trait_type":"Level","value":50'), "level");
        require(TestLib.contains(json, '"display_type":"date","trait_type":"Caught","value":1756000000'), "caught");
    }

    function test_openedTokenURI_singleTypedOmitsType2() public {
        _registerApplion();
        uint8[6] memory ivs = [1, 1, 1, 1, 1, 1];
        bytes32 salt = bytes32(uint256(556));
        bytes32 commitment = _commit(2, 5, ivs, 8, false, 1, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(63)));
        vm.prank(player);
        nft.open(id, 2, 5, ivs, 8, false, 1, salt);

        string memory json = TestLib.decodeTokenURI(nft.tokenURI(id));
        require(TestLib.contains(json, '{"trait_type":"Type 1","value":"Neutral"}'), "type 1");
        require(!TestLib.contains(json, '"Type 2"'), "single-typed omits Type 2");
        require(TestLib.contains(json, '"image":"ipfs://images/LONE/regular.png"'), "regular image path");
        // and the JSON is still well-formed: no double comma where Type 2 was
        require(!TestLib.contains(json, ",,"), "no dangling comma");
    }

    /// tools/register-species.mjs ships the 254-entry roster in batches of 40.
    /// Prove that a full batch is nowhere near a block's worth of gas.
    function test_registerBatchOfFortyFitsInABlock() public {
        StockmonstersNFT.SpeciesInput[] memory batch = new StockmonstersNFT.SpeciesInput[](40);
        for (uint16 i = 0; i < 40; i++) {
            batch[i] = StockmonstersNFT.SpeciesInput({
                dexId: i + 1,
                type1: uint8(i % 18),
                type2: i % 2 == 0 ? 255 : uint8((i + 3) % 18),
                baseStats: [uint8(45), 49, 49, 45, 65, 65],
                speciesName: "Stockmonster", // the longest name in dex.json is 12 chars
                ticker: "TICKER12" // the longest ticker is 8
            });
        }
        uint256 before = gasleft();
        nft.registerSpecies(batch);
        uint256 used = before - gasleft();
        require(nft.speciesCount() == 40, "all registered");
        require(used < 10_000_000, "a batch of 40 must fit comfortably in one block");
    }

    /// The commitment does not constrain dexId, so a box can be opened onto a
    /// species the registry has never heard of. tokenURI must still render —
    /// a reverting tokenURI would make the token invisible everywhere.
    function test_openedUnknownSpeciesStillRenders() public {
        uint8[6] memory ivs = [5, 5, 5, 5, 5, 5];
        bytes32 salt = bytes32(uint256(999));
        bytes32 commitment = _commit(60000, 7, ivs, 1, false, 42, salt);
        uint256 id = _mint(player, commitment, bytes32(uint256(64)));
        vm.prank(player);
        nft.open(id, 60000, 7, ivs, 1, false, 42, salt);

        vm.expectRevert(bytes("SPECIES_UNKNOWN"));
        nft.finalStats(id);

        string memory json = TestLib.decodeTokenURI(nft.tokenURI(id));
        require(TestLib.contains(json, '{"trait_type":"Species","value":"Unregistered"}'), "degraded doc");
        require(TestLib.contains(json, '{"trait_type":"IVs","value":"5/5/5/5/5/5"}'), "still shows what it knows");
    }

    /// The on-chain renderer is the thing most likely to push us over EIP-170.
    /// Fail here rather than at deploy time on mainnet.
    function test_runtimeCodeSizeUnderEip170() public view {
        uint256 size = address(nft).code.length;
        require(size <= 24_576, "EIP-170: this contract would not deploy");
    }

    function test_tokenURIOfUnmintedReverts() public {
        vm.expectRevert(bytes("NOT_MINTED"));
        nft.tokenURI(1);
    }
}
