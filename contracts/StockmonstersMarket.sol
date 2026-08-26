// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StockmonstersMarket — off-chain signed orders, on-chain settlement
///
/// Seaport-lite, deliberately small (see DESIGN.md for the full rationale):
///
/// - NO ESCROW. The seller keeps custody and approves this market. Listing
///   and re-pricing cost zero gas; the buyer pays for exactly one tx. A
///   sealed box in escrow could not be opened by its owner, which would turn
///   "list" into "commit to sell" — unacceptable for this product.
/// - ONE COLLECTION, fixed at deploy. A collection-agnostic market has to
///   call `royaltyInfo`, `ownerOf` and `transferFrom` on attacker-supplied
///   addresses; pinning the collection removes that class of attack entirely.
/// - THE ORDER BINDS THE SEAL. `requireSealed` + `attrCommit` are checked
///   against live chain state at fill time, so a seller who opens the box (or
///   whose box was already open) cannot have a sealed-priced order filled.
/// - ASK ORDERS ONLY. Bids need a pullable asset (WETH); see DESIGN.md
///   §"Not built".
/// - PAYABLE IN ETH OR IN A WHITELISTED ERC-20. The currency is part of the
///   SIGNED order, so a buyer cannot substitute one; and the whitelist is
///   on-chain, so a seller cannot list against a token of their own invention
///   and lure a buyer into approving it.
interface IERC20Currency {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IStockmonstersNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function opened(uint256 tokenId) external view returns (bool);
    function attrCommit(uint256 tokenId) external view returns (bytes32);
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

contract StockmonstersMarket {
    string public constant name = "StockmonstersMarket";

    IStockmonstersNFT public immutable collection;

    // --- ownership (two-step) -----------------------------------------
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

    // --- protocol fee ---------------------------------------------------
    uint96 public constant MAX_FEE_BPS = 500; // 5%, hard cap — the owner cannot rug this
    uint96 public feeBps;
    address public feeRecipient;

    event FeeChanged(address indexed recipient, uint96 bps);
    event CurrencyAccepted(address indexed currency, bool accepted);

    function setFee(address recipient, uint96 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        require(recipient != address(0), "ZERO_RECIPIENT");
        feeBps = bps;
        feeRecipient = recipient;
        emit FeeChanged(recipient, bps);
    }

    // --- accepted currencies ---------------------------------------------
    /// address(0) (native ETH) is always accepted; everything else has to be
    /// listed here by the owner. This is the whole defence against a fake-token
    /// listing: the UI showing a price means nothing, an on-chain whitelist
    /// does.
    mapping(address => bool) public acceptedCurrency;

    function setAcceptedCurrency(address currency, bool accepted) external onlyOwner {
        require(currency != address(0), "ETH_ALWAYS_ACCEPTED");
        acceptedCurrency[currency] = accepted;
        emit CurrencyAccepted(currency, accepted);
    }

    // --- reentrancy guard -----------------------------------------------
    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANCY");
        _lock = 2;
        _;
        _lock = 1;
    }

    // --- orders -----------------------------------------------------------
    /// @param seller       must still own the token at fill time
    /// @param minProceeds  the seller's floor AFTER protocol fee and royalty.
    ///                     Binds the seller's economic expectation, so a
    ///                     `setFee` or `setDefaultRoyalty` between signing and
    ///                     filling cannot quietly take a bigger cut.
    /// @param epoch        must equal `epochOf[seller]`; bumping the epoch
    ///                     mass-cancels every outstanding order in one tx.
    /// @param salt         makes otherwise-identical relistings distinct hashes
    /// @param requireSealed the token's `opened` flag must be `!requireSealed`
    /// @param attrCommit   must equal the token's on-chain commitment
    /// @param taker        address(0) = fillable by anyone; otherwise private
    /// @param currency     address(0) = native ETH, otherwise an accepted
    ///                     ERC-20. Signed, so the price and the asset it is
    ///                     denominated in cannot be separated.
    struct Order {
        address seller;
        uint256 tokenId;
        uint256 price;
        uint256 minProceeds;
        uint64 deadline;
        uint64 epoch;
        uint256 salt;
        bool requireSealed;
        bytes32 attrCommit;
        address taker;
        address currency;
    }

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address seller,uint256 tokenId,uint256 price,uint256 minProceeds,uint64 deadline,uint64 epoch,uint256 salt,bool requireSealed,bytes32 attrCommit,address taker,address currency)"
    );

    /// Filled OR cancelled — one bit, one SSTORE, no nonce bookkeeping for
    /// the order-book server to get wrong.
    mapping(bytes32 => bool) public orderConsumed;
    mapping(address => uint64) public epochOf;
    /// Pull-payment fallback for recipients whose `receive` reverts or is a
    /// gas bomb. Nothing here can make a fill fail.
    mapping(address => uint256) public pendingWithdrawals;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed seller,
        address indexed buyer,
        uint256 tokenId,
        uint256 price,
        uint256 fee,
        uint256 royalty
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed seller);
    event EpochIncremented(address indexed seller, uint64 epoch);
    event PaymentPending(address indexed to, uint256 amount);
    event PaymentWithdrawn(address indexed to, uint256 amount);

    constructor(address _collection, address _feeRecipient, uint96 _feeBps) {
        require(_collection != address(0), "ZERO_COLLECTION");
        require(_feeBps <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        require(_feeRecipient != address(0), "ZERO_RECIPIENT");
        collection = IStockmonstersNFT(_collection);
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeChanged(_feeRecipient, _feeBps);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this)));
    }

    function hashOrder(Order calldata o) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                o.seller,
                o.tokenId,
                o.price,
                o.minProceeds,
                o.deadline,
                o.epoch,
                o.salt,
                o.requireSealed,
                o.attrCommit,
                o.taker,
                o.currency
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @notice Buy a listed Stockmonster. Paying in ETH means `msg.value` must
    ///         equal the price exactly — no partial fills, no change to give
    ///         back. Paying in an ERC-20 means approving this contract for the
    ///         price first and sending no ETH at all.
    function fillOrder(Order calldata o, bytes calldata signature) external payable nonReentrant {
        // --- checks -------------------------------------------------------
        require(block.timestamp <= o.deadline, "ORDER_EXPIRED");
        if (o.currency == address(0)) {
            require(msg.value == o.price, "WRONG_PRICE");
        } else {
            // Refusing stray ETH is not pedantry: accepting it here would
            // strand it in a contract with no way to get it out.
            require(msg.value == 0, "NO_ETH_FOR_TOKEN_ORDER");
            require(acceptedCurrency[o.currency], "CURRENCY_NOT_ACCEPTED");
        }
        require(msg.sender != o.seller, "SELF_FILL");
        require(o.taker == address(0) || o.taker == msg.sender, "NOT_TAKER");
        require(o.epoch == epochOf[o.seller], "ORDER_STALE");

        bytes32 orderHash = hashOrder(o);
        require(!orderConsumed[orderHash], "ORDER_CONSUMED");
        require(_recover(orderHash, signature) == o.seller, "BAD_SIGNATURE");

        require(collection.ownerOf(o.tokenId) == o.seller, "SELLER_NOT_OWNER");
        // The crux: the sale price was agreed for a specific information
        // state. If the seller opened the box after signing (or the buyer is
        // trying to buy an opened token at the sealed price), this reverts.
        require(collection.opened(o.tokenId) == !o.requireSealed, "SEAL_STATE_MISMATCH");
        require(collection.attrCommit(o.tokenId) == o.attrCommit, "COMMIT_MISMATCH");

        uint256 fee = (o.price * feeBps) / 10_000;
        (address royaltyReceiver, uint256 royalty) = collection.royaltyInfo(o.tokenId, o.price);
        if (royaltyReceiver == address(0)) royalty = 0;
        require(fee + royalty <= o.price, "PAYOUT_OVERFLOW");
        uint256 proceeds = o.price - fee - royalty;
        require(proceeds >= o.minProceeds, "PROCEEDS_TOO_LOW");

        // --- effects ------------------------------------------------------
        orderConsumed[orderHash] = true;

        // --- interactions -------------------------------------------------
        collection.safeTransferFrom(o.seller, msg.sender, o.tokenId);
        if (o.currency == address(0)) {
            _pay(feeRecipient, fee);
            _pay(royaltyReceiver, royalty);
            _pay(o.seller, proceeds);
        } else {
            // Straight from the buyer to each recipient: there is no pull
            // fallback for an ERC-20 (nothing can be stranded, because this
            // contract never holds it) and no approval for the seller to make.
            _payToken(o.currency, msg.sender, feeRecipient, fee);
            _payToken(o.currency, msg.sender, royaltyReceiver, royalty);
            _payToken(o.currency, msg.sender, o.seller, proceeds);
        }

        emit OrderFilled(orderHash, o.seller, msg.sender, o.tokenId, o.price, fee, royalty);
    }

    /// @notice Invalidate one signed order on-chain. Delisting in the game UI
    ///         is NOT a cancellation: a signed order plus a live approval
    ///         stays fillable by anyone who saved the signature.
    function cancelOrder(Order calldata o) external {
        require(msg.sender == o.seller, "NOT_SELLER");
        bytes32 orderHash = hashOrder(o);
        require(!orderConsumed[orderHash], "ORDER_CONSUMED");
        orderConsumed[orderHash] = true;
        emit OrderCancelled(orderHash, o.seller);
    }

    /// @notice Mass-cancel: invalidates every outstanding order of the caller
    ///         in a single tx (the panic button after a key scare).
    function incrementEpoch() external {
        uint64 next;
        unchecked {
            next = epochOf[msg.sender] + 1;
        }
        epochOf[msg.sender] = next;
        emit EpochIncremented(msg.sender, next);
    }

    function withdrawPayments() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "NOTHING_PENDING");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WITHDRAW_FAILED");
        emit PaymentWithdrawn(msg.sender, amount);
    }

    // --- internals ---------------------------------------------------------
    /// Push with a bounded stipend, fall back to a pull credit. A recipient
    /// that reverts or burns gas cannot grief the buyer's transaction, and no
    /// ETH is ever stranded.
    function _pay(address to, uint256 amount) private {
        if (amount == 0 || to == address(0)) return;
        (bool ok,) = to.call{value: amount, gas: 30_000}("");
        if (!ok) {
            pendingWithdrawals[to] += amount;
            emit PaymentPending(to, amount);
        }
    }

    /// Move `amount` of `currency` and CHECK IT LANDED. The delta check is
    /// what makes a fee-on-transfer token safe here: it would credit the
    /// recipient less than the order promised, and this reverts instead of
    /// quietly short-paying the seller.
    function _payToken(address currency, address from, address to, uint256 amount) private {
        if (amount == 0 || to == address(0)) return;
        uint256 before = IERC20Currency(currency).balanceOf(to);
        require(IERC20Currency(currency).transferFrom(from, to, amount), "PAYMENT_FAILED");
        require(IERC20Currency(currency).balanceOf(to) - before == amount, "PAYMENT_SHORTFALL");
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "BAD_SIG_LEN");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "BAD_SIG_V");
        // EIP-2: reject malleable s values, so one order cannot be presented
        // under two different signatures.
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "BAD_SIG_S");
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "BAD_SIGNATURE");
        return recovered;
    }
}
