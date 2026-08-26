// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TestHelpers.sol";
import "./StockmonstersToken.sol";
import "./StockmonstersGyms.sol";
import "./StockmonstersArena.sol";

/// Gyms and wagered PvP.
///
/// Both contracts hold other people's money against a promise a server makes,
/// so the cases that matter are the ones where that promise fails: a signature
/// replayed against the next fight, a server that never answers, a leaked
/// signer, a player who walks away mid-match. Anything that only tests the
/// happy path is testing the easy half.

contract PvpBase {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant SIGNER_PK = 0x5169;
    uint256 constant ALICE_PK = 0xA11CE;
    uint256 constant BOB_PK = 0xB0B;
    uint64 constant FAR_FUTURE = 4_000_000_000;

    StockmonstersToken token;
    address treasury = address(0x7EA);
    address alice;
    address bob;
    address carol = address(0xCA401);

    function _setUpToken() internal {
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        token = new StockmonstersToken(
            "Stockmonsters", "SMON", 1_000_000 ether, address(0x1111), treasury, "", ""
        );
        vm.warp(1_000_000);
        token.transfer(alice, 100_000 ether);
        token.transfer(bob, 100_000 ether);
        token.transfer(carol, 100_000 ether);
    }

    function _sign(uint256 pk, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

/* ================================================================= GYMS ===*/

contract GymsTest is PvpBase {
    StockmonstersGyms gyms;

    uint256 constant MIN_STAKE = 1_000 ether;
    uint256 constant MAX_STAKE = 50_000 ether;

    function setUp() public {
        _setUpToken();
        gyms = new StockmonstersGyms(address(token), treasury, vm.addr(SIGNER_PK), MIN_STAKE, MAX_STAKE);
        token.setTaxExempt(address(gyms), true);
        vm.prank(alice);
        token.approve(address(gyms), type(uint256).max);
        vm.prank(bob);
        token.approve(address(gyms), type(uint256).max);
        vm.prank(carol);
        token.approve(address(gyms), type(uint256).max);
    }

    function _hold(address who, uint256 gymId, uint256 stake) internal {
        vm.prank(who);
        gyms.claimGym(gymId, stake);
    }

    function _resultSig(uint256 gymId, address challenger, uint64 challengeAt, bool won)
        internal
        returns (bytes memory)
    {
        return _sign(SIGNER_PK, gyms.hashResult(gymId, challenger, challengeAt, won, FAR_FUTURE));
    }

    function test_holdingAGymLocksTheStake() public {
        _hold(alice, 1, 10_000 ether);
        (address holder, uint256 stake,,,,,,) = gyms.gyms(1);
        require(holder == alice, "holder");
        require(stake == 10_000 ether, "stake");
        require(token.balanceOf(alice) == 90_000 ether, "pulled");
        require(gyms.gymsHeld(alice) == 1, "counted");
    }

    function test_aStakeTooSmallToLoseIsRefused() public {
        vm.prank(alice);
        vm.expectRevert(bytes("STAKE_OUT_OF_RANGE"));
        gyms.claimGym(1, MIN_STAKE - 1);
    }

    function test_aStakeAboveTheCapIsRefused() public {
        // The cap is what bounds one compromised signature.
        vm.prank(alice);
        vm.expectRevert(bytes("STAKE_OUT_OF_RANGE"));
        gyms.claimGym(1, MAX_STAKE + 1);
    }

    function test_youCannotTakeAHeldGym() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("ALREADY_HELD"));
        gyms.claimGym(1, 10_000 ether);
    }

    function test_challengingCostsAFeeAndYourOwnStake() public {
        _hold(alice, 1, 10_000 ether);
        uint256 fee = gyms.entryFeeFor(1);
        require(fee == 500 ether, "5% of the stake");

        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        require(token.balanceOf(bob) == 100_000 ether - fee - 2_000 ether, "fee plus stake escrowed");
        require(gyms.isUnderChallenge(1), "live");
    }

    function test_youCannotChallengeYourOwnGym() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("OWN_GYM"));
        gyms.challenge(1, 2_000 ether);
    }

    function test_oneChallengeAtATime() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        vm.prank(carol);
        vm.expectRevert(bytes("ALREADY_CHALLENGED"));
        gyms.challenge(1, 2_000 ether);
    }

    function test_losingPaysTheHolderAndTheTreasuryAndReturnsTheStake() public {
        _hold(alice, 1, 10_000 ether);
        uint256 fee = gyms.entryFeeFor(1);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 challengeAt,,,) = gyms.gyms(1);

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 treasuryBefore = token.balanceOf(treasury);
        gyms.settle(1, bob, challengeAt, false, FAR_FUTURE, _resultSig(1, bob, challengeAt, false));

        require(token.balanceOf(alice) - aliceBefore == (fee * 70) / 100, "holder keeps 70%");
        require(token.balanceOf(treasury) - treasuryBefore == fee - (fee * 70) / 100, "treasury takes the rest");
        // The challenger's own stake was never at risk — only the entry fee.
        require(token.balanceOf(bob) == 100_000 ether - fee, "stake returned");
        (address holder,,,,,,,) = gyms.gyms(1);
        require(holder == alice, "the gym holds");
    }

    function test_winningTakesTheGymAndASliceOfTheStake() public {
        _hold(alice, 1, 10_000 ether);
        uint256 fee = gyms.entryFeeFor(1);
        vm.prank(bob);
        gyms.challenge(1, 3_000 ether);
        (,,,, uint64 challengeAt,,,) = gyms.gyms(1);

        uint256 aliceBefore = token.balanceOf(alice);
        gyms.settle(1, bob, challengeAt, true, FAR_FUTURE, _resultSig(1, bob, challengeAt, true));

        (address holder, uint256 stake,,,,,,) = gyms.gyms(1);
        require(holder == bob, "the gym changed hands");
        require(stake == 3_000 ether, "held with the challenger's own stake");

        uint256 bounty = (10_000 ether * 20) / 100;
        // The old holder keeps their stake minus the bounty, and still takes
        // their share of the fee — defending is paid even when you lose.
        require(token.balanceOf(alice) - aliceBefore == 10_000 ether - bounty + (fee * 70) / 100, "old holder");
        require(token.balanceOf(bob) == 100_000 ether - fee - 3_000 ether + bounty, "winner takes the bounty");
        require(gyms.gymsHeld(bob) == 1 && gyms.gymsHeld(alice) == 0, "the count follows the gym");
    }

    function test_aResultCannotBeReplayedAgainstTheNextChallenge() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 firstAt,,,) = gyms.gyms(1);
        bytes memory sig = _resultSig(1, bob, firstAt, true);
        gyms.settle(1, bob, firstAt, true, FAR_FUTURE, sig);

        // Alice comes back for it. The old "bob won" signature must be dead.
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(alice);
        gyms.challenge(1, 2_000 ether);
        vm.expectRevert(bytes("NO_SUCH_CHALLENGE"));
        gyms.settle(1, bob, firstAt, true, FAR_FUTURE, sig);
    }

    function test_aStaleTimestampIsRefusedEvenForTheRightChallenger() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 at,,,) = gyms.gyms(1);
        // The signature is built FIRST: vm.expectRevert applies to the next
        // external call, and hashResult/vm.sign are calls — computing them
        // inline would arm the expectation against the wrong one.
        bytes memory sig = _resultSig(1, bob, at - 1, true);
        vm.expectRevert(bytes("STALE_RESULT"));
        gyms.settle(1, bob, at - 1, true, FAR_FUTURE, sig);
    }

    function test_aForgedResultIsRefused() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 at,,,) = gyms.gyms(1);
        bytes memory forged = _sign(0xBADBAD, gyms.hashResult(1, bob, at, true, FAR_FUTURE));
        vm.expectRevert(bytes("BAD_SIGNATURE"));
        gyms.settle(1, bob, at, true, FAR_FUTURE, forged);
    }

    function test_aDeadServerCannotHoldTheChallengersMoney() public {
        _hold(alice, 1, 10_000 ether);
        uint256 fee = gyms.entryFeeFor(1);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);

        vm.warp(block.timestamp + 31 minutes);
        gyms.resolveTimeout(1);

        require(token.balanceOf(bob) == 100_000 ether, "fee AND stake came back");
        require(!gyms.isUnderChallenge(1), "the gym is free again");
        require(fee > 0, "sanity");
    }

    function test_aResultAfterTheWindowIsRefused() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 at,,,) = gyms.gyms(1);
        bytes memory sig = _resultSig(1, bob, at, true);
        vm.warp(block.timestamp + 31 minutes);
        vm.expectRevert(bytes("CHALLENGE_TIMED_OUT"));
        gyms.settle(1, bob, at, true, FAR_FUTURE, sig);
    }

    function test_youCannotWalkAwayFromAFightYouAreLosing() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("UNDER_CHALLENGE"));
        gyms.abandonGym(1);
    }

    function test_abandoningReturnsTheStake() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(alice);
        gyms.abandonGym(1);
        require(token.balanceOf(alice) == 100_000 ether, "returned");
        (address holder,,,,,,,) = gyms.gyms(1);
        require(holder == address(0), "free");
    }

    function test_aFreshWinnerGetsAMomentBeforeTheNextChallenge() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 at,,,) = gyms.gyms(1);
        gyms.settle(1, bob, at, false, FAR_FUTURE, _resultSig(1, bob, at, false));

        vm.prank(carol);
        vm.expectRevert(bytes("COOLING_DOWN"));
        gyms.challenge(1, 2_000 ether);

        vm.warp(block.timestamp + 6 minutes);
        vm.prank(carol);
        gyms.challenge(1, 2_000 ether); // now allowed
    }

    function test_pauseStopsNewChallengesButNeverTrapsMoney() public {
        _hold(alice, 1, 10_000 ether);
        vm.prank(bob);
        gyms.challenge(1, 2_000 ether);
        (,,,, uint64 at,,,) = gyms.gyms(1);

        gyms.setPaused(true);
        vm.prank(carol);
        vm.expectRevert(bytes("PAUSED"));
        gyms.challenge(2, 2_000 ether);

        // The open challenge still settles, and an abandoned gym still pays.
        gyms.settle(1, bob, at, false, FAR_FUTURE, _resultSig(1, bob, at, false));
        vm.prank(alice);
        gyms.abandonGym(1);
        require(token.balanceOf(alice) > 90_000 ether, "money can always leave");
    }

    function test_theOwnerCannotRaiseTheEntryFeePastTheCap() public {
        vm.expectRevert(bytes("BAD_ENTRY_FEE"));
        gyms.setRules(MIN_STAKE, MAX_STAKE, 2001, 7000, 2000);
    }

    function test_theOwnerCannotMakeATakeoverConfiscation() public {
        vm.expectRevert(bytes("BAD_BOUNTY"));
        gyms.setRules(MIN_STAKE, MAX_STAKE, 500, 7000, 5001);
    }
}

/* ================================================================ ARENA ===*/

contract ArenaTest is PvpBase {
    StockmonstersArena arena;

    uint256 constant MAX_WAGER = 10_000 ether;
    // Two full-size payouts fit (2 x 19,400), a third does not. A cap that
    // cannot fit even one settlement would be testing arithmetic, not policy.
    uint256 constant DAILY_CAP = 40_000 ether;
    bytes32 constant SEED = bytes32(uint256(0x5EED));
    bytes32 constant SALT_A = bytes32(uint256(0xA17));
    bytes32 constant SALT_B = bytes32(uint256(0xB17));
    uint256 constant TOKEN_A = 42;
    uint256 constant TOKEN_B = 77;
    bytes32 constant MATCH = bytes32(uint256(1));

    function setUp() public {
        _setUpToken();
        arena = new StockmonstersArena(address(token), treasury, vm.addr(SIGNER_PK), MAX_WAGER, DAILY_CAP);
        token.setTaxExempt(address(arena), true);
        vm.prank(alice);
        token.approve(address(arena), type(uint256).max);
        vm.prank(bob);
        token.approve(address(arena), type(uint256).max);
    }

    function _commit(bytes32 seed) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(seed));
    }

    function _pickA() internal view returns (bytes32) {
        return arena.pickCommitment(TOKEN_A, SALT_A);
    }

    function _pickB() internal view returns (bytes32) {
        return arena.pickCommitment(TOKEN_B, SALT_B);
    }

    function _openMatch(bytes32 matchId, uint256 amount, bytes32 seed) internal {
        bytes32 digest =
            arena.hashWager(matchId, alice, bob, amount, _commit(seed), _pickA(), _pickB(), FAR_FUTURE);
        arena.open(
            matchId, alice, bob, amount, _commit(seed), _pickA(), _pickB(), FAR_FUTURE,
            _sign(ALICE_PK, digest), _sign(BOB_PK, digest)
        );
    }

    /// The full settle call, with both blind picks opened.
    function _settle(bytes32 matchId, address winner, bytes32 seed) internal {
        bytes32 digest =
            arena.hashResult(matchId, winner, seed, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        arena.settle(matchId, winner, seed, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, _sign(SIGNER_PK, digest));
    }

    function test_bothPlayersMustHaveAgreed() public {
        bytes32 pickA = _pickA();
        bytes32 pickB = _pickB();
        bytes32 digest =
            arena.hashWager(MATCH, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE);
        bytes memory aliceSig = _sign(ALICE_PK, digest);
        // Carol signing in Bob's place is exactly the attack: one player
        // dragging another into a bet they never agreed to.
        bytes memory notBob = _sign(0xCA401, digest);
        vm.expectRevert(bytes("BAD_SIGNATURE_B"));
        arena.open(MATCH, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE, aliceSig, notBob);
    }

    function test_openingEscrowsBothStakes() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        require(token.balanceOf(address(arena)) == 2_000 ether, "the pot is here");
        require(token.balanceOf(alice) == 99_000 ether, "alice paid");
        require(token.balanceOf(bob) == 99_000 ether, "bob paid");
    }

    function test_aMatchIdIsUsedOnce() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        // Everything the second open needs, computed before the expectation is
        // armed — see the note in the gym tests.
        bytes32 pickA = _pickA();
        bytes32 pickB = _pickB();
        bytes32 digest =
            arena.hashWager(MATCH, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE);
        bytes memory sigA = _sign(ALICE_PK, digest);
        bytes memory sigB = _sign(BOB_PK, digest);
        vm.expectRevert(bytes("MATCH_EXISTS"));
        arena.open(MATCH, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE, sigA, sigB);
    }

    function test_theWinnerTakesThePotMinusTheRake() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        _settle(MATCH, alice, SEED);

        uint256 pot = 2_000 ether;
        uint256 rake = (pot * 300) / 10_000;
        require(token.balanceOf(alice) == 99_000 ether + pot - rake, "winner paid");
        require(token.balanceOf(treasury) == rake, "rake to the treasury");
        require(token.balanceOf(address(arena)) == 0, "nothing stranded");
    }

    function test_theSeedMustOpenTheCommitmentMadeBeforeTheFight() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        bytes32 otherSeed = bytes32(uint256(999));
        bytes32 digest =
            arena.hashResult(MATCH, alice, otherSeed, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        // A server picking randomness after seeing the fight is exactly what
        // the commitment exists to make visible.
        vm.expectRevert(bytes("SEED_MISMATCH"));
        arena.settle(MATCH, alice, otherSeed, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, sig);
    }

    function test_aWinnerWhoIsNotInTheMatchIsRefused() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        bytes32 digest = arena.hashResult(MATCH, carol, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        vm.expectRevert(bytes("NOT_A_PLAYER"));
        arena.settle(MATCH, carol, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, sig);
    }

    function test_aMatchSettlesOnlyOnce() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        _settle(MATCH, alice, SEED);
        bytes32 digest = arena.hashResult(MATCH, alice, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        vm.expectRevert(bytes("NOT_OPEN"));
        arena.settle(MATCH, alice, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, sig);
    }

    function test_eitherPlayerCanWalkAwayWhenNoResultArrives() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        vm.warp(block.timestamp + 31 minutes);

        vm.prank(alice);
        arena.refund(MATCH);
        require(token.balanceOf(alice) == 100_000 ether, "alice whole");
        // Bob does not have to wait for Alice, or the other way round.
        vm.prank(bob);
        arena.refund(MATCH);
        require(token.balanceOf(bob) == 100_000 ether, "bob whole");
        require(token.balanceOf(address(arena)) == 0, "nothing left behind");
    }

    function test_youCannotRefundWhileTheMatchIsStillLive() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        vm.prank(alice);
        vm.expectRevert(bytes("STILL_IN_TIME"));
        arena.refund(MATCH);
    }

    function test_youCannotRefundTwice() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        vm.warp(block.timestamp + 31 minutes);
        vm.prank(alice);
        arena.refund(MATCH);
        vm.prank(alice);
        vm.expectRevert(bytes("ALREADY_REFUNDED"));
        arena.refund(MATCH);
    }

    function test_aStrangerCannotRefundSomebodyElsesMatch() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        vm.warp(block.timestamp + 31 minutes);
        vm.prank(carol);
        vm.expectRevert(bytes("NOT_A_PLAYER"));
        arena.refund(MATCH);
    }

    function test_settlingAfterTheWindowIsRefused() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        vm.warp(block.timestamp + 31 minutes);
        bytes32 digest = arena.hashResult(MATCH, alice, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        vm.expectRevert(bytes("MATCH_TIMED_OUT"));
        arena.settle(MATCH, alice, SEED, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, sig);
    }

    function test_aWagerOverTheCapIsRefused() public {
        bytes32 pickA = _pickA();
        bytes32 pickB = _pickB();
        bytes32 digest =
            arena.hashWager(MATCH, alice, bob, MAX_WAGER + 1, _commit(SEED), pickA, pickB, FAR_FUTURE);
        bytes memory sigA = _sign(ALICE_PK, digest);
        bytes memory sigB = _sign(BOB_PK, digest);
        vm.expectRevert(bytes("BAD_AMOUNT"));
        arena.open(MATCH, alice, bob, MAX_WAGER + 1, _commit(SEED), pickA, pickB, FAR_FUTURE, sigA, sigB);
    }

    function test_theDailyCapBoundsALeakedSigner() public {
        // Two maximum matches settle; the third breaches the day's ceiling and
        // is refused even though every signature is valid. This is the bound
        // that turns a leaked key from "the whole contract" into "one day".
        for (uint256 i = 1; i <= 2; i++) {
            bytes32 id = bytes32(i);
            bytes32 seed = bytes32(uint256(0xC0DE + i));
            _openMatch(id, MAX_WAGER, seed);
            _settle(id, alice, seed);
        }
        bytes32 third = bytes32(uint256(3));
        bytes32 seed3 = bytes32(uint256(0xFEED));
        _openMatch(third, MAX_WAGER, seed3);
        bytes32 digest =
            arena.hashResult(third, alice, seed3, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        vm.expectRevert(bytes("DAILY_CAP"));
        arena.settle(third, alice, seed3, TOKEN_A, SALT_A, TOKEN_B, SALT_B, FAR_FUTURE, sig);
    }

    function test_theCapRollsOverWithTheDay() public {
        bytes32 id = bytes32(uint256(7));
        bytes32 seed = bytes32(uint256(0xAAA));
        _openMatch(id, MAX_WAGER, seed);
        _settle(id, alice, seed);

        vm.warp(block.timestamp + 1 days + 1);
        bytes32 id2 = bytes32(uint256(8));
        bytes32 seed2 = bytes32(uint256(0xBBB));
        _openMatch(id2, MAX_WAGER, seed2);
        _settle(id2, alice, seed2);
        require(arena.paidToday() < DAILY_CAP, "yesterday did not carry forward");
    }

    function test_pauseStopsNewMatchesButNotOpenOnes() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        arena.setPaused(true);

        bytes32 id2 = bytes32(uint256(2));
        bytes32 pickA = _pickA();
        bytes32 pickB = _pickB();
        bytes32 digest =
            arena.hashWager(id2, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE);
        bytes memory sigA = _sign(ALICE_PK, digest);
        bytes memory sigB = _sign(BOB_PK, digest);
        vm.expectRevert(bytes("PAUSED"));
        arena.open(id2, alice, bob, 1_000 ether, _commit(SEED), pickA, pickB, FAR_FUTURE, sigA, sigB);

        // The escrowed match still resolves — pausing must never trap a pot.
        _settle(MATCH, alice, SEED);
        require(token.balanceOf(address(arena)) == 0, "the pot got out");
    }

    function test_aSubstitutedCreatureIsCaught() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        // Bob lost, and tries to settle claiming he fought with a different
        // creature than the one he committed to before seeing Alice's.
        uint256 swapped = 999;
        bytes32 digest =
            arena.hashResult(MATCH, alice, SEED, TOKEN_A, SALT_A, swapped, SALT_B, FAR_FUTURE);
        bytes memory sig = _sign(SIGNER_PK, digest);
        vm.expectRevert(bytes("PICK_B_MISMATCH"));
        arena.settle(MATCH, alice, SEED, TOKEN_A, SALT_A, swapped, SALT_B, FAR_FUTURE, sig);
    }

    function test_thePicksAreOpenedOnSettlement() public {
        _openMatch(MATCH, 1_000 ether, SEED);
        (,,,,,, bytes32 pickA, bytes32 pickB,,) = arena.matches(MATCH);
        require(pickA == arena.pickCommitment(TOKEN_A, SALT_A), "A committed");
        require(pickB == arena.pickCommitment(TOKEN_B, SALT_B), "B committed");
        // ...and the same salted hash cannot be guessed from the token id
        // alone, which is the whole reason there is a salt.
        require(pickA != keccak256(abi.encode(TOKEN_A, bytes32(0))), "salted");
        _settle(MATCH, alice, SEED);
    }

    function test_theOwnerCannotRakeMoreThanTheCap() public {
        vm.expectRevert(bytes("RAKE_TOO_HIGH"));
        arena.setLimits(MAX_WAGER, DAILY_CAP, 1001);
    }
}
