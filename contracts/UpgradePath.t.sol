// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "./TestHelpers.sol";
import {Deployers} from "./Deployers.sol";
import {Initializable, UUPSUpgradeable} from "./Upgradeable.sol";
import {StockmonstersToken} from "./StockmonstersToken.sol";
import {StockmonstersTreasury} from "./StockmonstersTreasury.sol";

/// A real next version: same storage, one new function, one new variable.
contract StockmonstersTokenV2 is StockmonstersToken {
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
/// the part that matters in practice: that the balances, the ownership and the
/// tax configuration of a LIVE token are still there afterwards, because the
/// state was never in the code to begin with.
contract UpgradePathTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    StockmonstersToken token;
    StockmonstersTreasury treasury;

    address holder = address(this);
    address alice = address(0xA11CE);
    address rewardsPool = address(0x5169);
    address ops = address(0x0B5);

    uint256 constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        token = Deployers.token(
            "Stock Monsters", "$STONKSTER", SUPPLY, rewardsPool, ops, "", "The currency.", holder
        );
        treasury = Deployers.treasury(address(token), rewardsPool, ops, holder);
    }

    /* ------------------------------------------------ state, not code ---*/

    function test_balancesSurviveAnUpgrade() public {
        token.transfer(alice, 1_000 ether);
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 holderBefore = token.balanceOf(holder);
        require(aliceBefore == 1_000 ether, "transferred");

        StockmonstersTokenV2 v2 = new StockmonstersTokenV2();
        token.upgradeToAndCall(address(v2), abi.encodeCall(StockmonstersTokenV2.initializeV2, ("v2 notes")));

        require(token.balanceOf(alice) == aliceBefore, "alice keeps her tokens");
        require(token.balanceOf(holder) == holderBefore, "and so does everyone else");
        require(token.totalSupply() == SUPPLY, "supply unchanged");
        require(
            keccak256(bytes(StockmonstersTokenV2(payable(address(token))).version())) == keccak256("v2"),
            "new code is live"
        );
        require(
            keccak256(bytes(StockmonstersTokenV2(payable(address(token))).note())) == keccak256("v2 notes"),
            "new state initialised in the same transaction"
        );
    }

    function test_theConfigurationSurvivesToo() public {
        // The numbers that decide who gets paid what.
        uint16 buyBefore = token.buyTaxBps();
        uint16 shareBefore = token.rewardsShareBps();
        address rewardsBefore = token.rewardsPool();

        StockmonstersTokenV2 v2 = new StockmonstersTokenV2();
        token.upgradeToAndCall(address(v2), "");

        require(token.buyTaxBps() == buyBefore, "buy tax kept");
        require(token.rewardsShareBps() == shareBefore, "players' share kept");
        require(token.rewardsPool() == rewardsBefore, "destination kept");
    }

    function test_ownershipDecidesWhoMayUpgrade() public {
        StockmonstersTokenV2 v2 = new StockmonstersTokenV2();
        vm.prank(alice);
        vm.expectRevert(bytes("NOT_OWNER"));
        token.upgradeToAndCall(address(v2), "");
    }

    /* ---------------------------------------- the initialisation window ---*/

    function test_nobodyCanTakeOverTheImplementation() public {
        // The implementation of a LIVE token is a real contract with empty
        // storage. If a passer-by could initialise it they would own it, and
        // owning it is what authorises upgrades of it.
        StockmonstersTokenV2 impl = new StockmonstersTokenV2();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        impl.initialize("Fake", "FAKE", 1, rewardsPool, ops, "", "", alice);
    }

    function test_theProxyIsInitialisedInTheSameTransactionAsItsDeploy() public view {
        // Not a convenience: a proxy that exists uninitialised for even one
        // block can be initialised by whoever is watching.
        require(token.owner() == holder, "owner set at deploy");
        require(token.initializedVersion() == 1, "initialised exactly once");
    }

    /* ---------------------------------------------- the inline-init trap ---*/

    function test_valuesThatUsedToBeInlineInitialisersAreActuallySet() public view {
        // Every one of these was written as `uint16 public x = 500;` before the
        // conversion. An inline initializer runs in the IMPLEMENTATION's
        // constructor and never touches the proxy's storage, so behind a proxy
        // they would all silently be zero — a 0% tax, a 0% players' share, and
        // in the re-entrancy guards a lock that reads as permanently engaged.
        require(token.buyTaxBps() == 200, "buy tax");
        require(token.sellTaxBps() == 200, "sell tax");
        require(token.rewardsShareBps() == 7500, "players' share");
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
}
