// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TestHelpers.sol";
import "./StockmonstersToken.sol";
import "./StockmonstersRewards.sol";
import "./StockmonstersTreasury.sol";

/// The economy against the REAL Uniswap V2, on a fork of mainnet.
///
///   forge test --fork-url https://ethereum-rpc.publicnode.com \
///              --match-path StockmonstersFork.t.sol -vv
///
/// ## Why a fork and not the mock
///
/// Everything about the tax lives or dies on how an actual AMM moves tokens,
/// and a mock router is a mock of my own assumptions. The real router:
///
///   · pulls tokens with `transferFrom(seller, pair, amount)` on a sell and
///     pushes them from the pair on a buy — which is exactly what decides
///     whether the tax fires at the right moment and only then;
///   · checks its own K invariant AFTER the transfer, so a token that takes a
///     cut without the router's fee-on-transfer entry points makes the swap
///     revert. This test proves ours works with the supporting-fee calls and
///     documents that the plain ones are not usable;
///   · adds liquidity by transferring to the pair, which would silently short
///     the pool if the LP-seeding wallet were not exempt.
///
/// The buyback is the other half: `StockmonstersTreasury.buyback` calls a
/// router for real money. Testing that against a stub proves nothing about
/// slippage, paths or WETH.
interface IUniV2Router {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
}

interface IUniV2Factory {
    function getPair(address a, address b) external view returns (address);
    function createPair(address a, address b) external returns (address);
}

contract ForkTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Mainnet. Fixed addresses, because that is the point of a fork test.
    IUniV2Router constant ROUTER = IUniV2Router(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    StockmonstersToken token;
    StockmonstersRewards rewards;
    StockmonstersTreasury treasury;

    address ops = address(0x0B5);
    address alice = address(0xA11CE);
    address pair;

    uint256 constant SUPPLY = 1_000_000_000 ether;
    uint256 constant LP_TOKENS = 100_000_000 ether;
    uint256 constant LP_ETH = 50 ether;

    receive() external payable {}

    function setUp() public {
        // Without `--fork-url` there is no Uniswap at that address, and every
        // test here is about Uniswap. Skipping says so; failing would look
        // like the contracts were broken.
        if (address(ROUTER).code.length == 0) {
            vm.skip(true);
            return;
        }
        token = new StockmonstersToken(
            "Stockmonsters", "SMON", SUPPLY, address(0x1111), address(0x2222), "", "the game token"
        );
        rewards = new StockmonstersRewards(address(token), address(0x5169));
        treasury = new StockmonstersTreasury(address(token), address(rewards), ops);
        token.setTaxDestinations(address(rewards), address(treasury));

        vm.deal(address(this), 1_000 ether);
        vm.deal(alice, 100 ether);

        // Seed a real pool. This contract is the deployer and therefore
        // tax-exempt, which is what stops the pool being seeded short.
        token.approve(address(ROUTER), type(uint256).max);
        ROUTER.addLiquidityETH{value: LP_ETH}(
            address(token), LP_TOKENS, 0, 0, address(this), block.timestamp + 600
        );

        pair = IUniV2Factory(ROUTER.factory()).getPair(address(token), WETH);
        require(pair != address(0), "no pair");
        token.setPair(pair, true);
    }

    function _buy(address who, uint256 ethIn) internal {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = address(token);
        vm.prank(who);
        ROUTER.swapExactETHForTokensSupportingFeeOnTransferTokens{value: ethIn}(
            0, path, who, block.timestamp + 600
        );
    }

    function _sell(address who, uint256 tokensIn) internal {
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = WETH;
        vm.prank(who);
        token.approve(address(ROUTER), tokensIn);
        vm.prank(who);
        ROUTER.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokensIn, 0, path, who, block.timestamp + 600
        );
    }

    /* ------------------------------------------------------------------- */

    function test_theLiquidityWentInWhole() public view {
        // If the seeding wallet were taxed, the pool would hold 2% less than
        // was paid for it and every price after that would be wrong.
        require(token.balanceOf(pair) == LP_TOKENS, "the pool holds exactly what was added");
    }

    function test_buyingThroughTheRealRouterIsTaxedAndSplit() public {
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 treasuryBefore = token.balanceOf(address(treasury));

        _buy(alice, 1 ether);

        uint256 got = token.balanceOf(alice);
        uint256 toRewards = token.balanceOf(address(rewards)) - rewardsBefore;
        uint256 toTreasury = token.balanceOf(address(treasury)) - treasuryBefore;
        uint256 tax = toRewards + toTreasury;

        require(got > 0, "the buyer received tokens");
        require(tax > 0, "tax was taken");
        // 2% of what left the pool, and 75/25 between players and ops.
        require(_near(tax, ((got + tax) * 200) / 10_000, 2), "tax is 2% of the gross");
        require(_near(toRewards, (tax * 7500) / 10_000, 2), "players get 75%");
        require(_near(toTreasury, tax - (tax * 7500) / 10_000, 2), "treasury gets 25%");
    }

    function test_sellingThroughTheRealRouterIsTaxed() public {
        _buy(alice, 1 ether);
        uint256 held = token.balanceOf(alice);
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 ethBefore = alice.balance;

        _sell(alice, held);

        require(alice.balance > ethBefore, "the seller got ETH");
        require(token.balanceOf(alice) == 0, "everything was sold");
        uint256 toRewards = token.balanceOf(address(rewards)) - rewardsBefore;
        require(_near(toRewards, (held * 200 * 7500) / (10_000 * 10_000), 2), "75% of a 2% sell tax");
    }

    function test_movingTokensBetweenWalletsIsNeverTaxed() public {
        _buy(alice, 1 ether);
        uint256 held = token.balanceOf(alice);
        uint256 rewardsBefore = token.balanceOf(address(rewards));

        vm.prank(alice);
        token.transfer(address(0xBEEF), held);

        require(token.balanceOf(address(0xBEEF)) == held, "the whole amount arrived");
        require(token.balanceOf(address(rewards)) == rewardsBefore, "and nothing was skimmed");
    }

    /// WHICH ROUTER CALLS WORK, established by running them rather than by
    /// assuming. I had this backwards until the fork said otherwise.
    ///
    /// A plain BUY is fine: the router quotes the output from the reserves and
    /// the pair pays out that much — our tax is taken on the way to the buyer,
    /// after the pool is already square, so nothing the router checks notices.
    /// The buyer simply receives 2% less than the quote, which is the point.
    function test_aPlainBuyStillWorksAndTheBuyerJustGetsLess() public {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = address(token);
        vm.prank(alice);
        ROUTER.swapExactETHForTokens{value: 1 ether}(0, path, alice, block.timestamp + 600);
        require(token.balanceOf(alice) > 0, "the buy went through");
        require(token.balanceOf(address(rewards)) > 0, "and it was taxed");
    }

    /// A plain SELL cannot work, and this is the one that matters: the router
    /// tells the pair to expect the full amount, the tax means less arrives,
    /// and the pair's K invariant refuses the trade. Any UI, bot or aggregator
    /// selling this token MUST use the supporting-fee entry point.
    function test_aPlainSellIsRefusedByThePair() public {
        _buy(alice, 1 ether);
        uint256 held = token.balanceOf(alice);
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = WETH;
        vm.prank(alice);
        token.approve(address(ROUTER), held);
        vm.prank(alice);
        vm.expectRevert();
        ROUTER.swapExactTokensForETH(held, 0, path, alice, block.timestamp + 600);
    }

    function test_theTreasuryBuysBackOnTheRealMarketForThePlayers() public {
        // Revenue arrives as ETH — an NFT claim fee, a marketplace rake.
        vm.deal(address(treasury), 10 ether);
        treasury.route();
        require(treasury.buybackReserve() == 5 ether, "half is reserved for the buyback");
        require(ops.balance == 5 ether, "half went to ops");

        treasury.setRouter(address(ROUTER));
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 bought = treasury.buyback(5 ether, 1, block.timestamp + 600);

        require(bought > 0, "tokens were bought");
        require(token.balanceOf(address(rewards)) - rewardsBefore == bought, "every one went to the players");
        require(token.balanceOf(address(treasury)) == 0, "the treasury kept none of them");
        require(treasury.buybackReserve() == 0, "the reserve was spent");
    }

    function test_aBuybackWithAnImpossibleFloorRevertsRatherThanOverpaying() public {
        vm.deal(address(treasury), 10 ether);
        treasury.route();
        treasury.setRouter(address(ROUTER));
        // The floor is the only protection against a sandwich. It has to bite.
        vm.expectRevert();
        treasury.buyback(5 ether, SUPPLY, block.timestamp + 600);
    }

    /// Within `tolerance` parts per 10,000 — the pool's own 0.3% fee and
    /// integer division make an exact figure meaningless.
    function _near(uint256 a, uint256 b, uint256 tolerance) private pure returns (bool) {
        if (a == b) return true;
        uint256 diff = a > b ? a - b : b - a;
        uint256 big = a > b ? a : b;
        return (diff * 10_000) / big <= tolerance;
    }
}
