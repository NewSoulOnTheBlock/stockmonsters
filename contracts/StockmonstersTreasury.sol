// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Treasury {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router {
    function WETH() external view returns (address);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

/// @title StockmonstersTreasury — where game revenue lands and what happens to it
///
/// Every fee the game charges arrives here: NFT claim fees, the marketplace
/// rake, loot box sales. The split is fixed in the contract rather than left
/// to a spreadsheet:
///
/// - **Half of all revenue goes back into the game.** ETH revenue is held as a
///   buyback reserve and spent buying the token on the open market, and every
///   token bought goes straight to the rewards pool — i.e. to players. Revenue
///   that arrived as tokens skips the swap and goes to the rewards pool
///   directly, because buying tokens with tokens is a no-op with a fee.
/// - **The other half funds operations** — servers, art, the people building
///   it. It goes to one address, visible on chain, that anyone can watch.
///
/// ## Two things this contract deliberately does NOT do
///
/// It does not swap automatically inside a transfer. Auto-swapping on receipt
/// means every buyer of an NFT pays for someone else's DEX trade, gets
/// sandwiched on our behalf, and finds their mint reverting when the router
/// has a bad day. `buyback()` is a separate transaction with an explicit
/// `minOut`, run when someone chooses to run it.
///
/// It does not hold custody of anything it cannot account for: `route()` is
/// permissionless. Anyone may trigger the split at any time; nobody can change
/// where the money goes except through `setOpsWallet`/`setRewardsPool`, which
/// are owner-only and emit events.
contract StockmonstersTreasury {
    string public constant name = "StockmonstersTreasury";

    IERC20Treasury public immutable token;

    address public owner;
    address public pendingOwner;

    /// Where the players' half ends up.
    address public rewardsPool;
    /// Where the operating half ends up.
    address public opsWallet;
    /// Optional AMM router for the buyback. Unset (a fresh testnet, no
    /// liquidity) simply means `buyback` refuses and ETH accumulates.
    IUniswapV2Router public router;

    /// Basis points of revenue that go back to players. Fixed at deploy to
    /// 5000 = half, and bounded below so "half goes back to the game" cannot
    /// quietly become a tenth.
    uint16 public constant MIN_PLAYER_SHARE_BPS = 2500;
    uint16 public playerShareBps = 5000;

    /// ETH set aside for buying the token back. Tracked explicitly so the ops
    /// half can never be spent on a buyback, nor the reverse.
    uint256 public buybackReserve;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DestinationsChanged(address rewardsPool, address opsWallet);
    event RouterChanged(address router);
    event PlayerShareChanged(uint16 bps);
    event RevenueReceived(address indexed from, uint256 amount);
    event Routed(uint256 ethToOps, uint256 ethToBuyback, uint256 tokensToRewards, uint256 tokensToOps);
    event BoughtBack(uint256 ethSpent, uint256 tokensReceived);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address _token, address _rewardsPool, address _opsWallet) {
        require(_token != address(0), "ZERO_TOKEN");
        require(_rewardsPool != address(0) && _opsWallet != address(0), "ZERO_DESTINATION");
        token = IERC20Treasury(_token);
        owner = msg.sender;
        rewardsPool = _rewardsPool;
        opsWallet = _opsWallet;
        emit OwnershipTransferred(address(0), msg.sender);
        emit DestinationsChanged(_rewardsPool, _opsWallet);
    }

    receive() external payable {
        emit RevenueReceived(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "NOT_PENDING_OWNER");
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    function setDestinations(address _rewardsPool, address _opsWallet) external onlyOwner {
        require(_rewardsPool != address(0) && _opsWallet != address(0), "ZERO_DESTINATION");
        rewardsPool = _rewardsPool;
        opsWallet = _opsWallet;
        emit DestinationsChanged(_rewardsPool, _opsWallet);
    }

    function setRouter(address _router) external onlyOwner {
        router = IUniswapV2Router(_router);
        emit RouterChanged(_router);
    }

    function setPlayerShare(uint16 bps) external onlyOwner {
        require(bps >= MIN_PLAYER_SHARE_BPS && bps <= 10_000, "SHARE_OUT_OF_RANGE");
        playerShareBps = bps;
        emit PlayerShareChanged(bps);
    }

    /// @notice Split everything sitting here. Permissionless on purpose — the
    ///         destinations are fixed, so letting anyone press it removes the
    ///         "the team never got round to it" failure mode.
    ///
    /// ETH: the players' share is moved into `buybackReserve` (spent later by
    /// `buyback`), the rest is pushed to ops. Tokens: the players' share goes
    /// straight to the rewards pool — there is nothing to buy, it is already
    /// the right asset.
    function route() public returns (uint256 ethToOps, uint256 ethToBuyback, uint256 tokensToRewards, uint256 tokensToOps) {
        uint256 freeEth = address(this).balance - buybackReserve;
        if (freeEth > 0) {
            ethToBuyback = (freeEth * playerShareBps) / 10_000;
            ethToOps = freeEth - ethToBuyback;
            buybackReserve += ethToBuyback;
            if (ethToOps > 0) {
                (bool ok,) = opsWallet.call{value: ethToOps}("");
                require(ok, "OPS_TRANSFER_FAILED");
            }
        }

        uint256 tokenBalance = token.balanceOf(address(this));
        if (tokenBalance > 0) {
            tokensToRewards = (tokenBalance * playerShareBps) / 10_000;
            tokensToOps = tokenBalance - tokensToRewards;
            if (tokensToRewards > 0) require(token.transfer(rewardsPool, tokensToRewards), "REWARDS_TRANSFER_FAILED");
            if (tokensToOps > 0) require(token.transfer(opsWallet, tokensToOps), "OPS_TOKEN_TRANSFER_FAILED");
        }

        emit Routed(ethToOps, ethToBuyback, tokensToRewards, tokensToOps);
    }

    /// @notice Spend reserve ETH buying the token, and send every token bought
    ///         to the rewards pool — never to us.
    /// @param amountIn how much of the reserve to spend
    /// @param minOut   slippage floor. Zero is permitted but reckless; the
    ///                 caller is the owner, so this is their call to make.
    function buyback(uint256 amountIn, uint256 minOut, uint256 deadline) external onlyOwner returns (uint256 bought) {
        require(address(router) != address(0), "NO_ROUTER");
        require(amountIn > 0 && amountIn <= buybackReserve, "BAD_AMOUNT");

        buybackReserve -= amountIn;

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(token);

        uint256 before = token.balanceOf(rewardsPool);
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: amountIn}(
            minOut, path, rewardsPool, deadline
        );
        bought = token.balanceOf(rewardsPool) - before;
        require(bought >= minOut, "SLIPPAGE");
        emit BoughtBack(amountIn, bought);
    }

    /// @notice Pull revenue out of a contract that holds it (the NFT's claim
    ///         fees) and split it in the same transaction.
    function collectFrom(address source) external returns (bool) {
        (bool ok,) = source.call(abi.encodeWithSignature("sweepToTreasury()"));
        route();
        return ok;
    }

    /// @notice Recover a token that is neither ours nor the players'.
    function rescue(address foreign, address to) external onlyOwner {
        require(foreign != address(token), "USE_ROUTE");
        require(to != address(0), "ZERO_TO");
        uint256 amount = IERC20Treasury(foreign).balanceOf(address(this));
        require(IERC20Treasury(foreign).transfer(to, amount), "TRANSFER_FAILED");
    }
}
