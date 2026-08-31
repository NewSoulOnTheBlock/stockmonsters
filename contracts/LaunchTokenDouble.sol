// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title A stand-in for the token pons launches on our behalf
///
/// ## Why this replaced a contract we wrote
///
/// We used to write and deploy the game's token ourselves: a fixed supply, a
/// 2% trading tax split between the rewards pool and the treasury, an owner who
/// could mark AMM pairs and exempt addresses, all behind an upgradeable proxy.
///
/// The token is launched through the pons launchpad now, and pons deploys it.
/// What it deploys is a plain fixed-supply ERC-20 with **no owner, no mint, no
/// tax and no upgrade path** — the entire supply is minted to a bonding curve
/// at creation and nobody, including us, holds a lever over it afterwards.
/// Verified against a real launched token on Robinhood Chain: 18 decimals, a
/// billion supply, and `owner()` does not exist.
///
/// So this file is NOT a contract we deploy. It exists so the game's own
/// contracts — the rewards pool, the treasury, the arena, the gyms, the
/// marketplace — can be tested against something that behaves the way the real
/// token will. It is deliberately named for what it is, because the thing that
/// would actually hurt is deploying a game token by accident and having two.
///
/// ## What it deliberately does NOT have
///
/// No tax, so no `setPair`, no `setTaxExempt`, no `amountAfterTax`. Those were
/// the reason the game's contracts had to be marked exempt and the reason a
/// payment could arrive short. On a pons token a transfer moves exactly what
/// was sent, which is why the marketplace's and the NFT's balance-delta checks
/// (`PAYMENT_SHORTFALL`, `FEE_SHORTFALL`) now pass trivially rather than
/// guarding a live hazard. They stay, because a future accepted currency might
/// not be so well behaved.
///
/// No owner and no upgrade, which is the whole point: "fixed supply, no mint
/// function" is a property of the code rather than a promise by a key.
contract LaunchTokenDouble {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @param holder stands in for the bonding curve, which is where the real
    ///        launch mints the entire supply. Tests hand it out from there the
    ///        way buyers would.
    constructor(string memory _name, string memory _symbol, uint256 _supply, address holder) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        balanceOf[holder] = _supply;
        emit Transfer(address(0), holder, _supply);
    }

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

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ZERO_TO");
        uint256 balance = balanceOf[from];
        require(balance >= value, "INSUFFICIENT_BALANCE");
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
