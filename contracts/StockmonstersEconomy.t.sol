// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deployers} from "./Deployers.sol";

import "./TestHelpers.sol";
import "./StockmonstersToken.sol";
import "./StockmonstersRewards.sol";
import "./StockmonstersTreasury.sol";
import "./StockmonstersNFT.sol";
import "./StockmonstersMarket.sol";

/// The economy: the token's tax, the pool players are paid from, the treasury
/// that splits revenue, and the two places the token is actually spent.
///
/// The cases worth writing are the ones where a naive implementation quietly
/// takes someone's money: a tax that fires on an in-game transfer, a rewards
/// signer that can drain more than one epoch, a market order whose currency can
/// be swapped by the buyer, a mint priced in a token nobody vetted.

/// Minimal Uniswap-V2-shaped router. Sells `rate` tokens per wei, so the
/// buyback test asserts on an exact number instead of a fixture's mood.
contract MockRouter {
    address public immutable weth;
    StockmonstersToken public immutable token;
    uint256 public rate;

    constructor(address _weth, address _token, uint256 _rate) {
        weth = _weth;
        token = StockmonstersToken(_token);
        rate = _rate;
    }

    function WETH() external view returns (address) {
        return weth;
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external payable {
        require(path.length == 2 && path[1] == address(token), "BAD_PATH");
        uint256 out = msg.value * rate;
        require(out >= amountOutMin, "MOCK_SLIPPAGE");
        token.transfer(to, out);
    }
}

contract EconomyTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant CLAIM_SIGNER_PK = 0xC1A1;
    uint256 constant GAME_SIGNER_PK = 0xA11CE;
    uint256 constant SELLER_PK = 0x5E11E4;
    uint64 constant FAR_FUTURE = 4_000_000_000;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    StockmonstersToken token;
    StockmonstersRewards rewards;
    StockmonstersTreasury treasury;
    StockmonstersNFT nft;
    StockmonstersMarket market;

    address deployer = address(this);
    address ops = address(0x0B5);
    address pair = address(0xDEAD11);
    address alice = address(0xA11);
    address bob = address(0xB0B);
    address seller;
    address royaltyReceiver = address(0xF00D);

    bytes32 constant VOUCHER_ERC20_TYPEHASH = keccak256(
        "MintVoucherERC20(address player,bytes32 attrCommit,bytes32 uid,address currency,uint256 fee,uint64 deadline)"
    );
    bytes32 constant VOUCHER_TYPEHASH =
        keccak256("MintVoucher(address player,bytes32 attrCommit,bytes32 uid,uint256 fee,uint64 deadline)");

    uint8[6] ivs = [31, 20, 15, 31, 25, 10];
    bytes32 constant SALT = bytes32(uint256(0xC0FFEE));

    receive() external payable {}

    /// The market safeTransferFrom's the NFT to whoever called fillOrder, and
    /// that is this contract (a `prank` sets msg.sender for the OUTER call,
    /// not for the market's view of it). Without this the fill reverts with
    /// UNSAFE_RECIPIENT and the test would be measuring the wrong thing.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function setUp() public {
        seller = vm.addr(SELLER_PK);

        // The deployment order the script uses: rewards and treasury need the
        // token's address, the token needs theirs, so one of them is wired
        // after the fact. The token is deployed first with placeholders and
        // pointed at the real pair immediately.
        address predictedRewards = address(0x1111);
        address predictedTreasury = address(0x2222);
        token = Deployers.token(
            "Stock Monsters", "$STONKSTER", SUPPLY, predictedRewards, predictedTreasury, "ipfs://logo.png", "The game token"
        , address(this));
        rewards = Deployers.rewards(address(token), vm.addr(CLAIM_SIGNER_PK), address(this));
        treasury = Deployers.treasury(address(token), address(rewards), ops, address(this));
        token.setTaxDestinations(address(rewards), address(treasury));

        nft = Deployers.nft(vm.addr(GAME_SIGNER_PK), "ipfs://images/", "ipfs://sealed.png", address(this));
        nft.setTreasury(address(treasury));
        nft.setAcceptedCurrency(address(token), true);
        nft.setDefaultRoyalty(royaltyReceiver, 500);

        market = Deployers.market(address(nft), address(treasury), 250, address(this));
        market.setAcceptedCurrency(address(token), true);

        // Contracts never pay tax: they are not traders.
        token.setTaxExempt(address(nft), true);
        token.setTaxExempt(address(market), true);

        vm.warp(1_000_000);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(seller, 10 ether);

        token.transfer(alice, 10_000 ether);
        token.transfer(bob, 10_000 ether);
        token.transfer(address(rewards), 1_000_000 ether);
    }

    /* ------------------------------------------------------------ token --- */

    function test_supplyIsFixedAndFullyMintedAtDeploy() public view {
        require(token.totalSupply() == SUPPLY, "supply");
        // Everything not handed out in setUp is still with the deployer: there
        // is no mint function, so this is all there will ever be.
        require(token.balanceOf(deployer) == SUPPLY - 1_020_000 ether, "deployer holds the rest");
    }

    function test_walletToWalletIsNeverTaxed() public {
        token.setPair(pair, true);
        vm.prank(alice);
        token.transfer(bob, 100 ether);
        require(token.balanceOf(bob) == 10_100 ether, "recipient got the whole amount");
    }

    function test_buyingFromAPairIsTaxedAndSplit75_25() public {
        token.setPair(pair, true);
        token.transfer(pair, 1_000 ether); // seed the "pool"

        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 treasuryBefore = token.balanceOf(address(treasury));

        vm.prank(pair);
        token.transfer(alice, 100 ether); // a buy

        uint256 tax = 2 ether; // 2%
        require(token.balanceOf(alice) == 10_000 ether + 98 ether, "buyer receives net");
        require(token.balanceOf(address(rewards)) - rewardsBefore == (tax * 75) / 100, "players get 75%");
        require(token.balanceOf(address(treasury)) - treasuryBefore == (tax * 25) / 100, "treasury gets 25%");
    }

    function test_sellingToAPairIsTaxed() public {
        token.setPair(pair, true);
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        vm.prank(alice);
        token.transfer(pair, 100 ether); // a sell
        require(token.balanceOf(pair) == 98 ether, "pair receives net");
        require(token.balanceOf(address(rewards)) - rewardsBefore == 1.5 ether, "75% of 2%");
    }

    function test_exemptAddressesTradeUntaxed() public {
        token.setPair(pair, true);
        token.setTaxExempt(alice, true);
        vm.prank(alice);
        token.transfer(pair, 100 ether);
        require(token.balanceOf(pair) == 100 ether, "no tax for an exempt seller");
    }

    function test_amountAfterTaxMatchesWhatArrives() public {
        token.setPair(pair, true);
        uint256 quoted = token.amountAfterTax(alice, pair, 500 ether);
        vm.prank(alice);
        token.transfer(pair, 500 ether);
        require(token.balanceOf(pair) == quoted, "the quote is the truth");
    }

    function test_taxCannotBeRaisedPastTheCap() public {
        vm.expectRevert(bytes("TAX_TOO_HIGH"));
        token.setTax(501, 200);
    }

    function test_playersShareCannotBeCutBelowHalf() public {
        vm.expectRevert(bytes("SHARE_OUT_OF_RANGE"));
        token.setRewardsShare(4999);
        token.setRewardsShare(9000); // raising it is fine
        require(token.rewardsShareBps() == 9000, "raised");
    }

    function test_renouncingOwnershipEndsAdmin() public {
        token.renounceOwnership();
        vm.expectRevert(bytes("NOT_OWNER"));
        token.setTax(0, 0);
    }

    function test_burnReducesSupply() public {
        uint256 before = token.totalSupply();
        vm.prank(alice);
        token.burn(1_000 ether);
        require(token.totalSupply() == before - 1_000 ether, "supply fell");
        require(token.balanceOf(alice) == 9_000 ether, "balance fell");
    }

    function test_infiniteAllowanceIsNotDecremented() public {
        vm.prank(alice);
        token.approve(bob, type(uint256).max);
        vm.prank(bob);
        token.transferFrom(alice, bob, 1 ether);
        require(token.allowance(alice, bob) == type(uint256).max, "still infinite");
    }

    function test_allowanceIsEnforced() public {
        vm.prank(alice);
        token.approve(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("INSUFFICIENT_ALLOWANCE"));
        token.transferFrom(alice, bob, 2 ether);
    }

    /* ---------------------------------------------------------- rewards --- */

    function _signClaim(address player, uint256 epoch, uint256 amount, uint64 deadline)
        internal
        returns (bytes memory)
    {
        bytes32 digest = rewards.hashClaim(player, epoch, amount, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CLAIM_SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_aFundedEpochPaysTheSignedAmount() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 40 ether, FAR_FUTURE);
        vm.prank(alice);
        rewards.claim(1, 40 ether, FAR_FUTURE, sig);
        require(token.balanceOf(alice) == 10_040 ether, "paid");
        require(rewards.unclaimed(1) == 60 ether, "budget drawn down");
    }

    function test_theEpochBudgetIsTheCeilingOnALeakedSigner() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 101 ether, FAR_FUTURE);
        vm.prank(alice);
        // Even with a perfectly valid signature for a huge amount, the pool
        // cannot lose more than the epoch was funded with. This is the whole
        // containment story for the claim key.
        vm.expectRevert(bytes("EPOCH_EXHAUSTED"));
        rewards.claim(1, 101 ether, FAR_FUTURE, sig);
    }

    function test_oneClaimPerPlayerPerEpoch() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 10 ether, FAR_FUTURE);
        vm.prank(alice);
        rewards.claim(1, 10 ether, FAR_FUTURE, sig);
        vm.prank(alice);
        vm.expectRevert(bytes("ALREADY_CLAIMED"));
        rewards.claim(1, 10 ether, FAR_FUTURE, sig);
    }

    function test_aClaimIsBoundToItsPlayer() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 10 ether, FAR_FUTURE);
        // Bob found Alice's signature in a log and tried to spend it.
        vm.prank(bob);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        rewards.claim(1, 10 ether, FAR_FUTURE, sig);
    }

    function test_anExpiredClaimIsDead() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 10 ether, uint64(block.timestamp + 10));
        vm.warp(block.timestamp + 11);
        vm.prank(alice);
        vm.expectRevert(bytes("CLAIM_EXPIRED"));
        rewards.claim(1, 10 ether, uint64(block.timestamp - 1), sig);
    }

    function test_aForgedSignerIsRefused() public {
        rewards.fundEpoch(1, 100 ether);
        bytes32 digest = rewards.hashClaim(alice, 1, 10 ether, FAR_FUTURE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, digest);
        vm.prank(alice);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        rewards.claim(1, 10 ether, FAR_FUTURE, abi.encodePacked(r, s, v));
    }

    function test_theOwnerCannotEmptyTheRewardsPool() public {
        vm.expectRevert(bytes("CANNOT_SWEEP_REWARDS"));
        rewards.sweep(address(token), deployer);
    }

    function test_fundingBelowWhatIsAlreadyClaimedIsRefused() public {
        rewards.fundEpoch(1, 100 ether);
        bytes memory sig = _signClaim(alice, 1, 40 ether, FAR_FUTURE);
        vm.prank(alice);
        rewards.claim(1, 40 ether, FAR_FUTURE, sig);
        vm.expectRevert(bytes("BUDGET_BELOW_CLAIMED"));
        rewards.fundEpoch(1, 30 ether);
    }

    /* --------------------------------------------------------- treasury --- */

    function test_ethRevenueSplitsHalfToOpsHalfToBuyback() public {
        vm.deal(address(treasury), 10 ether);
        uint256 opsBefore = ops.balance;
        treasury.route();
        require(ops.balance - opsBefore == 5 ether, "ops paid");
        require(treasury.buybackReserve() == 5 ether, "reserve held for the buyback");
    }

    function test_tokenRevenueGoesStraightToPlayersWithoutASwap() public {
        token.transfer(address(treasury), 1_000 ether);
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        treasury.route();
        require(token.balanceOf(address(rewards)) - rewardsBefore == 500 ether, "half to players");
        require(token.balanceOf(ops) == 500 ether, "half to ops");
    }

    function test_routeIsPermissionless() public {
        vm.deal(address(treasury), 4 ether);
        vm.prank(bob); // not the owner
        treasury.route();
        require(treasury.buybackReserve() == 2 ether, "anyone may press it");
    }

    /// The swap `buyback` should make: buy the token and deliver it to the
    /// rewards pool. Built here rather than inside the treasury because a
    /// Uniswap v4 swap is a command stream, not a named function.
    function _swapTo(address to, uint256 minOut) internal view returns (bytes memory) {
        address[] memory path = new address[](2);
        path[0] = address(0x4242);
        path[1] = address(token);
        return abi.encodeCall(
            MockRouter.swapExactETHForTokensSupportingFeeOnTransferTokens,
            (minOut, path, to, block.timestamp + 60)
        );
    }

    function test_buybackWithoutARouterRefuses() public {
        vm.deal(address(treasury), 10 ether);
        treasury.route();
        vm.expectRevert(bytes("NO_ROUTER"));
        treasury.buyback(1 ether, 1, _swapTo(address(rewards), 0));
    }

    function test_buybackSendsEveryBoughtTokenToThePlayers() public {
        MockRouter router = new MockRouter(address(0x4242), address(token), 1_000);
        token.transfer(address(router), 100_000 ether);
        token.setTaxExempt(address(router), true);
        treasury.setRouter(address(router));

        vm.deal(address(treasury), 10 ether);
        treasury.route(); // 5 ether into the reserve

        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 bought = treasury.buyback(5 ether, 4_000 ether, _swapTo(address(rewards), 4_000 ether));

        require(bought == 5_000 ether, "bought at the mock rate");
        require(token.balanceOf(address(rewards)) - rewardsBefore == 5_000 ether, "all of it to the pool");
        require(treasury.buybackReserve() == 0, "reserve spent");
        require(token.balanceOf(address(treasury)) == 0, "treasury keeps none of it");
    }

    /// The guarantee that makes passing calldata safe. A route that buys the
    /// token and keeps it — or sends it anywhere that is not the rewards pool
    /// — has to fail, or `buyback` would be a way for the owner to spend the
    /// players' half on themselves.
    function test_aBuybackThatDoesNotReachThePlayersReverts() public {
        MockRouter router = new MockRouter(address(0x4242), address(token), 1_000);
        token.transfer(address(router), 100_000 ether);
        token.setTaxExempt(address(router), true);
        treasury.setRouter(address(router));

        vm.deal(address(treasury), 10 ether);
        treasury.route();

        // Same swap, same price, delivered to the owner instead.
        vm.expectRevert(bytes("SLIPPAGE"));
        treasury.buyback(5 ether, 4_000 ether, _swapTo(address(this), 4_000 ether));
    }

    /// `minOut` is the whole enforcement, so zero cannot be allowed: at zero
    /// the check above passes no matter where the tokens went.
    function test_aBuybackWithNoFloorIsRefused() public {
        MockRouter router = new MockRouter(address(0x4242), address(token), 1_000);
        token.transfer(address(router), 100_000 ether);
        treasury.setRouter(address(router));
        vm.deal(address(treasury), 10 ether);
        treasury.route();

        vm.expectRevert(bytes("ZERO_MIN_OUT"));
        treasury.buyback(5 ether, 0, _swapTo(address(rewards), 0));
    }

    function test_buybackCannotSpendTheOpsHalf() public {
        MockRouter router = new MockRouter(address(0x4242), address(token), 1_000);
        token.transfer(address(router), 100_000 ether);
        treasury.setRouter(address(router));
        vm.deal(address(treasury), 10 ether);
        treasury.route();
        vm.expectRevert(bytes("BAD_AMOUNT"));
        treasury.buyback(6 ether, 1, _swapTo(address(rewards), 0));
    }

    function test_playerShareHasAFloor() public {
        vm.expectRevert(bytes("SHARE_OUT_OF_RANGE"));
        treasury.setPlayerShare(2499);
    }

    /* -------------------------------------------------- paying in token --- */

    function _commit(uint16 dexId, uint8 level, uint8 natureId, bool shiny, uint64 caughtAt, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt));
    }

    function _signErc20Voucher(address player, bytes32 c, bytes32 uid, address currency, uint256 fee)
        internal
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(VOUCHER_ERC20_TYPEHASH, player, c, uid, currency, fee, FAR_FUTURE));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(GAME_SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_mintingPaidInTokenSendsTheFeeToTheTreasury() public {
        bytes32 c = _commit(1, 50, 0, true, 1_756_000_000, SALT);
        bytes32 uid = bytes32(uint256(1));
        bytes memory sig = _signErc20Voucher(alice, c, uid, address(token), 500 ether);

        vm.prank(alice);
        token.approve(address(nft), 500 ether);
        vm.prank(alice);
        uint256 id = nft.mintCaughtERC20(c, uid, address(token), 500 ether, FAR_FUTURE, sig);

        require(nft.ownerOf(id) == alice, "minted");
        require(token.balanceOf(address(treasury)) == 500 ether, "fee landed in the treasury");
        require(token.balanceOf(alice) == 9_500 ether, "paid");
    }

    function test_mintingInAnUnvettedTokenIsRefused() public {
        StockmonstersToken fake = Deployers.token(
            "Fake", "FAKE", 1_000 ether, address(rewards), address(treasury), "", ""
        , address(this));
        bytes32 c = _commit(2, 10, 0, false, 1_756_000_000, SALT);
        bytes32 uid = bytes32(uint256(2));
        bytes memory sig = _signErc20Voucher(alice, c, uid, address(fake), 1 ether);
        vm.prank(alice);
        // Even with a valid signature from the real game signer: a currency
        // nobody whitelisted cannot be used to pay for a mint.
        vm.expectRevert(bytes("CURRENCY_NOT_ACCEPTED"));
        nft.mintCaughtERC20(c, uid, address(fake), 1 ether, FAR_FUTURE, sig);
    }

    function test_anEthVoucherCannotBeSpentAsATokenVoucher() public {
        bytes32 c = _commit(3, 10, 0, false, 1_756_000_000, SALT);
        bytes32 uid = bytes32(uint256(3));
        // Sign the ETH type, present it to the ERC-20 entry point.
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, alice, c, uid, uint256(1 ether), FAR_FUTURE));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(GAME_SIGNER_PK, digest);
        vm.prank(alice);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        nft.mintCaughtERC20(c, uid, address(token), 1 ether, FAR_FUTURE, abi.encodePacked(r, s, v));
    }

    function test_aUidIsSpentOnceAcrossBothPaymentPaths() public {
        bytes32 c = _commit(4, 10, 0, false, 1_756_000_000, SALT);
        bytes32 uid = bytes32(uint256(4));
        bytes memory sig = _signErc20Voucher(alice, c, uid, address(token), 1 ether);
        vm.prank(alice);
        token.approve(address(nft), 2 ether);
        vm.prank(alice);
        nft.mintCaughtERC20(c, uid, address(token), 1 ether, FAR_FUTURE, sig);
        vm.prank(alice);
        vm.expectRevert(bytes("VOUCHER_USED"));
        nft.mintCaughtERC20(c, uid, address(token), 1 ether, FAR_FUTURE, sig);
    }

    /* ------------------------------------------------ market in token --- */

    function _mintToSeller() internal returns (uint256) {
        bytes32 c = _commit(9, 30, 0, false, 1_756_000_000, SALT);
        bytes32 uid = bytes32(uint256(99));
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, seller, c, uid, uint256(0), FAR_FUTURE));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(GAME_SIGNER_PK, digest);
        vm.prank(seller);
        return nft.mintCaught(c, uid, 0, FAR_FUTURE, abi.encodePacked(r, s, v));
    }

    function _order(uint256 id, uint256 price, address currency)
        internal
        view
        returns (StockmonstersMarket.Order memory o)
    {
        o = StockmonstersMarket.Order({
            seller: seller,
            tokenId: id,
            price: price,
            minProceeds: 0,
            deadline: FAR_FUTURE,
            epoch: market.epochOf(seller),
            salt: 7,
            requireSealed: true,
            attrCommit: nft.attrCommit(id),
            taker: address(0),
            currency: currency
        });
    }

    function _sign(StockmonstersMarket.Order memory o) internal returns (bytes memory) {
        // hashOrder takes calldata; go through an external call to get it.
        bytes32 digest = this.hashOrderExternal(o);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function hashOrderExternal(StockmonstersMarket.Order calldata o) external view returns (bytes32) {
        return market.hashOrder(o);
    }

    function test_buyingWithTheTokenPaysEveryone() public {
        uint256 id = _mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);

        StockmonstersMarket.Order memory o = _order(id, 1_000 ether, address(token));
        bytes memory sig = _sign(o);

        // This contract is the buyer — see onERC721Received above.
        token.approve(address(market), 1_000 ether);
        uint256 buyerBefore = token.balanceOf(address(this));
        this.fill(o, sig);

        require(nft.ownerOf(id) == address(this), "buyer owns it");
        require(token.balanceOf(address(treasury)) == 25 ether, "2.5% fee");
        require(token.balanceOf(royaltyReceiver) == 50 ether, "5% royalty");
        require(token.balanceOf(seller) == 925 ether, "seller keeps the rest");
        require(buyerBefore - token.balanceOf(address(this)) == 1_000 ether, "buyer paid exactly the price");
    }

    function fill(StockmonstersMarket.Order calldata o, bytes calldata sig) external payable {
        market.fillOrder{value: msg.value}(o, sig);
    }

    function test_anUnvettedCurrencyCannotBeListed() public {
        uint256 id = _mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        StockmonstersToken fake = Deployers.token(
            "Fake", "FAKE", 1_000 ether, address(rewards), address(treasury), "", ""
        , address(this));
        StockmonstersMarket.Order memory o = _order(id, 1 ether, address(fake));
        bytes memory sig = _sign(o);
        vm.expectRevert(bytes("CURRENCY_NOT_ACCEPTED"));
        this.fill(o, sig);
    }

    function test_ethSentWithATokenOrderIsRefused() public {
        uint256 id = _mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        StockmonstersMarket.Order memory o = _order(id, 1_000 ether, address(token));
        bytes memory sig = _sign(o);
        vm.deal(address(this), 1 ether);
        vm.expectRevert(bytes("NO_ETH_FOR_TOKEN_ORDER"));
        this.fill{value: 1 ether}(o, sig);
    }

    function test_theCurrencyIsSignedAndCannotBeSwapped() public {
        uint256 id = _mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);

        StockmonstersMarket.Order memory signedInToken = _order(id, 1_000 ether, address(token));
        bytes memory sig = _sign(signedInToken);

        // The buyer presents the same order with the currency swapped back to
        // ETH, hoping to pay 1000 wei-denominated ETH instead of 1000 tokens.
        StockmonstersMarket.Order memory tampered = signedInToken;
        tampered.currency = address(0);
        vm.deal(address(this), 2_000 ether);
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        this.fill{value: 1_000 ether}(tampered, sig);
    }

    function test_ethOrdersStillWork() public {
        uint256 id = _mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        StockmonstersMarket.Order memory o = _order(id, 1 ether, address(0));
        bytes memory sig = _sign(o);
        vm.deal(address(this), 10 ether);
        this.fill{value: 1 ether}(o, sig);
        require(nft.ownerOf(id) == address(this), "the ETH path is untouched");
    }
}
