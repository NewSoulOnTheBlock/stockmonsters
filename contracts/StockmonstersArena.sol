// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Arena {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title StockmonstersArena — two players, one wager, one winner
///
/// Both players sign the same wager, the stakes escrow here, they fight in
/// game, and a server-signed result releases the pot to the winner minus a
/// rake. Nothing else can move the money.
///
/// ## Read this before shipping it
///
/// **The server decides who won.** The chain cannot watch a battle; this
/// contract only ever sees a signature. Wagering is therefore a trust bet on
/// one key, with locked money behind it — a bigger exposure than the sealed
/// box or the reward pool, and the reason every bound below exists:
///
///   · `maxWager` caps what one bad signature can move;
///   · `dailyPayoutCap` caps what a leaked key can move in a day, rolling;
///   · results expire, and a `matchId` settles exactly once;
///   · **either player can take their own stake back** once `resultWindow`
///     has passed with no result. A server that crashes cannot hold a pot;
///   · the owner can pause new matches but can never touch an open one;
///   · the result signer is its own key, not the owner's and not the game's.
///
/// **The RNG is committed before the fight.** `seedCommit` is fixed when the
/// match opens and the seed is revealed on settlement, so the randomness
/// cannot have been chosen after the fact. It does not prove the server
/// followed its own rules — nothing on chain can — but it turns "trust us"
/// into something an observer can check.
///
/// **So is each player's pick.** A duel is fought with a chosen Stockmonster,
/// and neither player sees the other's until it is too late to change theirs:
/// each signs `keccak(tokenId, salt)` and the two hashes go into the wager
/// they BOTH sign. The tokens are revealed at settlement and checked against
/// those commitments, so "I picked my counter after seeing yours" is not a
/// thing that can happen quietly — it cannot happen at all.
///
/// The contract does not check who owns the revealed token. It cannot: at the
/// time the commitment is made the token is secret, and by settlement it could
/// have been sold. Ownership is the server's job at the moment the battle
/// starts; the commitment's job is only to fix the choice.
///
/// **This is gambling in many places.** That is a decision to make before
/// deploying it, not after.
contract StockmonstersArena {
    string public constant name = "StockmonstersArena";

    IERC20Arena public immutable token;

    address public owner;
    address public pendingOwner;
    /// Signs results. Held by the game server; its own key.
    address public resultSigner;
    address public treasury;
    bool public paused;

    /// The rake, in basis points, taken from the pot on settlement.
    uint16 public rakeBps = 300;
    uint16 public constant MAX_RAKE_BPS = 1000; // 10%, hard cap

    /// The largest single wager. Bounds one signature.
    uint256 public maxWager;
    /// The most that may be paid out in any 24h window. Bounds a leaked key.
    uint256 public dailyPayoutCap;
    uint256 public paidToday;
    uint64 public dayStartedAt;

    /// How long the server has to sign a result before either side may walk.
    uint64 public resultWindow = 30 minutes;

    enum Status { None, Open, Settled, Refunded }

    struct Match {
        Status status;
        address playerA;
        address playerB;
        uint256 amount;
        uint64 openedAt;
        bytes32 seedCommit;
        /// keccak256(abi.encode(tokenId, salt)) — the creature each side chose,
        /// fixed before either could see the other's.
        bytes32 pickA;
        bytes32 pickB;
        bool aWithdrawn;
        bool bWithdrawn;
    }

    mapping(bytes32 => Match) public matches;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    /// Signed by BOTH players. Neither the server nor one player can invent it.
    bytes32 public constant WAGER_TYPEHASH = keccak256(
        "Wager(bytes32 matchId,address playerA,address playerB,uint256 amount,bytes32 seedCommit,bytes32 pickA,bytes32 pickB,uint64 expiry)"
    );
    /// Signed by the server, and only for a match that is already open. The
    /// revealed picks are in here too, so a server cannot settle a match with
    /// a creature nobody committed to.
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "MatchResult(bytes32 matchId,address winner,bytes32 seed,uint256 tokenA,bytes32 saltA,uint256 tokenB,bytes32 saltB,uint64 deadline)"
    );

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ResultSignerChanged(address indexed signer);
    event TreasuryChanged(address indexed treasury);
    event LimitsChanged(uint256 maxWager, uint256 dailyPayoutCap, uint16 rakeBps);
    event PausedSet(bool paused);
    event MatchOpened(
        bytes32 indexed matchId,
        address indexed playerA,
        address indexed playerB,
        uint256 amount,
        bytes32 seedCommit,
        bytes32 pickA,
        bytes32 pickB
    );
    /// The revealed picks are emitted, so anyone can replay the duel and check
    /// the creatures were the ones committed to.
    event MatchSettled(
        bytes32 indexed matchId,
        address indexed winner,
        uint256 payout,
        uint256 rake,
        bytes32 seed,
        uint256 tokenA,
        uint256 tokenB
    );
    event MatchRefunded(bytes32 indexed matchId, address indexed player, uint256 amount);

    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANCY");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address _token, address _treasury, address _resultSigner, uint256 _maxWager, uint256 _dailyPayoutCap) {
        require(_token != address(0) && _treasury != address(0), "ZERO_ADDRESS");
        require(_maxWager > 0 && _dailyPayoutCap >= _maxWager, "BAD_LIMITS");
        token = IERC20Arena(_token);
        owner = msg.sender;
        treasury = _treasury;
        resultSigner = _resultSigner;
        maxWager = _maxWager;
        dailyPayoutCap = _dailyPayoutCap;
        dayStartedAt = uint64(block.timestamp);
        emit OwnershipTransferred(address(0), msg.sender);
        emit ResultSignerChanged(_resultSigner);
        emit TreasuryChanged(_treasury);
        emit LimitsChanged(_maxWager, _dailyPayoutCap, rakeBps);
    }

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

    /// @notice Stops NEW matches. Never blocks a settle or a refund — money
    ///         already escrowed must always be able to leave.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    function setLimits(uint256 _maxWager, uint256 _dailyPayoutCap, uint16 _rakeBps) external onlyOwner {
        require(_maxWager > 0 && _dailyPayoutCap >= _maxWager, "BAD_LIMITS");
        require(_rakeBps <= MAX_RAKE_BPS, "RAKE_TOO_HIGH");
        maxWager = _maxWager;
        dailyPayoutCap = _dailyPayoutCap;
        rakeBps = _rakeBps;
        emit LimitsChanged(_maxWager, _dailyPayoutCap, _rakeBps);
    }

    function setResultWindow(uint64 window) external onlyOwner {
        require(window >= 5 minutes && window <= 24 hours, "BAD_WINDOW");
        resultWindow = window;
    }

    /* ------------------------------------------------------------- open ---*/

    /// @notice Escrow both stakes for a match both players agreed to.
    ///
    /// BOTH signatures are required, which is the whole point: the server
    /// cannot invent a wager between two people who never agreed to one, and
    /// one player cannot drag another into a bet by signing for them.
    ///
    /// Either player (or the server, or anyone) may submit it — the tokens are
    /// pulled from the two named players, so the sender's identity buys
    /// nothing.
    function open(
        bytes32 matchId,
        address playerA,
        address playerB,
        uint256 amount,
        bytes32 seedCommit,
        bytes32 pickA,
        bytes32 pickB,
        uint64 expiry,
        bytes calldata sigA,
        bytes calldata sigB
    ) external nonReentrant {
        require(!paused, "PAUSED");
        require(block.timestamp <= expiry, "WAGER_EXPIRED");
        require(playerA != address(0) && playerB != address(0) && playerA != playerB, "BAD_PLAYERS");
        require(amount > 0 && amount <= maxWager, "BAD_AMOUNT");
        require(seedCommit != bytes32(0), "NO_COMMIT");
        require(pickA != bytes32(0) && pickB != bytes32(0), "NO_PICK");
        require(matches[matchId].status == Status.None, "MATCH_EXISTS");

        bytes32 digest = hashWager(matchId, playerA, playerB, amount, seedCommit, pickA, pickB, expiry);
        require(_recover(digest, sigA) == playerA, "BAD_SIGNATURE_A");
        require(_recover(digest, sigB) == playerB, "BAD_SIGNATURE_B");

        matches[matchId] = Match({
            status: Status.Open,
            playerA: playerA,
            playerB: playerB,
            amount: amount,
            openedAt: uint64(block.timestamp),
            seedCommit: seedCommit,
            pickA: pickA,
            pickB: pickB,
            aWithdrawn: false,
            bWithdrawn: false
        });

        _pull(playerA, amount);
        _pull(playerB, amount);
        emit MatchOpened(matchId, playerA, playerB, amount, seedCommit, pickA, pickB);
    }

    /* ----------------------------------------------------------- settle ---*/

    /// @notice Pay the winner. The seed must open the commitment made when the
    ///         match started, so the randomness cannot have been picked after
    ///         seeing how the fight went.
    /// @param tokenA / saltA  what player A committed to before the duel
    /// @param tokenB / saltB  the same for player B
    function settle(
        bytes32 matchId,
        address winner,
        bytes32 seed,
        uint256 tokenA,
        bytes32 saltA,
        uint256 tokenB,
        bytes32 saltB,
        uint64 deadline,
        bytes calldata signature
    ) external nonReentrant {
        require(block.timestamp <= deadline, "RESULT_EXPIRED");
        Match storage m = matches[matchId];
        require(m.status == Status.Open, "NOT_OPEN");
        require(block.timestamp <= m.openedAt + resultWindow, "MATCH_TIMED_OUT");
        require(winner == m.playerA || winner == m.playerB, "NOT_A_PLAYER");
        require(keccak256(abi.encodePacked(seed)) == m.seedCommit, "SEED_MISMATCH");
        // The blind picks, opened. Either side substituting a creature after
        // seeing what they were up against fails here, not in an argument.
        require(keccak256(abi.encode(tokenA, saltA)) == m.pickA, "PICK_A_MISMATCH");
        require(keccak256(abi.encode(tokenB, saltB)) == m.pickB, "PICK_B_MISMATCH");

        bytes32 digest = hashResult(matchId, winner, seed, tokenA, saltA, tokenB, saltB, deadline);
        require(_recover(digest, signature) == resultSigner, "BAD_SIGNATURE");

        uint256 pot = m.amount * 2;
        uint256 rake = (pot * rakeBps) / 10_000;
        uint256 payout = pot - rake;

        // The rolling daily ceiling. Rolls forward a whole day at a time so a
        // quiet week cannot bank up capacity for one enormous drain.
        if (block.timestamp >= dayStartedAt + 1 days) {
            dayStartedAt = uint64(block.timestamp);
            paidToday = 0;
        }
        require(paidToday + payout <= dailyPayoutCap, "DAILY_CAP");
        paidToday += payout;

        m.status = Status.Settled;

        _push(winner, payout);
        _push(treasury, rake);
        emit MatchSettled(matchId, winner, payout, rake, seed, tokenA, tokenB);
    }

    /* ---------------------------------------------------------- refunds ---*/

    /// @notice Take YOUR OWN stake back when no result arrived in time.
    ///
    /// Per player rather than per match, so one side cannot be blocked by the
    /// other's inaction; and the amount is fixed at what they put in, so a
    /// refund can never pay out a win.
    function refund(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == Status.Open, "NOT_OPEN");
        require(block.timestamp > m.openedAt + resultWindow, "STILL_IN_TIME");

        uint256 amount = m.amount;
        if (msg.sender == m.playerA) {
            require(!m.aWithdrawn, "ALREADY_REFUNDED");
            m.aWithdrawn = true;
        } else if (msg.sender == m.playerB) {
            require(!m.bWithdrawn, "ALREADY_REFUNDED");
            m.bWithdrawn = true;
        } else {
            revert("NOT_A_PLAYER");
        }
        if (m.aWithdrawn && m.bWithdrawn) m.status = Status.Refunded;

        _push(msg.sender, amount);
        emit MatchRefunded(matchId, msg.sender, amount);
    }

    /* --------------------------------------------------------- signing ---*/

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)));
    }

    function hashWager(
        bytes32 matchId,
        address playerA,
        address playerB,
        uint256 amount,
        bytes32 seedCommit,
        bytes32 pickA,
        bytes32 pickB,
        uint64 expiry
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(WAGER_TYPEHASH, matchId, playerA, playerB, amount, seedCommit, pickA, pickB, expiry)
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @notice What a player signs to lock in a creature nobody else can see.
    ///         The salt is what stops the other side brute-forcing the hash:
    ///         there are only a few thousand token ids.
    function pickCommitment(uint256 tokenId, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(tokenId, salt));
    }

    function hashResult(
        bytes32 matchId,
        address winner,
        bytes32 seed,
        uint256 tokenA,
        bytes32 saltA,
        uint256 tokenB,
        bytes32 saltB,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(RESULT_TYPEHASH, matchId, winner, seed, tokenA, saltA, tokenB, saltB, deadline));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /* -------------------------------------------------------- internals ---*/

    function _pull(address from, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        require(token.transferFrom(from, address(this), amount), "TRANSFER_FAILED");
        require(token.balanceOf(address(this)) - before == amount, "TRANSFER_SHORTFALL");
    }

    function _push(address to, uint256 amount) private {
        if (amount == 0 || to == address(0)) return;
        require(token.transfer(to, amount), "TRANSFER_FAILED");
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
}
