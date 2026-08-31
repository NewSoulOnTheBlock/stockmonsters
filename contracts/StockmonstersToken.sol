// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "./Upgradeable.sol";

/// @title StockmonstersToken — the game's currency, and a tax that pays players
///
/// A plain ERC-20 with three deliberate properties:
///
/// 1. **WALLET-TO-WALLET IS ALWAYS FREE.** Tax applies only when one side of
///    the transfer is a registered AMM pair — i.e. a buy or a sell on a DEX.
///    Sending tokens to a friend, paying for a loot box, settling a market
///    order or funding an escrow is never taxed. This is not politeness: every
///    contract in this system moves exact amounts, and a token that silently
///    delivers less than it was told to breaks escrow arithmetic everywhere.
///
/// 2. **MOST OF THE TAX GOES TO PLAYERS.** The split is set at deploy to 75%
///    to the rewards pool (which the game distributes to players by activity)
///    and 25% to the treasury. The rewards share can be raised but never
///    dropped below `MIN_REWARDS_SHARE_BPS` — the promise is enforced by the
///    contract, not by a blog post.
///
/// 3. **THE OWNER CANNOT RUG IT.** No mint function exists after construction,
///    so the supply is fixed forever. There is no blacklist, no pause, no
///    transfer gate. Tax is capped at `MAX_TAX_BPS` and that cap is a
///    constant — the owner can lower the tax, never raise it past the cap.
///
/// It is also SELF-DESCRIBING: `logo()`, `description()`, `socials()` and
/// `liquidityPool()` are readable on chain, so the game reads its own currency
/// metadata from the token rather than from a config file. See
/// stockmonsters-mmo/docs/token-economy.md.
contract StockmonstersToken is UUPSUpgradeable {
    // --- ERC-20 ---------------------------------------------------------
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --- self-describing metadata ---------------------------------------
    string public logo;
    string public description;
    /// The canonical AMM pair, for anything that wants to link to a chart.
    /// Informational: taxation is driven by `isPair`, which may hold several.
    address public liquidityPool;

    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    Socials private _socials;

    function socials()
        external
        view
        returns (string memory twitter, string memory telegram, string memory discord, string memory website, string memory farcaster)
    {
        Socials memory s = _socials;
        return (s.twitter, s.telegram, s.discord, s.website, s.farcaster);
    }

    // --- ownership (two-step, same shape as the other contracts) --------
    address public owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
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

    /// @notice Give up ownership for good: no more tax changes, no more pair
    ///         registration, no more anything. The one-way door that makes
    ///         "the owner cannot touch it" checkable rather than promised.
    function renounceOwnership() external onlyOwner {
        address previous = owner;
        owner = address(0);
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, address(0));
    }

    // --- tax --------------------------------------------------------------
    /// Hard ceiling. A constant, so the "max 5%" claim is verifiable from the
    /// bytecode and cannot be raised by any transaction.
    uint16 public constant MAX_TAX_BPS = 500;
    /// The players' share of the tax can be raised to 100% but never cut below
    /// half — the reason the tax exists at all is to pay them.
    uint16 public constant MIN_REWARDS_SHARE_BPS = 5000;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public rewardsShareBps;

    /// Where the players' share goes. The game distributes from here.
    address public rewardsPool;
    /// Where the operating share goes.
    address public treasury;

    /// AMM pairs. A transfer with a pair on either side is a trade; anything
    /// else is two people moving tokens and is never taxed.
    mapping(address => bool) public isPair;
    /// Contracts and wallets that never pay tax even when trading through a
    /// pair: the treasury, the rewards pool, and the LP-seeding wallet.
    mapping(address => bool) public isTaxExempt;

    event TaxChanged(uint16 buyBps, uint16 sellBps);
    event TaxSplitChanged(uint16 rewardsShareBps);
    event TaxDestinationsChanged(address rewardsPool, address treasury);
    event PairSet(address indexed pair, bool isPair);
    event TaxExemptSet(address indexed account, bool exempt);
    event TaxCollected(address indexed from, address indexed to, uint256 toRewards, uint256 toTreasury);

    constructor() {
        _disableInitializers();
    }

    /**
     * @param _holder receives the entire supply — the deployer, who seeds
     *        liquidity and funds the rewards pool.
     *
     * PASSED IN RATHER THAN `msg.sender`. Through a proxy this runs as a
     * delegatecall from the proxy's constructor, and relying on who that makes
     * `msg.sender` is exactly the kind of thing that is fine until the day
     * something deploys through a factory.
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        address _rewardsPool,
        address _treasury,
        string memory _logo,
        string memory _description,
        address _holder
    ) external initializer {
        require(_rewardsPool != address(0) && _treasury != address(0), "ZERO_DESTINATION");
        require(_holder != address(0), "ZERO_HOLDER");
        owner = _holder;
        name = _name;
        symbol = _symbol;
        logo = _logo;
        description = _description;
        rewardsPool = _rewardsPool;
        treasury = _treasury;

        buyTaxBps = 200; // 2%
        sellTaxBps = 200; // 2%
        rewardsShareBps = 7500; // 75% of the tax goes to players

        // The whole supply goes to the deployer, who seeds liquidity and funds
        // the rewards pool. There is no mint function: this is all of it, ever.
        totalSupply = _supply;
        balanceOf[_holder] = _supply;

        // Nothing internal to the game ever pays tax.
        isTaxExempt[_holder] = true;
        isTaxExempt[_rewardsPool] = true;
        isTaxExempt[_treasury] = true;
        isTaxExempt[address(this)] = true;

        emit OwnershipTransferred(address(0), _holder);
        emit Transfer(address(0), _holder, _supply);
        emit TaxChanged(200, 200);
        emit TaxSplitChanged(7500);
        emit TaxDestinationsChanged(_rewardsPool, _treasury);
    }

    /**
     * Only the owner may upgrade.
     *
     * READ THIS BEFORE MAINNET. An upgradeable token is a different promise
     * from an immutable one: "fixed supply, no mint function" stops being a
     * property of the code and becomes a promise by whoever holds this key,
     * because an upgrade can add one. That is acceptable while the game's
     * rules are still moving; it is not acceptable for a token people are
     * asked to buy. Put this behind a timelock — or renounce it — before
     * there is real money in it.
     */
    function _authorizeUpgrade(address) internal view override onlyOwner {}

    // --- admin ------------------------------------------------------------

    function setTax(uint16 buyBps, uint16 sellBps) external onlyOwner {
        require(buyBps <= MAX_TAX_BPS && sellBps <= MAX_TAX_BPS, "TAX_TOO_HIGH");
        buyTaxBps = buyBps;
        sellTaxBps = sellBps;
        emit TaxChanged(buyBps, sellBps);
    }

    function setRewardsShare(uint16 bps) external onlyOwner {
        require(bps >= MIN_REWARDS_SHARE_BPS && bps <= 10_000, "SHARE_OUT_OF_RANGE");
        rewardsShareBps = bps;
        emit TaxSplitChanged(bps);
    }

    function setTaxDestinations(address _rewardsPool, address _treasury) external onlyOwner {
        require(_rewardsPool != address(0) && _treasury != address(0), "ZERO_DESTINATION");
        rewardsPool = _rewardsPool;
        treasury = _treasury;
        isTaxExempt[_rewardsPool] = true;
        isTaxExempt[_treasury] = true;
        emit TaxDestinationsChanged(_rewardsPool, _treasury);
    }

    /// @notice Register an AMM pair. Until one is registered NOTHING is taxed,
    ///         which is exactly the state the game runs in on a testnet with
    ///         no liquidity.
    function setPair(address pair, bool value) external onlyOwner {
        require(pair != address(0), "ZERO_PAIR");
        isPair[pair] = value;
        if (value && liquidityPool == address(0)) liquidityPool = pair;
        emit PairSet(pair, value);
    }

    function setLiquidityPool(address pool) external onlyOwner {
        liquidityPool = pool;
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    function setMetadata(string calldata _logo, string calldata _description) external onlyOwner {
        logo = _logo;
        description = _description;
    }

    function setSocials(
        string calldata twitter,
        string calldata telegram,
        string calldata discord,
        string calldata website,
        string calldata farcaster
    ) external onlyOwner {
        _socials = Socials(twitter, telegram, discord, website, farcaster);
    }

    // --- ERC-20 core ------------------------------------------------------

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // The infinite-allowance convention: skip the write when it would be a
        // no-op, so approving max once costs one SSTORE forever.
        if (allowed != type(uint256).max) {
            require(allowed >= value, "INSUFFICIENT_ALLOWANCE");
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Burn your own tokens. Nobody else can burn yours.
    function burn(uint256 value) external {
        require(balanceOf[msg.sender] >= value, "INSUFFICIENT_BALANCE");
        unchecked {
            balanceOf[msg.sender] -= value;
            totalSupply -= value;
        }
        emit Transfer(msg.sender, address(0), value);
    }

    /// @notice What `to` will actually receive if `from` sends `value` now.
    ///         Anything quoting a price should ask this rather than assume.
    function amountAfterTax(address from, address to, uint256 value) public view returns (uint256) {
        return value - _taxOn(from, to, value);
    }

    function _taxOn(address from, address to, uint256 value) private view returns (uint256) {
        if (isTaxExempt[from] || isTaxExempt[to]) return 0;
        uint16 bps = isPair[from] ? buyTaxBps : (isPair[to] ? sellTaxBps : 0);
        if (bps == 0) return 0;
        return (value * bps) / 10_000;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ZERO_TO");
        uint256 balance = balanceOf[from];
        require(balance >= value, "INSUFFICIENT_BALANCE");
        unchecked {
            balanceOf[from] = balance - value;
        }

        uint256 tax = _taxOn(from, to, value);
        if (tax != 0) {
            // Split in place. No swapping, no callbacks, no "swapAndLiquify"
            // reentering the router mid-transfer — the two destinations are
            // plain balance writes, which is why this cannot fail or be
            // sandwiched.
            uint256 toRewards = (tax * rewardsShareBps) / 10_000;
            uint256 toTreasury = tax - toRewards;
            unchecked {
                balanceOf[rewardsPool] += toRewards;
                balanceOf[treasury] += toTreasury;
            }
            if (toRewards != 0) emit Transfer(from, rewardsPool, toRewards);
            if (toTreasury != 0) emit Transfer(from, treasury, toTreasury);
            emit TaxCollected(from, to, toRewards, toTreasury);
        }

        uint256 received = value - tax;
        unchecked {
            balanceOf[to] += received;
        }
        emit Transfer(from, to, received);
    }

    /// Room for state a later version adds. Append and shrink this by the same
    /// number of slots; never reorder or retype what is above.
    uint256[45] private __gap;
}
