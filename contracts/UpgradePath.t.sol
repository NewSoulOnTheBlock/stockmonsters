// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "./TestHelpers.sol";
import {Deployers} from "./Deployers.sol";
import {Initializable, UUPSUpgradeable} from "./Upgradeable.sol";
import {LaunchTokenDouble} from "./LaunchTokenDouble.sol";
import {StockmonstersTreasury} from "./StockmonstersTreasury.sol";

/// A real next version: same storage, one new function, one new variable.
contract StockmonstersTreasuryV2 is StockmonstersTreasury {
    /// Appended AFTER everything the previous version declared. If this were
    /// inserted anywhere above, it would land on a slot that already holds
    /// something and silently reinterpret it.
    string public note;

    function initializeV2(string calldata n) external reinitializer(2) {
        note = n;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}

/// @title Upgrading a contract that already holds people's money
///
/// The machinery is proved in Upgradeable.t.sol against toy contracts. This is
/// the part that matters in practice: that the money, the ownership and the
/// configuration of a LIVE contract are still there afterwards, because the
/// state was never in the code to begin with.
///
/// ## Why this suite is about the treasury now
///
/// It used to be about the token, which we wrote, deployed and could upgrade.
/// The token is launched through pons now and pons deploys a plain ERC-20 with
/// no owner and no upgrade path at all — so there is nothing left to prove
/// about upgrading it, and the thing that "already holds people's money" is
/// the treasury. It holds the ETH revenue and, inside that, the buyback
/// reserve that is the players' half. Losing either to a botched upgrade is
/// the failure this suite exists to rule out.
contract UpgradePathTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    LaunchTokenDouble token;
    StockmonstersTreasury treasury;

    address holder = address(this);
    address alice = address(0xA11CE);
    address rewardsPool = address(0x5169);
    address ops = address(0x0B5);

    uint256 constant SUPPLY = 1_000_000_000 ether;

    receive() external payable {}

    function setUp() public {
        token = Deployers.token("Stock Monsters", "STONKSTERS", SUPPLY, holder);
        treasury = Deployers.treasury(address(token), rewardsPool, ops, holder);
    }

    /* ------------------------------------------------ state, not code ---*/

    function test_theMoneySurvivesAnUpgrade() public {
        // Revenue arrives and is split: half is now the players', tracked as
        // the reserve, and half has already gone to ops.
        vm.deal(address(treasury), 10 ether);
        treasury.route();
        uint256 reserveBefore = treasury.buybackReserve();
        uint256 heldBefore = address(treasury).balance;
        require(reserveBefore == 5 ether, "half reserved for the players");

        StockmonstersTreasuryV2 v2 = new StockmonstersTreasuryV2();
        treasury.upgradeToAndCall(address(v2), abi.encodeCall(StockmonstersTreasuryV2.initializeV2, ("v2 notes")));

        require(treasury.buybackReserve() == reserveBefore, "the players' half is still theirs");
        require(address(treasury).balance == heldBefore, "and the ether is still here");
        require(
            keccak256(bytes(StockmonstersTreasuryV2(payable(address(treasury))).version())) == keccak256("v2"),
            "new code is live"
        );
        require(
            keccak256(bytes(StockmonstersTreasuryV2(payable(address(treasury))).note())) == keccak256("v2 notes"),
            "new state initialised in the same transaction"
        );
    }

    function test_theConfigurationSurvivesToo() public {
        // The addresses and the number that decide who gets paid what.
        treasury.setPonsSources(address(0xE5C), address(0x400C));
        uint16 shareBefore = treasury.playerShareBps();
        address rewardsBefore = treasury.rewardsPool();
        address opsBefore = treasury.opsWallet();
        address escrowBefore = treasury.feeEscrow();

        StockmonstersTreasuryV2 v2 = new StockmonstersTreasuryV2();
        treasury.upgradeToAndCall(address(v2), "");

        require(treasury.playerShareBps() == shareBefore, "players' share kept");
        require(treasury.rewardsPool() == rewardsBefore, "rewards destination kept");
        require(treasury.opsWallet() == opsBefore, "ops destination kept");
        require(treasury.feeEscrow() == escrowBefore, "the pons escrow is still wired up");
    }

    /// The two fields that pay for pons were appended after everything else and
    /// taken out of the storage gap. If they had been inserted higher up, they
    /// would sit on slots that already hold the reserve and the split — so this
    /// checks that adding them did not move what was already there.
    function test_appendingTheNewFieldsMovedNothingBeneathThem() public {
        vm.deal(address(treasury), 10 ether);
        treasury.route();

        treasury.setPonsSources(address(0xE5C), address(0x400C));

        require(treasury.buybackReserve() == 5 ether, "the reserve is where it was");
        require(treasury.playerShareBps() == 5000, "the split is where it was");
        require(treasury.rewardsPool() == rewardsPool, "and so are the destinations");
        require(treasury.opsWallet() == ops, "and so are the destinations");
    }

    function test_ownershipDecidesWhoMayUpgrade() public {
        StockmonstersTreasuryV2 v2 = new StockmonstersTreasuryV2();
        vm.prank(alice);
        vm.expectRevert(bytes("NOT_OWNER"));
        treasury.upgradeToAndCall(address(v2), "");
    }

    /* ---------------------------------------- the initialisation window ---*/

    function test_nobodyCanTakeOverTheImplementation() public {
        // The implementation of a LIVE contract is a real contract with empty
        // storage. If a passer-by could initialise it they would own it, and
        // owning it is what authorises upgrades of it.
        StockmonstersTreasuryV2 impl = new StockmonstersTreasuryV2();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        impl.initialize(address(token), rewardsPool, ops, alice);
    }

    function test_theProxyIsInitialisedInTheSameTransactionAsItsDeploy() public view {
        // Not a convenience: a proxy that exists uninitialised for even one
        // block can be initialised by whoever is watching.
        require(treasury.owner() == holder, "owner set at deploy");
        require(treasury.initializedVersion() == 1, "initialised exactly once");
    }

    /* ---------------------------------------------- the inline-init trap ---*/

    function test_valuesThatUsedToBeInlineInitialisersAreActuallySet() public view {
        // This was written as `uint16 public playerShareBps = 5000;` before the
        // conversion. An inline initializer runs in the IMPLEMENTATION's
        // constructor and never touches the proxy's storage, so behind a proxy
        // it would silently be zero — nothing at all going back to players, and
        // in the re-entrancy guards a lock that reads as permanently engaged.
        require(treasury.playerShareBps() == 5000, "treasury split");
    }

    function test_theTreasuryStillAcceptsPlainEther() public {
        // It is paid by transfer, so the proxy has to forward one.
        vm.deal(alice, 3 ether);
        vm.prank(alice);
        (bool ok,) = payable(address(treasury)).call{value: 3 ether}("");
        require(ok, "revenue accepted");
        require(address(treasury).balance == 3 ether, "held by the proxy");
    }

    /// The token is not ours to upgrade any more, and that is the point: the
    /// pons launch token has no owner and no upgrade authorisation, so "fixed
    /// supply, no mint" is a property of the code rather than a promise by a
    /// key we hold.
    function test_theTokenItselfHasNoAdminAtAll() public {
        (bool hasOwner,) = address(token).staticcall(abi.encodeWithSignature("owner()"));
        require(!hasOwner, "the launch token has no owner");

        (bool hasMint,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1 ether));
        require(!hasMint, "and no mint function");

        (bool hasUpgrade,) =
            address(token).call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(1), ""));
        require(!hasUpgrade, "and no upgrade path");

        require(token.totalSupply() == SUPPLY, "so the supply is what it says it is");
    }
}
