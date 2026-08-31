// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title The upgrade machinery, written out rather than imported
///
/// This project vendors nothing (`libs = []` in foundry.toml) and every token
/// standard in it is hand-rolled, so the proxy is too. It is a faithful
/// ERC-1967 proxy with a UUPS authorisation model, and the parts that look
/// like ceremony are the parts that stop a proxy being bricked forever.
///
/// ## Why upgradeable at all
///
/// The game's rules change every week — rewards, quests, duel terms, gyms.
/// Redeploying means every balance, every minted creature and every open order
/// is stranded at the old address. A proxy keeps the address and the state and
/// swaps only the code behind them.
///
/// ## What upgradeability COSTS, stated plainly
///
/// It moves trust from the code to whoever holds the owner key. "Fixed supply,
/// no mint function" stops being a property of the contract and becomes a
/// promise by that key, because an upgrade can add one. That is a fair trade
/// for game logic that has to keep changing. It is a much worse trade for a
/// token people are asked to buy, which is why the token's upgrade path should
/// end at a timelock before there is any real money in it — see the note on
/// StockmonstersToken.
///
/// ## The three ways to brick a UUPS proxy, and what prevents each here
///
/// 1. Upgrading to an implementation that has no upgrade function of its own.
///    Nothing on chain can save that. Every implementation here inherits
///    `UUPSUpgradeable`, and `_authorizeUpgrade` is the only thing a subclass
///    has to remember.
/// 2. Somebody calling `initialize` on the IMPLEMENTATION and taking ownership
///    of it. Harmless for the proxy's state, but it lets them upgrade the
///    implementation's own storage and, with a `delegatecall`-and-selfdestruct
///    payload, historically brick things. `_disableInitializers()` in each
///    implementation's constructor closes it.
/// 3. Upgrading to an address with no code, or to a non-UUPS contract. Both
///    are checked before the pointer moves.
///
/// ## Storage layout is a contract too
///
/// Every upgradeable contract here ends with a `__gap`. New variables are
/// appended and the gap shrinks by the same number of slots; existing
/// variables are NEVER reordered, retyped or removed. Getting that wrong does
/// not revert — it silently reinterprets one variable as another, which is the
/// worst failure mode a token contract has.

/* ------------------------------------------------------------------ *
 *  Initializable — a constructor that runs once, through a proxy.
 * ------------------------------------------------------------------ */
abstract contract Initializable {
    /// @dev Which initializer version has run. 1 = initialize().
    uint64 private _initialized;
    /// @dev True while an initializer is on the stack, so parents may run.
    bool private _initializing;

    event Initialized(uint64 version);

    error AlreadyInitialized();
    error NotInitializing();

    /// The top-level initializer. Runs exactly once per proxy.
    modifier initializer() {
        // `_initializing` lets a subclass initializer call its parents'
        // `onlyInitializing` functions without tripping the version check.
        if (_initialized != 0) revert AlreadyInitialized();
        _initialized = 1;
        _initializing = true;
        _;
        _initializing = false;
        emit Initialized(1);
    }

    /// A parent's share of the work. Only callable from inside `initializer`.
    modifier onlyInitializing() {
        if (!_initializing) revert NotInitializing();
        _;
    }

    /// A later version's initializer, for state added by an upgrade.
    modifier reinitializer(uint64 version) {
        if (_initializing || _initialized >= version) revert AlreadyInitialized();
        _initialized = version;
        _initializing = true;
        _;
        _initializing = false;
        emit Initialized(version);
    }

    /// @notice Which initializer version has run on this contract.
    function initializedVersion() external view returns (uint64) {
        return _initialized;
    }

    /**
     * @dev Called from an IMPLEMENTATION's constructor.
     *
     * The implementation is a real contract at a real address and its own
     * storage is empty, so without this anyone may call `initialize` on it and
     * become its owner. That does not touch the proxy's state — but it does
     * hand them the implementation's upgrade authorisation, and that has
     * bricked live systems before. Marking it "already initialized at the
     * maximum version" makes every initializer on it revert forever.
     */
    function _disableInitializers() internal {
        if (_initializing) revert AlreadyInitialized();
        if (_initialized != type(uint64).max) {
            _initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    uint256[50] private __gapInit;
}

/* ------------------------------------------------------------------ *
 *  ERC-1967 storage slots.
 * ------------------------------------------------------------------ */
library ERC1967 {
    /// bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function implementation() internal view returns (address impl) {
        assembly {
            impl := sload(IMPLEMENTATION_SLOT)
        }
    }

    function setImplementation(address impl) internal {
        assembly {
            sstore(IMPLEMENTATION_SLOT, impl)
        }
    }
}

/* ------------------------------------------------------------------ *
 *  UUPSUpgradeable — the upgrade entry point, on the implementation.
 * ------------------------------------------------------------------ */
abstract contract UUPSUpgradeable is Initializable {
    /// The implementation's own address, fixed at deploy time in its code.
    /// Reading it through a delegatecall yields the IMPLEMENTATION's value,
    /// which is exactly how `proxiableUUID` can tell the two apart.
    address private immutable __self = address(this);

    event Upgraded(address indexed implementation);

    error NotThroughProxy();
    error NotProxiable();
    error NoCodeAtNewImplementation();

    /**
     * @dev The ERC-1822 handshake.
     *
     * A proxy asks a candidate implementation for the slot it expects to be
     * proxied at. A contract that is not built to sit behind a proxy has no
     * such function, so the upgrade reverts instead of pointing the proxy at
     * code that cannot upgrade it again.
     *
     * It deliberately reverts when called through a proxy: that is what stops
     * a proxy being upgraded to ANOTHER proxy, which would nest delegatecalls
     * and lose the implementation slot.
     */
    function proxiableUUID() external view virtual returns (bytes32) {
        if (address(this) != __self) revert NotThroughProxy();
        return ERC1967.IMPLEMENTATION_SLOT;
    }

    /// Guard for functions that only make sense on the proxy's state.
    modifier onlyProxy() {
        if (address(this) == __self) revert NotThroughProxy();
        _;
    }

    /**
     * @notice Point this proxy at `newImplementation`, optionally calling into
     *         it in the same transaction (for a `reinitializer`).
     *
     * `data` is how state added by an upgrade gets initialised atomically —
     * leaving it to a second transaction leaves a window in which the new code
     * runs against uninitialised storage.
     */
    function upgradeToAndCall(address newImplementation, bytes calldata data)
        external
        payable
        onlyProxy
    {
        _authorizeUpgrade(newImplementation);
        _upgradeToAndCall(newImplementation, data);
    }

    function _upgradeToAndCall(address newImplementation, bytes memory data) private {
        if (newImplementation.code.length == 0) revert NoCodeAtNewImplementation();
        // The handshake. A plain `try` rather than a raw call so a contract
        // without the function is refused rather than silently accepted.
        try UUPSUpgradeable(newImplementation).proxiableUUID() returns (bytes32 slot) {
            if (slot != ERC1967.IMPLEMENTATION_SLOT) revert NotProxiable();
        } catch {
            revert NotProxiable();
        }
        ERC1967.setImplementation(newImplementation);
        emit Upgraded(newImplementation);
        if (data.length > 0) {
            (bool ok, bytes memory ret) = newImplementation.delegatecall(data);
            if (!ok) {
                // Surface the callee's revert reason rather than a blank one.
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 32), mload(ret))
                    }
                }
                revert("UPGRADE_CALL_FAILED");
            }
        }
    }

    /// @notice The current implementation behind this proxy.
    function implementation() external view returns (address) {
        return ERC1967.implementation();
    }

    /// Who may upgrade. Every implementation must answer this.
    function _authorizeUpgrade(address newImplementation) internal virtual;

    uint256[50] private __gapUUPS;
}

/* ------------------------------------------------------------------ *
 *  The proxy itself. Deployed once per contract; never changes.
 * ------------------------------------------------------------------ */
contract StockmonstersProxy {
    error NoCodeAtImplementation();

    event Upgraded(address indexed implementation);

    /**
     * @param impl the first implementation
     * @param data the `initialize(...)` call, run against THIS contract's
     *        storage in the same transaction as the deploy
     *
     * Initialising in the constructor is not a convenience: a proxy that
     * exists for even one block uninitialised can be initialised by anybody
     * who is watching, and they become the owner.
     */
    constructor(address impl, bytes memory data) payable {
        if (impl.code.length == 0) revert NoCodeAtImplementation();
        ERC1967.setImplementation(impl);
        emit Upgraded(impl);
        if (data.length > 0) {
            (bool ok, bytes memory ret) = impl.delegatecall(data);
            if (!ok) {
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 32), mload(ret))
                    }
                }
                revert("INIT_FAILED");
            }
        }
    }

    fallback() external payable {
        _delegate(ERC1967.implementation());
    }

    /// Plain ETH transfers are forwarded too — the treasury is paid this way.
    receive() external payable {
        _delegate(ERC1967.implementation());
    }

    function _delegate(address impl) private {
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
