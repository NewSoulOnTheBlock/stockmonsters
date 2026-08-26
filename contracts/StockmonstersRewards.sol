// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title StockmonstersRewards — the pool players are paid out of
///
/// Everything the economy sends back to players lands here: 75% of the token's
/// trading tax, and the tokens the treasury buys back with NFT revenue. The
/// game decides who earned what (time played, gyms held, battles won, boxes
/// opened) and signs a claim; the player collects it themselves.
///
/// ## Why signed claims and not on-chain accounting
///
/// The things being rewarded happen inside the game — the chain cannot see a
/// gym defence or a battle. Any distribution therefore rests on the server's
/// word. This contract does not pretend otherwise; it bounds the damage:
///
/// - **A budget per epoch.** The owner funds an epoch with an explicit number.
///   A leaked claim signer can drain that epoch and nothing more, ever. This
///   is the control that matters: without it, one key equals the whole pool.
/// - **One claim per player per epoch**, so a signature cannot be replayed.
/// - **Deadlines**, so an old signature cannot be banked and cashed later.
/// - **The signer is not the owner.** Rotating a burnt signer does not touch
///   custody of the pool.
///
/// The owner cannot take the pool's tokens for themselves: `sweep` refuses the
/// reward token. The only way tokens leave is a claim inside a funded epoch.
contract StockmonstersRewards {
    string public constant name = "StockmonstersRewards";

    IERC20Minimal public immutable token;

    address public owner;
    address public pendingOwner;
    /// Signs claims. Held by the game server; never the same key as the box
    /// signer, so one compromise is not both.
    address public claimSigner;

    /// epoch => how much may ever be claimed from it
    mapping(uint256 => uint256) public epochBudget;
    /// epoch => how much has been
    mapping(uint256 => uint256) public epochClaimed;
    /// epoch => player => already collected
    mapping(uint256 => mapping(address => bool)) public claimed;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address player,uint256 epoch,uint256 amount,uint64 deadline)");

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ClaimSignerChanged(address indexed signer);
    event EpochFunded(uint256 indexed epoch, uint256 budget);
    event Claimed(address indexed player, uint256 indexed epoch, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address _token, address _claimSigner) {
        require(_token != address(0), "ZERO_TOKEN");
        token = IERC20Minimal(_token);
        owner = msg.sender;
        claimSigner = _claimSigner;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ClaimSignerChanged(_claimSigner);
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

    function setClaimSigner(address signer) external onlyOwner {
        claimSigner = signer;
        emit ClaimSignerChanged(signer);
    }

    /// @notice Open an epoch for claiming, up to `budget` in total.
    ///
    /// Raising a budget is allowed (an epoch can be topped up); LOWERING it
    /// below what has already been claimed is not, because that number is
    /// history. The budget may exceed the current balance — the pool is fed
    /// continuously by the tax, and a claim simply fails until it can be paid.
    function fundEpoch(uint256 epoch, uint256 budget) external onlyOwner {
        require(budget >= epochClaimed[epoch], "BUDGET_BELOW_CLAIMED");
        epochBudget[epoch] = budget;
        emit EpochFunded(epoch, budget);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)));
    }

    function hashClaim(address player, uint256 epoch, uint256 amount, uint64 deadline) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, player, epoch, amount, deadline));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @notice Collect what the game says you earned in `epoch`.
    /// @dev The signature covers the CLAIMING ADDRESS, so a claim cannot be
    ///      lifted from someone else's transaction and redirected.
    function claim(uint256 epoch, uint256 amount, uint64 deadline, bytes calldata signature) external {
        require(block.timestamp <= deadline, "CLAIM_EXPIRED");
        require(amount > 0, "NOTHING_TO_CLAIM");
        require(!claimed[epoch][msg.sender], "ALREADY_CLAIMED");

        uint256 spent = epochClaimed[epoch] + amount;
        require(spent <= epochBudget[epoch], "EPOCH_EXHAUSTED");

        require(_recover(hashClaim(msg.sender, epoch, amount, deadline), signature) == claimSigner, "BAD_SIGNATURE");

        claimed[epoch][msg.sender] = true;
        epochClaimed[epoch] = spent;

        require(token.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit Claimed(msg.sender, epoch, amount);
    }

    /// @notice Recover a token sent here by mistake. Deliberately CANNOT move
    ///         the reward token: the pool is the players', and the owner
    ///         having a way to empty it would make every promise above void.
    function sweep(address foreign, address to) external onlyOwner {
        require(foreign != address(token), "CANNOT_SWEEP_REWARDS");
        require(to != address(0), "ZERO_TO");
        uint256 amount = IERC20Minimal(foreign).balanceOf(address(this));
        require(IERC20Minimal(foreign).transfer(to, amount), "TRANSFER_FAILED");
        emit Swept(foreign, to, amount);
    }

    function unclaimed(uint256 epoch) external view returns (uint256) {
        return epochBudget[epoch] - epochClaimed[epoch];
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
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
