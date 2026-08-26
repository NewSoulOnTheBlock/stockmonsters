// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockmonstersNFT} from "./StockmonstersNFT.sol";
import {StockmonstersMarket} from "./StockmonstersMarket.sol";
import {Vm, EthRefuser} from "./TestHelpers.sol";

/// Buys, then tries to buy the same order again from inside onERC721Received.
/// Records whether the re-entry succeeded instead of propagating the revert,
/// so the outer fill can complete and the test can inspect the aftermath.
contract ReentrantBuyer {
    StockmonstersMarket public market;
    StockmonstersMarket.Order internal order;
    bytes internal sig;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    constructor(StockmonstersMarket _market) {
        market = _market;
    }

    function arm(StockmonstersMarket.Order calldata o, bytes calldata signature) external {
        order = o;
        sig = signature;
    }

    function buy(StockmonstersMarket.Order calldata o, bytes calldata signature) external payable {
        market.fillOrder{value: msg.value}(o, signature);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        attempted = true;
        // Exactly the order price, so the re-entry is stopped by the guard and
        // not by an accidental WRONG_PRICE.
        (bool ok, bytes memory data) = address(market).call{value: order.price}(
            abi.encodeWithSelector(StockmonstersMarket.fillOrder.selector, order, sig)
        );
        reentrySucceeded = ok;
        reentryRevertData = data;
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

contract StockmonstersMarketTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_PK = 0xA11CE;
    uint256 constant SELLER_PK = 0x5E11E4;
    uint64 constant FAR_FUTURE = 4_000_000_000;

    StockmonstersNFT nft;
    StockmonstersMarket market;

    address seller;
    address buyer = address(0xB0B);
    address treasury = address(0x7EA);
    address royaltyReceiver = address(0xF00D);
    address stranger = address(0xBAD1);

    bytes32 constant VOUCHER_TYPEHASH =
        keccak256("MintVoucher(address player,bytes32 attrCommit,bytes32 uid,uint256 fee,uint64 deadline)");

    uint8[6] ivs = [31, 20, 15, 31, 25, 10];
    bytes32 constant SALT = bytes32(uint256(0xC0FFEE));
    bytes32 commitment;
    uint256 tokenId;

    function setUp() public {
        seller = vm.addr(SELLER_PK);
        nft = new StockmonstersNFT(vm.addr(SIGNER_PK), "ipfs://images/", "ipfs://sealed.png");
        market = new StockmonstersMarket(address(nft), treasury, 250); // 2.5%
        nft.setDefaultRoyalty(royaltyReceiver, 500); // 5%

        vm.deal(seller, 10 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(stranger, 100 ether);
        vm.warp(1_000_000);

        commitment = _commit(1, 50, ivs, 0, true, 1756000000, SALT);
        tokenId = _mintTo(seller, commitment, bytes32(uint256(1)));
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
    }

    // ---------------------------------------------------------------- helpers

    function _commit(
        uint16 dexId,
        uint8 level,
        uint8[6] memory _ivs,
        uint8 natureId,
        bool shiny,
        uint64 caughtAt,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(dexId, level, keccak256(abi.encodePacked(_ivs)), natureId, shiny, caughtAt, salt)
        );
    }

    function _mintTo(address to, bytes32 c, bytes32 uid) internal returns (uint256) {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, to, c, uid, uint256(0.01 ether), FAR_FUTURE));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_PK, keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash)));
        vm.prank(to);
        return nft.mintCaught{value: 0.01 ether}(c, uid, 0.01 ether, FAR_FUTURE, abi.encodePacked(r, s, v));
    }

    function _order(uint256 price) internal view returns (StockmonstersMarket.Order memory o) {
        o = StockmonstersMarket.Order({
            seller: seller,
            tokenId: tokenId,
            price: price,
            minProceeds: 0,
            deadline: FAR_FUTURE,
            epoch: market.epochOf(seller),
            salt: 1,
            requireSealed: true,
            attrCommit: commitment,
            taker: address(0),
            currency: address(0)
        });
    }

    function _sign(StockmonstersMarket.Order memory o, uint256 pk) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, market.hashOrder(o));
        return abi.encodePacked(r, s, v);
    }

    function _openBox() internal {
        vm.prank(seller);
        nft.open(tokenId, 1, 50, ivs, 0, true, 1756000000, SALT);
    }

    // ------------------------------------------------- group 1: happy path

    function test_happyPathFillPaysEveryone() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);

        uint256 sellerBefore = seller.balance;
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);

        require(nft.ownerOf(tokenId) == buyer, "buyer owns the box");
        require(treasury.balance == 0.025 ether, "2.5% protocol fee");
        require(royaltyReceiver.balance == 0.05 ether, "5% ERC-2981 royalty");
        require(seller.balance == sellerBefore + 0.925 ether, "seller gets the rest");
        require(address(market).balance == 0, "market keeps nothing");
        require(market.orderConsumed(market.hashOrder(o)), "order consumed");
    }

    /// Every wei is accounted for at an awkward price, and the market never
    /// keeps dust.
    function test_feeAndRoyaltyArithmeticIsExact() public {
        uint256 price = 12_345_678_901_234_567; // deliberately indivisible
        StockmonstersMarket.Order memory o = _order(price);
        bytes memory sig = _sign(o, SELLER_PK);

        uint256 sellerBefore = seller.balance;
        vm.prank(buyer);
        market.fillOrder{value: price}(o, sig);

        uint256 expectedFee = (price * 250) / 10_000;
        uint256 expectedRoyalty = (price * 500) / 10_000;
        require(treasury.balance == expectedFee, "fee floors");
        require(royaltyReceiver.balance == expectedRoyalty, "royalty floors");
        require(seller.balance - sellerBefore == price - expectedFee - expectedRoyalty, "seller absorbs the dust");
        require(
            treasury.balance + royaltyReceiver.balance + (seller.balance - sellerBefore) == price,
            "no wei created or destroyed"
        );
        require(address(market).balance == 0, "no dust left behind");
    }

    function test_zeroFeeAndZeroRoyalty() public {
        market.setFee(treasury, 0);
        nft.setDefaultRoyalty(address(0), 0);
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        uint256 before = seller.balance;
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        require(seller.balance == before + 1 ether, "seller gets everything");
        require(treasury.balance == 0 && royaltyReceiver.balance == 0, "nobody else paid");
    }

    // -------------------------------------- group 2: the sealed-box crux

    /// THE crux. The seller holds the reveal payload and knows what is in the
    /// box. Seeing a fill in the mempool they open it, then let the sale land
    /// at the sealed price. The order binds `requireSealed`, so it cannot.
    function test_sellerOpensBoxToFrontRunSealedFill_reverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);

        _openBox(); // the seller front-runs the buyer's fill

        vm.expectRevert(bytes("SEAL_STATE_MISMATCH"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        require(nft.ownerOf(tokenId) == seller, "no sale happened");
    }

    /// And the mirror image: an order priced for an OPENED token cannot be
    /// filled while the box is still sealed.
    function test_openedPricedOrderCannotFillSealedToken_reverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.requireSealed = false;
        bytes memory sig = _sign(o, SELLER_PK);

        vm.expectRevert(bytes("SEAL_STATE_MISMATCH"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_openedTokenSellsWithRequireSealedFalse() public {
        _openBox();
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.requireSealed = false;
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        require(nft.ownerOf(tokenId) == buyer, "opened tokens trade too");
    }

    function test_wrongAttrCommitReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.attrCommit = bytes32(uint256(0xDEAD));
        bytes memory sig = _sign(o, SELLER_PK);
        vm.expectRevert(bytes("COMMIT_MISMATCH"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    // ------------------------------------ group 3: order lifecycle negatives

    function test_expiredOrderReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.deadline = uint64(block.timestamp - 1);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.expectRevert(bytes("ORDER_EXPIRED"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_cancelledOrderReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(seller);
        market.cancelOrder(o);
        vm.expectRevert(bytes("ORDER_CONSUMED"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_onlySellerCancels() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        vm.expectRevert(bytes("NOT_SELLER"));
        vm.prank(stranger);
        market.cancelOrder(o);
    }

    function test_epochBumpMassCancels() public {
        StockmonstersMarket.Order memory o1 = _order(1 ether);
        StockmonstersMarket.Order memory o2 = _order(2 ether);
        o2.salt = 2;
        bytes memory sig1 = _sign(o1, SELLER_PK);
        bytes memory sig2 = _sign(o2, SELLER_PK);

        vm.prank(seller);
        market.incrementEpoch();

        vm.expectRevert(bytes("ORDER_STALE"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o1, sig1);
        vm.expectRevert(bytes("ORDER_STALE"));
        vm.prank(buyer);
        market.fillOrder{value: 2 ether}(o2, sig2);
    }

    function test_orderCannotBeFilledTwice() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        // buyer now owns it, so even the consumed check aside, the seller no
        // longer owns the token — but the consumed bit fires first.
        vm.expectRevert(bytes("ORDER_CONSUMED"));
        vm.prank(stranger);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_wrongPriceReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.expectRevert(bytes("WRONG_PRICE"));
        vm.prank(buyer);
        market.fillOrder{value: 0.9 ether}(o, sig);
        vm.expectRevert(bytes("WRONG_PRICE"));
        vm.prank(buyer);
        market.fillOrder{value: 1.1 ether}(o, sig); // overpaying is a mistake, not a tip
    }

    function test_wrongSignerReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, 0xBAD); // not the seller's key
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_tamperedOrderReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        o.price = 0.1 ether; // buyer tries to pay a tenth
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        vm.prank(buyer);
        market.fillOrder{value: 0.1 ether}(o, sig);
    }

    function test_malleableOrderSignatureRejected() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_PK, market.hashOrder(o));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(bytes("BAD_SIG_S"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, malleable);
    }

    function test_privateOrderOnlyFillableByTaker() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.taker = buyer;
        bytes memory sig = _sign(o, SELLER_PK);
        vm.expectRevert(bytes("NOT_TAKER"));
        vm.prank(stranger);
        market.fillOrder{value: 1 ether}(o, sig);
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        require(nft.ownerOf(tokenId) == buyer, "named taker may fill");
    }

    function test_selfFillReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.expectRevert(bytes("SELF_FILL"));
        vm.prank(seller);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    /// The token moved between listing and fill: the order dies.
    function test_sellerNoLongerOwnsTokenReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(seller);
        nft.transferFrom(seller, stranger, tokenId);
        vm.expectRevert(bytes("SELLER_NOT_OWNER"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    /// Revoking the approval is the seller's off-chain-cheap panic button; it
    /// does not invalidate the signature, only the transfer.
    function test_revokedApprovalReverts() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(seller);
        nft.setApprovalForAll(address(market), false);
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    // ---------------------------------------- group 4: payout safety

    function test_reentrantBuyerCannotDoubleFill() public {
        ReentrantBuyer attacker = new ReentrantBuyer(market);
        vm.deal(address(attacker), 2 ether); // enough to pay the price twice

        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        attacker.arm(o, sig);

        uint256 sellerBefore = seller.balance;
        attacker.buy{value: 1 ether}(o, sig);

        require(attacker.attempted(), "the hook did try to re-enter");
        require(!attacker.reentrySucceeded(), "re-entry must fail");
        require(
            keccak256(attacker.reentryRevertData())
                == keccak256(abi.encodeWithSignature("Error(string)", "REENTRANCY")),
            "stopped by the guard, not by accident"
        );
        require(nft.ownerOf(tokenId) == address(attacker), "exactly one transfer");
        require(seller.balance == sellerBefore + 0.925 ether, "seller paid exactly once");
        require(address(market).balance == 0, "market drained of nothing");
    }

    /// A payee whose `receive` reverts must not be able to brick the sale.
    function test_revertingPayeeFallsBackToPullPayment() public {
        EthRefuser refuser = new EthRefuser();
        market.setFee(address(refuser), 250);

        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig); // must NOT revert

        require(nft.ownerOf(tokenId) == buyer, "sale completed");
        require(market.pendingWithdrawals(address(refuser)) == 0.025 ether, "credited to the pull ledger");
        require(address(market).balance == 0.025 ether, "held in escrow for the payee");

        refuser.setAccepting(true);
        refuser.callWithdraw(address(market));
        require(address(refuser).balance == 0.025 ether, "pulled");
        require(market.pendingWithdrawals(address(refuser)) == 0, "ledger cleared");
    }

    function test_withdrawPaymentsWithNothingPendingReverts() public {
        vm.expectRevert(bytes("NOTHING_PENDING"));
        vm.prank(stranger);
        market.withdrawPayments();
    }

    // ------------------------------- group 5: fees, minProceeds, governance

    /// The seller signed expecting ≥0.95 ETH. The owner then raises the
    /// royalty. The fill must fail rather than quietly shortchange the seller.
    function test_minProceedsProtectsSellerFromFeeChanges() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.minProceeds = 0.95 ether;
        bytes memory sig = _sign(o, SELLER_PK);

        nft.setDefaultRoyalty(royaltyReceiver, 1000); // owner raises royalty to 10%

        vm.expectRevert(bytes("PROCEEDS_TOO_LOW"));
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
    }

    function test_minProceedsSatisfiedFills() public {
        StockmonstersMarket.Order memory o = _order(1 ether);
        o.minProceeds = 0.9 ether;
        bytes memory sig = _sign(o, SELLER_PK);
        vm.prank(buyer);
        market.fillOrder{value: 1 ether}(o, sig);
        require(nft.ownerOf(tokenId) == buyer, "filled");
    }

    function test_accessControl_setFee() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        market.setFee(stranger, 100);
    }

    function test_accessControl_marketTransferOwnership() public {
        vm.expectRevert(bytes("NOT_OWNER"));
        vm.prank(stranger);
        market.transferOwnership(stranger);
    }

    function test_feeIsHardCapped() public {
        vm.expectRevert(bytes("FEE_TOO_HIGH"));
        market.setFee(treasury, 501);
        market.setFee(treasury, market.MAX_FEE_BPS()); // the cap itself is allowed
        vm.expectRevert(bytes("ZERO_RECIPIENT"));
        market.setFee(address(0), 100);
    }

    function test_marketTwoStepOwnership() public {
        market.transferOwnership(stranger);
        require(market.owner() == address(this), "not yet");
        vm.expectRevert(bytes("NOT_PENDING_OWNER"));
        vm.prank(buyer);
        market.acceptOwnership();
        vm.prank(stranger);
        market.acceptOwnership();
        require(market.owner() == stranger, "handed over");
    }

    function test_hashOrderIsDomainSeparated() public view {
        StockmonstersMarket.Order memory o = _order(1 ether);
        bytes32 structHash = keccak256(
            abi.encode(
                market.ORDER_TYPEHASH(),
                o.seller,
                o.tokenId,
                o.price,
                o.minProceeds,
                o.deadline,
                o.epoch,
                o.salt,
                o.requireSealed,
                o.attrCommit,
                o.taker,
                o.currency
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", market.DOMAIN_SEPARATOR(), structHash));
        require(market.hashOrder(o) == expected, "EIP-712 digest");
    }
}
