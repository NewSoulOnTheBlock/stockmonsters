// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "./Upgradeable.sol";

interface IERC20Treasury {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// The pons fee escrow. Our launch names this treasury as its creator fee
/// recipient, so the creator's share of every trade accrues to a balance here
/// and we withdraw it on our own schedule. Fees are NOT pushed: a recipient
/// that cannot accept a transfer would otherwise jam distribution for every
/// other creator on the protocol.
interface IPonsFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
    function claim() external;
    function claimToken(address token) external;
}

/// The shared pons Uniswap v4 hook. Fees accrue on the hook after graduation
/// and only reach the escrow once someone sweeps them across.
interface IPonsHook {
    function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut) external;
}

/// A launch's own bonding curve. Before graduation the fee accrues here
/// instead of on the hook — which is the token's FIRST phase, not a corner
/// case, so the treasury needs to be able to sweep both.
interface IPonsCurveFees {
    function sweepFees(uint256 minBuybackTokensOut) external;
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
contract StockmonstersTreasury is UUPSUpgradeable {
    string public constant name = "StockmonstersTreasury";

    /// Not `immutable`: an immutable lives in the implementation's CODE, so
    /// behind a proxy it would be whatever the implementation was deployed
    /// with rather than what this proxy was initialised with.
    IERC20Treasury public token;

    address public owner;
    address public pendingOwner;

    /// Where the players' half ends up.
    address public rewardsPool;
    /// Where the operating half ends up.
    address public opsWallet;
    /// The AMM router the buyback swaps through. Unset (a fresh chain, no
    /// liquidity yet) simply means `buyback` refuses and ETH accumulates.
    ///
    /// Deliberately untyped. The token trades in a Uniswap v4 pool now, and a
    /// v4 swap is not a function signature you can pin in an interface: it is
    /// a command stream the Universal Router decodes. Typing this to one
    /// router's ABI would mean an upgrade every time the route changes. What
    /// keeps that safe is not the type, it is `buyback` asserting the outcome
    /// — see the note there.
    address public router;

    /// Basis points of revenue that go back to players. Fixed at deploy to
    /// 5000 = half, and bounded below so "half goes back to the game" cannot
    /// quietly become a tenth.
    uint16 public constant MIN_PLAYER_SHARE_BPS = 2500;
    /// Set in `initialize`, NOT here. An inline initializer runs in the
    /// implementation's constructor, which never touches the proxy's storage —
    /// so behind a proxy this would silently be zero.
    uint16 public playerShareBps;

    /// ETH set aside for buying the token back. Tracked explicitly so the ops
    /// half can never be spent on a buyback, nor the reverse.
    uint256 public buybackReserve;

    /// The pons fee escrow our creator fees accrue in, and the pons hook that
    /// holds them until they are swept across to it. Appended AFTER every
    /// field above and paid for out of `__gap`, because a proxy's storage is
    /// laid out in declaration order and inserting a slot anywhere earlier
    /// would reinterpret every field that follows it.
    address public feeEscrow;
    address public ponsHook;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DestinationsChanged(address rewardsPool, address opsWallet);
    event RouterChanged(address router);
    event PonsSourcesChanged(address feeEscrow, address ponsHook);
    event PonsFeesClaimed(address indexed asset, uint256 amount);
    event PlayerShareChanged(uint16 bps);
    event RevenueReceived(address indexed from, uint256 amount);
    event Routed(uint256 ethToOps, uint256 ethToBuyback, uint256 tokensToRewards, uint256 tokensToOps);
    event BoughtBack(uint256 ethSpent, uint256 tokensReceived);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    /// The implementation is a real contract at a real address with its own
    /// empty storage. Without this a passer-by could initialise it and hold
    /// its upgrade authorisation.
    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _rewardsPool, address _opsWallet, address _owner)
        external
        initializer
    {
        require(_token != address(0), "ZERO_TOKEN");
        require(_rewardsPool != address(0) && _opsWallet != address(0), "ZERO_DESTINATION");
        require(_owner != address(0), "ZERO_OWNER");
        token = IERC20Treasury(_token);
        owner = _owner;
        rewardsPool = _rewardsPool;
        opsWallet = _opsWallet;
        playerShareBps = 5000;
        emit OwnershipTransferred(address(0), _owner);
        emit DestinationsChanged(_rewardsPool, _opsWallet);
    }

    /// Only the owner, and only through the proxy.
    function _authorizeUpgrade(address) internal view override onlyOwner {}

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
        router = _router;
        emit RouterChanged(_router);
    }

    /// @notice Point the treasury at the pons contracts our launch pays into.
    /// @param _feeEscrow where the creator's share of every trade accrues
    /// @param _ponsHook  the shared v4 hook fees accrue on before a sweep
    function setPonsSources(address _feeEscrow, address _ponsHook) external onlyOwner {
        feeEscrow = _feeEscrow;
        ponsHook = _ponsHook;
        emit PonsSourcesChanged(_feeEscrow, _ponsHook);
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
    /// @param amountIn  how much of the reserve to spend
    /// @param minOut    slippage floor, and the thing that makes `swapData`
    ///                  safe. Must be non-zero.
    /// @param swapData  the call to make on `router`. A v4 swap is a command
    ///                  stream rather than a named function, so the route is
    ///                  built off chain and passed in.
    ///
    /// ## Why passing calldata here is not the hole it looks like
    ///
    /// Three things bound it, and they bound the OUTCOME rather than trying to
    /// anticipate the route:
    ///
    /// 1. `router` is stored, owner-set and logged. This cannot call an
    ///    arbitrary address, only the one address the owner published.
    /// 2. The spend is capped at the reserve, and the reserve is only ever the
    ///    players' half — the ops half is not reachable from here.
    /// 3. Every token bought must land in `rewardsPool`, and at least `minOut`
    ///    of them, or the whole transaction reverts. A route that sent the
    ///    tokens anywhere else fails this check. That is why `minOut` may not
    ///    be zero: at zero the check is vacuous and the guarantee is gone.
    ///
    /// Whatever the router does in between, the treasury asserts that the
    /// players ended up with the tokens. Anything else does not settle.
    function buyback(uint256 amountIn, uint256 minOut, bytes calldata swapData)
        external
        onlyOwner
        returns (uint256 bought)
    {
        require(router != address(0), "NO_ROUTER");
        require(amountIn > 0 && amountIn <= buybackReserve, "BAD_AMOUNT");
        require(minOut > 0, "ZERO_MIN_OUT");

        buybackReserve -= amountIn;

        uint256 tokensBefore = token.balanceOf(rewardsPool);
        uint256 ethBefore = address(this).balance;

        (bool ok,) = router.call{value: amountIn}(swapData);
        require(ok, "SWAP_FAILED");

        bought = token.balanceOf(rewardsPool) - tokensBefore;
        require(bought >= minOut, "SLIPPAGE");

        // A router that refunds unspent ETH hands it back mid-call, so the
        // reserve was debited for more than the swap actually cost. Give the
        // difference back to the players' side rather than letting it fall
        // into the free balance, where the next `route()` would hand half of
        // it to ops — money the players had already been allocated.
        uint256 spent = ethBefore - address(this).balance;
        if (spent < amountIn) buybackReserve += amountIn - spent;

        emit BoughtBack(spent, bought);
    }

    /* --- pons: where the money comes from now ---------------------------- */

    /// @notice Withdraw the creator fees our launch has accrued, and split
    ///         them in the same transaction.
    ///
    /// Permissionless on purpose, exactly like `route()`: the destination is
    /// fixed, so letting anyone press it removes the "nobody got round to it"
    /// failure mode. Safe to call when nothing is owed — it simply routes.
    ///
    /// This is the pipe that replaced the transfer tax. Our own token used to
    /// take 2% of every trade and credit the rewards pool in-place; the pons
    /// token has no tax and no owner, so the creator's share of the protocol
    /// fee accrues in ETH at the escrow instead and reaches players by being
    /// claimed here and spent by `buyback`.
    function claimPonsFees() external returns (uint256 claimed) {
        require(feeEscrow != address(0), "NO_ESCROW");
        uint256 before = address(this).balance;
        if (IPonsFeeEscrow(feeEscrow).balanceOf(address(this)) > 0) {
            IPonsFeeEscrow(feeEscrow).claim();
        }
        claimed = address(this).balance - before;
        emit PonsFeesClaimed(address(0), claimed);
        route();
    }

    /// @notice The same, for a launch paired against an ERC-20 rather than
    ///         ETH. The escrow keeps a separate ledger per asset, so a
    ///         creator is owed each one independently.
    /// @param asset the quote asset the launch is paired against, or the
    ///        launch token itself for a released buyback vest
    function claimPonsFeesToken(address asset) external returns (uint256 claimed) {
        require(feeEscrow != address(0), "NO_ESCROW");
        require(asset != address(0), "USE_CLAIM_PONS_FEES");
        uint256 before = IERC20Treasury(asset).balanceOf(address(this));
        if (IPonsFeeEscrow(feeEscrow).balanceOfToken(address(this), asset) > 0) {
            IPonsFeeEscrow(feeEscrow).claimToken(asset);
        }
        claimed = IERC20Treasury(asset).balanceOf(address(this)) - before;
        emit PonsFeesClaimed(asset, claimed);
        route();
    }

    /// @notice Push fees from the hook across to the escrow, so there is
    ///         something to claim.
    ///
    /// A trade does not credit the escrow directly: the fee sits on the hook
    /// until it is swept. pons runs an operator that does this, and this
    /// function exists so we are not waiting on them. Owner-only because the
    /// two minimums bound internal swaps that move the price, and a stranger
    /// choosing them could be made to accept a bad one.
    function sweepPonsPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)
        external
        onlyOwner
    {
        require(ponsHook != address(0), "NO_HOOK");
        IPonsHook(ponsHook).sweepPoolFees(poolId, minConversionQuoteOut, minBuybackTokensOut);
    }

    /// @notice The same, for a launch that has not graduated yet.
    ///
    /// A token's first phase is its bonding curve, and the fee on every trade
    /// during it accrues on the curve rather than the hook. Without this the
    /// treasury could only collect from the day the pool opened, and every
    /// fee paid before that would sit unclaimed until pons swept it for us.
    /// @param curve the launch's own curve, read from the factory's record
    function sweepPonsCurveFees(address curve, uint256 minBuybackTokensOut) external onlyOwner {
        require(curve != address(0), "ZERO_CURVE");
        IPonsCurveFees(curve).sweepFees(minBuybackTokensOut);
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

    /// Room for state a later version adds. Append and shrink this by the same
    /// number of slots; never reorder or retype what is above.
    ///
    /// 45 to start with; `feeEscrow` and `ponsHook` took two.
    uint256[43] private __gap;
}
