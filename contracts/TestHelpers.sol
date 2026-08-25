// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Shared test scaffolding. No forge-std dependency: the cheatcodes we use are
/// declared inline, exactly like the original suite.

interface Vm {
    function sign(uint256 pk, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 pk) external returns (address);
    function prank(address who) external;
    function startPrank(address who) external;
    function stopPrank() external;
    function deal(address who, uint256 amount) external;
    function expectRevert(bytes calldata) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 id) external;
    function setNonce(address who, uint64 nonce) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
}

library TestLib {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// True if `needle` appears anywhere in `haystack`.
    function contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// Strip the "data:application/json;base64," prefix and decode, so tests
    /// can assert on the actual JSON a wallet would see.
    function decodeTokenURI(string memory uri) internal pure returns (string memory) {
        bytes memory b = bytes(uri);
        uint256 prefix = 29; // bytes("data:application/json;base64,").length
        require(b.length > prefix, "URI_TOO_SHORT");
        bytes memory payload = new bytes(b.length - prefix);
        for (uint256 i = 0; i < payload.length; i++) payload[i] = b[i + prefix];
        return string(base64Decode(payload));
    }

    function base64Decode(bytes memory data) internal pure returns (bytes memory) {
        require(data.length % 4 == 0, "BAD_B64");
        if (data.length == 0) return "";
        uint256 pad = 0;
        if (data[data.length - 1] == bytes1(0x3d)) pad++;
        if (data[data.length - 2] == bytes1(0x3d)) pad++;
        bytes memory out = new bytes((data.length / 4) * 3 - pad);
        uint256 o = 0;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint256 chunk = (_b64val(data[i]) << 18) | (_b64val(data[i + 1]) << 12) | (_b64val(data[i + 2]) << 6)
                | _b64val(data[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 16));
            if (o < out.length) out[o++] = bytes1(uint8((chunk >> 8) & 0xFF));
            if (o < out.length) out[o++] = bytes1(uint8(chunk & 0xFF));
        }
        return out;
    }

    function _b64val(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65; // A-Z
        if (x >= 97 && x <= 122) return x - 97 + 26; // a-z
        if (x >= 48 && x <= 57) return x - 48 + 52; // 0-9
        if (x == 43) return 62; // +
        if (x == 47) return 63; // /
        if (x == 61) return 0; // =
        revert("BAD_B64_CHAR");
    }
}

/// Returns the magic value: a well-behaved ERC-721 holder.
contract AcceptingReceiver {
    bytes public lastData;
    address public lastOperator;
    address public lastFrom;
    uint256 public lastTokenId;

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4)
    {
        lastOperator = operator;
        lastFrom = from;
        lastTokenId = tokenId;
        lastData = data;
        return this.onERC721Received.selector;
    }
}

/// Returns a WRONG magic value — safeTransferFrom must reject it.
contract RejectingReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

/// Reverts outright inside the hook, with a message the caller must surface.
contract RevertingReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("I_HATE_NFTS");
    }
}

/// A contract with no ERC-721 hook at all.
contract NonReceiver {
    uint256 public x;

    function poke() external {
        x++;
    }
}

/// Refuses incoming ETH while `accepting` is false — used to prove payouts
/// fall back to the pull ledger instead of bricking the buyer's transaction.
contract EthRefuser {
    bool public accepting;

    function setAccepting(bool v) external {
        accepting = v;
    }

    receive() external payable {
        require(accepting, "NO_ETH_THANKS");
    }

    function callWithdraw(address market) external {
        (bool ok, bytes memory data) = market.call(abi.encodeWithSignature("withdrawPayments()"));
        if (!ok) {
            assembly {
                revert(add(32, data), mload(data))
            }
        }
    }
}
