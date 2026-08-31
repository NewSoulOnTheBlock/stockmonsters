// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "./Upgradeable.sol";

interface IERC20Gym {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title StockmonstersGyms — players become the gym leaders
///
/// A gym is a place on the map somebody owns. They stake tokens to hold it;
/// anyone may pay an entry fee to fight them for it.
///
///   challenger loses  ->  the fee splits between the holder and the treasury
///   challenger wins   ->  they take the gym, and a slice of the old holder's
///                         stake comes with it
///
/// ## Why this shape and not a wager
///
/// Every payout here comes out of an entry fee somebody chose to pay. The
/// contract mints nothing, the treasury funds nothing, and there is no
/// emission schedule to run dry — so the loop is solvent by construction. It
/// is also a tournament with an entry fee rather than a bet between two
/// people, which is a materially different thing in most jurisdictions.
///
/// ## The trust boundary, stated plainly
///
/// The chain cannot watch a battle. `settle` therefore takes the word of
/// `resultSigner`, a key the game server holds. That is the same shape as the
/// sealed box and the reward pool, and it is bounded the same way:
///
///   · a result is bound to ONE challenge (gym, challenger, and the timestamp
///     the challenge opened), so a signature cannot be replayed against the
///     next one;
///   · results expire;
///   · `resolveTimeout` lets the CHALLENGER take their money back if no result
///     is signed in time — a dead server can never hold a stake hostage;
///   · the owner can pause new challenges, and cannot touch a stake at all;
///   · `maxStake` bounds what a single compromised signature can move.
///
/// Nothing in here can take a holder's stake except losing a challenge that
/// the holder's own gym accepted.
contract StockmonstersGyms is UUPSUpgradeable {
    string public constant name = "StockmonstersGyms";

    /// Not `immutable`: an immutable lives in the implementation's CODE, so
    /// behind a proxy it would hold whatever that implementation was deployed
    /// with rather than what this proxy was initialised with.
    IERC20Gym public token;

    /* ------------------------------------------------------- ownership ---*/
    address public owner;
    address public pendingOwner;
    /// Signs battle results. The game server; never the owner's key.
    address public resultSigner;
    /// Where the house's share of an entry fee goes.
    address public treasury;
    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    /* ------------------------------------------------------------ rules ---*/

    /// The smallest stake that may hold a gym. A gym nobody can afford to lose
    /// is not a contest.
    uint256 public minStake;
    /// The largest. Bounds what one bad signature can move.
    uint256 public maxStake;
    /// The entry fee, as a share of the holder's stake. 500 = 5%.
    uint16 public entryFeeBps;
    /// Of a lost challenge's fee, what the holder keeps. The rest is treasury.
    uint16 public holderShareBps;
    /// What a winning challenger takes out of the old holder's stake.
    uint16 public takeoverBountyBps;
    /// How long the server has to sign a result before the challenger may walk.
    uint64 public resultWindow;
    /// How long after a settled challenge a gym is safe from the next one.
    uint64 public cooldown;

    uint16 public constant MAX_ENTRY_FEE_BPS = 2000; // 20%, hard cap
    uint16 public constant MAX_BOUNTY_BPS = 5000; // half a stake, hard cap

    /* ------------------------------------------------------------ state ---*/

    struct Gym {
        address holder;
        uint256 stake;
        uint64 heldSince;
        /// Zero when nobody is fighting for it.
        address challenger;
        uint64 challengeAt;
        uint256 entryFee;
        uint256 challengerStake;
        uint64 quietUntil;
    }

    /// gymId => the gym. Ids are just numbers the game assigns to places.
    mapping(uint256 => Gym) public gyms;
    /// Gyms held per address, so a leaderboard does not need an indexer.
    mapping(address => uint256) public gymsHeld;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "GymResult(uint256 gymId,address challenger,uint64 challengeAt,bool challengerWon,uint64 deadline)"
    );

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ResultSignerChanged(address indexed signer);
    event TreasuryChanged(address indexed treasury);
    event RulesChanged(uint256 minStake, uint256 maxStake, uint16 entryFeeBps, uint16 holderShareBps, uint16 bountyBps);
    event PausedSet(bool paused);
    event Claimed(uint256 indexed gymId, address indexed holder, uint256 stake);
    event Abandoned(uint256 indexed gymId, address indexed holder, uint256 stake);
    event Challenged(uint256 indexed gymId, address indexed challenger, uint256 entryFee, uint256 stake);
    event Settled(
        uint256 indexed gymId,
        address indexed challenger,
        address indexed holder,
        bool challengerWon,
        uint256 toHolder,
        uint256 toTreasury,
        uint256 bounty
    );
    event ChallengeTimedOut(uint256 indexed gymId, address indexed challenger, uint256 refunded);

    /* ------------------------------------------------- reentrancy guard ---*/
    /// Set in `initialize`, NOT inline. An inline initializer runs in the
    /// implementation's constructor and never touches the proxy's storage.
    uint256 private _lock;

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANCY");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _treasury,
        address _resultSigner,
        uint256 _minStake,
        uint256 _maxStake,
        address _owner
    ) external initializer {
        require(_token != address(0) && _treasury != address(0), "ZERO_ADDRESS");
        require(_minStake > 0 && _maxStake >= _minStake, "BAD_STAKE_RANGE");
        require(_owner != address(0), "ZERO_OWNER");
        // Everything that used to be an inline field initializer.
        entryFeeBps = 500;
        holderShareBps = 7000;
        takeoverBountyBps = 2000;
        resultWindow = 30 minutes;
        cooldown = 5 minutes;
        _lock = 1;
        token = IERC20Gym(_token);
        owner = _owner;
        treasury = _treasury;
        resultSigner = _resultSigner;
        minStake = _minStake;
        maxStake = _maxStake;
        emit OwnershipTransferred(address(0), _owner);
        emit ResultSignerChanged(_resultSigner);
        emit TreasuryChanged(_treasury);
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {}

    /* ------------------------------------------------------------ admin ---*/

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

    function setResultSigner(address signer) external onlyOwner {
        resultSigner = signer;
        emit ResultSignerChanged(signer);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "ZERO_ADDRESS");
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }

    /// @notice Pause NEW challenges. Never blocks a settle, a timeout refund or
    ///         an abandon: money already in here must always be able to leave.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    function setRules(
        uint256 _minStake,
        uint256 _maxStake,
        uint16 _entryFeeBps,
        uint16 _holderShareBps,
        uint16 _bountyBps
    ) external onlyOwner {
        require(_minStake > 0 && _maxStake >= _minStake, "BAD_STAKE_RANGE");
        require(_entryFeeBps > 0 && _entryFeeBps <= MAX_ENTRY_FEE_BPS, "BAD_ENTRY_FEE");
        require(_holderShareBps <= 10_000, "BAD_SHARE");
        require(_bountyBps <= MAX_BOUNTY_BPS, "BAD_BOUNTY");
        minStake = _minStake;
        maxStake = _maxStake;
        entryFeeBps = _entryFeeBps;
        holderShareBps = _holderShareBps;
        takeoverBountyBps = _bountyBps;
        emit RulesChanged(_minStake, _maxStake, _entryFeeBps, _holderShareBps, _bountyBps);
    }

    function setTimings(uint64 _resultWindow, uint64 _cooldown) external onlyOwner {
        require(_resultWindow >= 5 minutes && _resultWindow <= 24 hours, "BAD_WINDOW");
        resultWindow = _resultWindow;
        cooldown = _cooldown;
    }

    /* ------------------------------------------------------------ views ---*/

    function entryFeeFor(uint256 gymId) public view returns (uint256) {
        return (gyms[gymId].stake * entryFeeBps) / 10_000;
    }

    function isUnderChallenge(uint256 gymId) public view returns (bool) {
        Gym storage g = gyms[gymId];
        return g.challenger != address(0) && block.timestamp <= g.challengeAt + resultWindow;
    }

    /* ------------------------------------------------------- holding it ---*/

    /// @notice Take an unheld gym by staking on it.
    function claimGym(uint256 gymId, uint256 stake) external nonReentrant {
        require(!paused, "PAUSED");
        Gym storage g = gyms[gymId];
        require(g.holder == address(0), "ALREADY_HELD");
        require(stake >= minStake && stake <= maxStake, "STAKE_OUT_OF_RANGE");
        _pull(msg.sender, stake);

        g.holder = msg.sender;
        g.stake = stake;
        g.heldSince = uint64(block.timestamp);
        gymsHeld[msg.sender] += 1;
        emit Claimed(gymId, msg.sender, stake);
    }

    /// @notice Give up a gym and take the stake back. Refused while a
    ///         challenge is live: walking away mid-fight would be a way to
    ///         dodge losing one.
    function abandonGym(uint256 gymId) external nonReentrant {
        Gym storage g = gyms[gymId];
        require(g.holder == msg.sender, "NOT_HOLDER");
        require(!isUnderChallenge(gymId), "UNDER_CHALLENGE");
        uint256 stake = g.stake;
        gymsHeld[msg.sender] -= 1;
        _clear(g);
        _push(msg.sender, stake);
        emit Abandoned(gymId, msg.sender, stake);
    }

    /* ----------------------------------------------------- fighting for it */

    /// @notice Pay the entry fee, post your own stake, and fight for the gym.
    /// @param stakeIfWon what you will hold the gym with when you win. Posted
    ///        now and returned untouched if you lose — a challenger who wins
    ///        has to be able to hold what they took.
    function challenge(uint256 gymId, uint256 stakeIfWon) external nonReentrant {
        require(!paused, "PAUSED");
        Gym storage g = gyms[gymId];
        require(g.holder != address(0), "NOT_HELD");
        require(g.holder != msg.sender, "OWN_GYM");
        require(block.timestamp >= g.quietUntil, "COOLING_DOWN");
        require(!isUnderChallenge(gymId), "ALREADY_CHALLENGED");
        require(stakeIfWon >= minStake && stakeIfWon <= maxStake, "STAKE_OUT_OF_RANGE");

        uint256 fee = entryFeeFor(gymId);
        require(fee > 0, "NO_FEE");
        _pull(msg.sender, fee + stakeIfWon);

        // A previous challenge that ran out of time without being settled is
        // overwritten here — but only after its money went back, which
        // resolveTimeout does. Guard it, or a stale entry is silently lost.
        require(g.challenger == address(0) || g.entryFee == 0, "PREVIOUS_UNRESOLVED");

        g.challenger = msg.sender;
        g.challengeAt = uint64(block.timestamp);
        g.entryFee = fee;
        g.challengerStake = stakeIfWon;
        emit Challenged(gymId, msg.sender, fee, stakeIfWon);
    }

    /// @notice The battle happened; the server says who won.
    ///
    /// Anyone may submit the signature — it names the outcome, so who relays
    /// it changes nothing, and letting the winner send it means the loser
    /// cannot stall by simply never transacting.
    function settle(
        uint256 gymId,
        address challenger,
        uint64 challengeAt,
        bool challengerWon,
        uint64 deadline,
        bytes calldata signature
    ) external nonReentrant {
        require(block.timestamp <= deadline, "RESULT_EXPIRED");
        Gym storage g = gyms[gymId];
        require(g.challenger == challenger && challenger != address(0), "NO_SUCH_CHALLENGE");
        // Binding the OPENING TIME is what stops one signed result being
        // replayed against the next challenge on the same gym.
        require(g.challengeAt == challengeAt, "STALE_RESULT");
        require(block.timestamp <= g.challengeAt + resultWindow, "CHALLENGE_TIMED_OUT");

        bytes32 digest = hashResult(gymId, challenger, challengeAt, challengerWon, deadline);
        require(_recover(digest, signature) == resultSigner, "BAD_SIGNATURE");

        address holder = g.holder;
        uint256 fee = g.entryFee;
        uint256 challengerStake = g.challengerStake;
        uint256 holderStake = g.stake;

        // --- effects, before a single token moves --------------------------
        g.challenger = address(0);
        g.entryFee = 0;
        g.challengerStake = 0;
        g.quietUntil = uint64(block.timestamp) + cooldown;

        uint256 toHolder;
        uint256 toTreasury;
        uint256 bounty;

        if (!challengerWon) {
            // The gym holds. The fee is the prize for defending it.
            toHolder = (fee * holderShareBps) / 10_000;
            toTreasury = fee - toHolder;
            _push(challenger, challengerStake); // their stake was never at risk
            _push(holder, toHolder);
            _push(treasury, toTreasury);
        } else {
            // The gym changes hands. The old holder keeps their stake minus a
            // bounty — losing costs a slice, not everything, or nobody would
            // ever take a gym in the first place.
            bounty = (holderStake * takeoverBountyBps) / 10_000;
            toHolder = (fee * holderShareBps) / 10_000; // the fee still pays out
            toTreasury = fee - toHolder;

            g.holder = challenger;
            g.stake = challengerStake;
            g.heldSince = uint64(block.timestamp);
            gymsHeld[holder] -= 1;
            gymsHeld[challenger] += 1;

            _push(holder, holderStake - bounty + toHolder);
            _push(challenger, bounty);
            _push(treasury, toTreasury);
        }

        emit Settled(gymId, challenger, holder, challengerWon, toHolder, toTreasury, bounty);
    }

    /// @notice No result in time: the challenger takes their money back.
    ///
    /// A server that crashes mid-battle must never be able to keep a stake.
    /// Callable by anyone, because the money can only ever go back to the
    /// challenger.
    function resolveTimeout(uint256 gymId) external nonReentrant {
        Gym storage g = gyms[gymId];
        address challenger = g.challenger;
        require(challenger != address(0), "NO_SUCH_CHALLENGE");
        require(block.timestamp > g.challengeAt + resultWindow, "STILL_IN_TIME");

        uint256 refund = g.entryFee + g.challengerStake;
        g.challenger = address(0);
        g.entryFee = 0;
        g.challengerStake = 0;
        _push(challenger, refund);
        emit ChallengeTimedOut(gymId, challenger, refund);
    }

    /* --------------------------------------------------------- signing ---*/

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)));
    }

    function hashResult(
        uint256 gymId,
        address challenger,
        uint64 challengeAt,
        bool challengerWon,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(RESULT_TYPEHASH, gymId, challenger, challengeAt, challengerWon, deadline));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /* -------------------------------------------------------- internals ---*/

    /// Pull tokens and CHECK THEY ARRIVED. A fee-on-transfer token would
    /// otherwise leave the contract owing more than it holds.
    function _pull(address from, uint256 amount) private {
        if (amount == 0) return;
        uint256 before = token.balanceOf(address(this));
        require(token.transferFrom(from, address(this), amount), "TRANSFER_FAILED");
        require(token.balanceOf(address(this)) - before == amount, "TRANSFER_SHORTFALL");
    }

    function _push(address to, uint256 amount) private {
        if (amount == 0 || to == address(0)) return;
        require(token.transfer(to, amount), "TRANSFER_FAILED");
    }

    function _clear(Gym storage g) private {
        g.holder = address(0);
        g.stake = 0;
        g.heldSince = 0;
        g.challenger = address(0);
        g.challengeAt = 0;
        g.entryFee = 0;
        g.challengerStake = 0;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "BAD_SIG_LEN");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "BAD_SIG_V");
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "BAD_SIG_S");
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "BAD_SIGNATURE");
        return recovered;
    }

    /// Room for state a later version adds. Append and shrink this by the same
    /// number of slots; never reorder or retype what is above.
    uint256[45] private __gap;
}
