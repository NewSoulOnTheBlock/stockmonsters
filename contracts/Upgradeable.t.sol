// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "./TestHelpers.sol";
import {Initializable, UUPSUpgradeable, ERC1967, StockmonstersProxy} from "./Upgradeable.sol";

/* ------------------------------------------------------------------ *
 *  Two implementations and three deliberately broken ones.
 *
 *  The point of this suite is not that upgrading works — that is the easy
 *  half. It is that every way of BRICKING a proxy is refused, because those
 *  are the failures with no second chance: once the pointer moves to code
 *  that cannot move it again, the address and everything in it is gone.
 * ------------------------------------------------------------------ */

contract BoxV1 is UUPSUpgradeable {
    address public owner;
    uint256 public value;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, uint256 _value) external initializer {
        owner = _owner;
        value = _value;
    }

    function set(uint256 v) external {
        value = v;
    }

    function version() external pure virtual returns (string memory) {
        return "v1";
    }

    /// The treasury is paid by plain transfer, so at least one implementation
    /// here has to prove the proxy forwards one.
    receive() external payable {}

    function _authorizeUpgrade(address) internal view override {
        require(msg.sender == owner, "NOT_OWNER");
    }

    uint256[48] private __gap;
}

/// An implementation with no way to accept ether. Used to show the proxy does
/// not quietly accept what the code behind it would refuse.
contract Sealed is UUPSUpgradeable {
    address public owner;

    constructor() {
        _disableInitializers();
    }

    function initialize(address o) external initializer {
        owner = o;
    }

    function _authorizeUpgrade(address) internal view override {
        require(msg.sender == owner, "NOT_OWNER");
    }
}

/// Adds state, plus the one-shot initializer for it.
contract BoxV2 is BoxV1 {
    string public label;

    function initializeV2(string calldata l) external reinitializer(2) {
        label = l;
    }

    function version() external pure override returns (string memory) {
        return "v2";
    }
}

/// The classic way to lose a proxy forever: no upgrade function of its own.
contract NotProxiable {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }
}

/// Answers the handshake, with the wrong slot.
contract WrongSlot {
    function proxiableUUID() external pure returns (bytes32) {
        return keccak256("something.else");
    }
}

contract UpgradeableTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    BoxV1 impl;
    BoxV1 box; // the proxy, typed as the implementation
    address owner = address(0xB0B);
    address stranger = address(0xBAD);

    function setUp() public {
        impl = new BoxV1();
        StockmonstersProxy proxy =
            new StockmonstersProxy(address(impl), abi.encodeCall(BoxV1.initialize, (owner, 42)));
        box = BoxV1(payable(address(proxy)));
    }

    /* ------------------------------------------------------ the basics ---*/

    function test_initializedThroughTheProxyNotTheImplementation() public view {
        require(box.owner() == owner, "proxy owner");
        require(box.value() == 42, "proxy value");
        // The implementation's own storage is untouched by any of it.
        require(impl.owner() == address(0), "implementation owner is nobody");
        require(impl.value() == 0, "implementation value is empty");
    }

    function test_stateSurvivesAnUpgrade() public {
        vm.prank(stranger);
        box.set(7);

        BoxV2 v2 = new BoxV2();
        vm.prank(owner);
        box.upgradeToAndCall(address(v2), "");

        require(box.value() == 7, "state belongs to the proxy, not the code");
        require(box.owner() == owner, "owner kept");
        require(keccak256(bytes(BoxV2(payable(address(box))).version())) == keccak256("v2"), "new code");
    }

    function test_upgradeCanInitialiseNewStateAtomically() public {
        // Leaving it to a second transaction leaves a window in which the new
        // code runs against uninitialised storage.
        BoxV2 v2 = new BoxV2();
        vm.prank(owner);
        box.upgradeToAndCall(address(v2), abi.encodeCall(BoxV2.initializeV2, ("hello")));
        require(keccak256(bytes(BoxV2(payable(address(box))).label())) == keccak256("hello"), "new state set");
        require(box.value() == 42, "old state kept");
    }

    /* ------------------------------------------------ who may upgrade ---*/

    function test_onlyOwnerMayUpgrade() public {
        BoxV2 v2 = new BoxV2();
        vm.prank(stranger);
        vm.expectRevert(bytes("NOT_OWNER"));
        box.upgradeToAndCall(address(v2), "");
    }

    /* --------------------------------------- the ways to brick a proxy ---*/

    function test_refusesAnImplementationThatCannotUpgradeItself() public {
        NotProxiable dead = new NotProxiable();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UUPSUpgradeable.NotProxiable.selector));
        box.upgradeToAndCall(address(dead), "");
    }

    function test_refusesAnImplementationAnsweringTheWrongSlot() public {
        WrongSlot wrong = new WrongSlot();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UUPSUpgradeable.NotProxiable.selector));
        box.upgradeToAndCall(address(wrong), "");
    }

    function test_refusesAnAddressWithNoCode() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UUPSUpgradeable.NoCodeAtNewImplementation.selector));
        box.upgradeToAndCall(address(0xDEAD), "");
    }

    function test_refusesToProxyAProxy() public {
        // proxiableUUID reverts when reached through a delegatecall, which is
        // what stops proxies nesting and losing the implementation slot.
        StockmonstersProxy other =
            new StockmonstersProxy(address(impl), abi.encodeCall(BoxV1.initialize, (owner, 1)));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UUPSUpgradeable.NotProxiable.selector));
        box.upgradeToAndCall(address(other), "");
    }

    function test_theImplementationItselfCannotBeInitialised() public {
        // Otherwise a stranger owns the implementation and holds ITS upgrade
        // authorisation — the second classic UUPS incident.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        impl.initialize(stranger, 1);
    }

    function test_theProxyCannotBeInitialisedTwice() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        box.initialize(stranger, 999);
    }

    function test_aReinitializerRunsOnceAndOnlyForwards() public {
        BoxV2 v2 = new BoxV2();
        vm.prank(owner);
        box.upgradeToAndCall(address(v2), abi.encodeCall(BoxV2.initializeV2, ("one")));
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        BoxV2(payable(address(box))).initializeV2("two");
        require(keccak256(bytes(BoxV2(payable(address(box))).label())) == keccak256("one"), "first one wins");
    }

    function test_upgradeOnTheImplementationDirectlyIsRefused() public {
        BoxV2 v2 = new BoxV2();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UUPSUpgradeable.NotThroughProxy.selector));
        impl.upgradeToAndCall(address(v2), "");
    }

    /* --------------------------------------------------- the plumbing ---*/

    function test_implementationSlotIsTheStandardOne() public view {
        // ERC-1967's slot, so every explorer and wallet finds it without help.
        bytes32 slot = vm.load(address(box), ERC1967.IMPLEMENTATION_SLOT);
        require(address(uint160(uint256(slot))) == address(impl), "1967 slot");
        require(box.implementation() == address(impl), "reported implementation");
    }

    function test_revertReasonsSurviveTheDelegatecall() public {
        BoxV2 v2 = new BoxV2();
        vm.prank(owner);
        // A first-version initializer on an already-initialised proxy. The
        // reason has to reach the caller, or an upgrade fails with a blank.
        vm.expectRevert(abi.encodeWithSelector(Initializable.AlreadyInitialized.selector));
        box.upgradeToAndCall(address(v2), abi.encodeCall(BoxV1.initialize, (owner, 1)));
    }

    function test_etherReachesTheProxyWhenTheCodeAcceptsIt() public {
        // The treasury is paid by plain transfer, so the proxy must forward it.
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = payable(address(box)).call{value: 1 ether}("");
        require(ok, "plain transfer accepted");
        require(address(box).balance == 1 ether, "ether held by the proxy, not the implementation");
        require(address(impl).balance == 0, "implementation holds nothing");
    }

    function test_etherIsRefusedWhenTheCodeWouldRefuseIt() public {
        // The proxy must not be more permissive than the contract behind it:
        // an implementation with no receive() should still bounce a transfer,
        // or ether piles up somewhere nothing can spend it.
        Sealed sealedImpl = new Sealed();
        StockmonstersProxy p =
            new StockmonstersProxy(address(sealedImpl), abi.encodeCall(Sealed.initialize, (owner)));
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = payable(address(p)).call{value: 1 ether}("");
        require(!ok, "plain transfer refused");
        require(address(p).balance == 0, "nothing stuck");
    }

    function test_theVersionMarkerIsVisible() public view {
        require(box.initializedVersion() == 1, "proxy initialised once");
        require(impl.initializedVersion() == type(uint64).max, "implementation locked out");
    }
}
