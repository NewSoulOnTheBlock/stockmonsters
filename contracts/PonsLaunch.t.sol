// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TestHelpers.sol";

/// What a pons launch actually costs and what it is worth when it graduates.
///
///   forge test --fork-url https://rpc.mainnet.chain.robinhood.com \
///              --match-path PonsLaunch.t.sol -vv
///
/// ## Why this exists
///
/// Every price in the game — a quest at $1-2, a box, the reward board — is
/// derived from what one SMON is worth. Until now that number was ours to
/// choose: we minted the supply and seeded the pool, so `$200k market cap over
/// a fixed billion` was an assumption we could simply write down.
///
/// Launching through pons takes that decision away. The factory mints the
/// whole supply to a bonding curve, the curve prices every sale, and the pool
/// opens at whatever the curve arrived at. We do not set the opening price. So
/// the only honest way to know it is to run a real launch and read the result.
///
/// ## Why a fork and not the testnet
///
/// pons is not deployed on Robinhood testnet — chain 46630 answers, but the
/// factory address holds no code there. A fork of mainnet is the only place
/// the real contracts exist, and it costs nothing: this launches a token,
/// buys the curve out, and graduates it against the actual factory, hook and
/// deployer, without writing a byte to the chain.
///
/// ## What it measures
///
/// The launch record reports `sweptQuote` and `sweptTokens` — exactly what
/// went into the Uniswap v4 pool at graduation. The opening price is one
/// divided by the other, and the market cap is that price across the supply.
/// Everything the game charges follows from those two numbers.
interface IPonsFactory {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    struct LaunchConfig {
        uint256 supply;
        uint256 curveFeeBps;
        uint256 phantomQuote;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        bool enabled;
    }

    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function launchToken(TokenParams calldata p, uint256 configId, address pairToken)
        external
        payable
        returns (address token, address curve);
    function previewLaunchEconomics(uint256 configId, address pairToken) external view returns (bytes32);
    function launchFee() external view returns (uint256);
    function maxCreatorTaxBps() external view returns (uint16);
    function launchConfigCount() external view returns (uint256);
    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory);
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function canLaunch(address who) external view returns (bool);
}

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function sellableTokens() external view returns (uint256);
    function readyToGraduate() external view returns (bool);
    function graduated() external view returns (bool);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function currentSnipeTaxBps(address recipient) external view returns (uint256);
}

interface IERC20Min {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// Minimal console.log. forge-std is not a dependency of this repo, and the
/// whole point of this suite is the numbers it prints.
library console {
    address constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;

    function log(string memory a) internal view {
        _send(abi.encodeWithSignature("log(string)", a));
    }

    function log(string memory a, uint256 b) internal view {
        _send(abi.encodeWithSignature("log(string,uint256)", a, b));
    }

    function log(string memory a, address b) internal view {
        _send(abi.encodeWithSignature("log(string,address)", a, b));
    }

    function log(string memory a, string memory b) internal view {
        _send(abi.encodeWithSignature("log(string,string)", a, b));
    }

    function log(string memory a, bool b) internal view {
        _send(abi.encodeWithSignature("log(string,bool)", a, b));
    }

    function _send(bytes memory payload) private view {
        address target = CONSOLE;
        assembly {
            pop(staticcall(gas(), target, add(payload, 32), mload(payload), 0, 0))
        }
    }
}

contract PonsLaunchTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    IPonsFactory constant FACTORY = IPonsFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant NATIVE = address(0);

    /// One ETH in dollars, only for reporting. The measured numbers below are
    /// denominated in ETH; this turns them into the units the game prices in
    /// so nobody has to do it in their head. Change it, rerun, and the whole
    /// report moves with it.
    uint256 constant ETH_USD = 3000;

    uint256 constant CONFIG_ID = 0;

    address creator = address(0xC0FFEE);
    address buyer = address(0xBEEF);

    IPonsFactory.LaunchConfig config;
    address token;
    address curve;

    receive() external payable {}

    function setUp() public {
        // Without `--fork-url` pointing at Robinhood Chain there is no pons at
        // that address, and every test here is about pons. Skipping says so;
        // failing would look like our own contracts were broken.
        if (address(FACTORY).code.length == 0) {
            vm.skip(true);
            return;
        }
        config = FACTORY.getLaunchConfig(CONFIG_ID);
        vm.deal(creator, 1_000 ether);
        vm.deal(buyer, 1_000 ether);
    }

    /* ------------------------------------------------------------------ */

    /// The terms we would be launching under, read from the live factory
    /// rather than from the docs. These are fixed at creation and can never
    /// be changed afterwards, so they are worth printing in full.
    function test_theTermsWeWouldBeLaunchingUnder() public view {
        console.log("supply             ", config.supply / 1e18);
        console.log("curve fee bps      ", config.curveFeeBps);
        console.log("phantom quote wei  ", config.phantomQuote);
        console.log("graduation wei     ", config.graduationThreshold);
        console.log("pool fee           ", uint256(config.poolFee));
        console.log("launch fee wei     ", FACTORY.launchFee());
        console.log("max creator tax bps", uint256(FACTORY.maxCreatorTaxBps()));
        console.log("configs available  ", FACTORY.launchConfigCount());
        console.log("we may launch      ", FACTORY.canLaunch(creator));

        require(config.enabled, "the config we would use is open");
        require(config.poolFee == 0, "the pool charges nothing; the hook charges the fee");
    }

    /// The whole point. Launch a token, buy the curve out, and read what the
    /// pool opened at.
    function test_whatOneTokenIsWorthWhenTheLaunchGraduates() public {
        _launch();

        uint256 spent = _buyOutTheCurve();

        IPonsFactory.LaunchedToken memory rec = FACTORY.getLaunchedToken(token);
        require(rec.sweptTokens > 0, "the curve handed tokens to the pool");
        require(rec.sweptQuote > 0, "the curve handed ETH to the pool");

        // Wei of ETH per whole token, and the market cap that implies across
        // the entire supply.
        uint256 weiPerToken = (rec.sweptQuote * 1e18) / rec.sweptTokens;
        uint256 capWei = (weiPerToken * config.supply) / 1e18;

        console.log("");
        console.log("--- what it cost to graduate it ---");
        console.log("gross ETH spent by buyers (wei)", spent);
        console.log("in dollars                     ", (spent * ETH_USD) / 1e18);
        console.log("");
        console.log("--- what went into the v4 pool ---");
        console.log("ETH into the pool (wei)        ", rec.sweptQuote);
        console.log("tokens into the pool           ", rec.sweptTokens / 1e18);
        console.log("share of supply in the pool (%)", (rec.sweptTokens * 100) / config.supply);
        console.log("");
        console.log("--- the opening price ---");
        console.log("wei per token                  ", weiPerToken);
        console.log("market cap (wei)               ", capWei);
        console.log("market cap in ETH              ", capWei / 1e18);
        console.log("MARKET CAP IN DOLLARS          ", (capWei * ETH_USD) / 1e18);
        console.log("");
        console.log("one token in millionths of a cent", (weiPerToken * ETH_USD * 100_000_000) / 1e18);

        require(capWei > 0, "the launch has a price");
    }

    /// The supply is minted to the curve, not to us. This is the fact that
    /// breaks the current economy: the rewards pool is seeded today with 100M
    /// tokens we minted ourselves, and under pons there is no such mint.
    function test_theCreatorIsHoldingNothingAfterLaunching() public {
        _launch();

        uint256 held = IERC20Min(token).balanceOf(creator);
        uint256 onCurve = IERC20Min(token).balanceOf(curve);

        console.log("creator holds     ", held);
        console.log("curve holds       ", onCurve / 1e18);
        console.log("total supply      ", IERC20Min(token).totalSupply() / 1e18);

        require(held == 0, "the creator is holding no tokens at launch");
        require(onCurve == IERC20Min(token).totalSupply(), "the curve holds the entire supply");
    }

    /// The opening tax is real and it decays. A launch bought in the first
    /// second is taxed near-totally; a few seconds later it is not. Worth
    /// proving because our own opening buy has to be timed against it.
    function test_theOpeningTaxDecaysToNothing() public {
        // NOT `_launch()`: that one warps a minute forward so the price it
        // measures is an ordinary market. Reading the opening tax after the
        // window has closed reads zero and proves nothing, which is exactly
        // what the first version of this test did.
        _launchAtTheOpen();

        uint256 atOpen = IPonsCurve(curve).currentSnipeTaxBps(buyer);
        vm.warp(block.timestamp + 2);
        uint256 afterTwo = IPonsCurve(curve).currentSnipeTaxBps(buyer);
        vm.warp(block.timestamp + 30);
        uint256 afterThirty = IPonsCurve(curve).currentSnipeTaxBps(buyer);

        console.log("snipe tax bps at open  ", atOpen);
        console.log("snipe tax bps after 2s ", afterTwo);
        console.log("snipe tax bps after 32s", afterThirty);

        require(afterThirty == 0, "the opening tax is gone within the window");
        require(atOpen > afterTwo, "and it decays rather than stepping off a cliff");
    }

    /// The creator is exempt from their own opening tax, which is what lets us
    /// take a position at the open without paying 99% for it.
    function test_theCreatorIsExemptFromTheOpeningTax() public {
        _launchAtTheOpen();

        uint256 forCreator = IPonsCurve(curve).currentSnipeTaxBps(creator);
        uint256 forStranger = IPonsCurve(curve).currentSnipeTaxBps(buyer);

        console.log("snipe tax bps for the creator ", forCreator);
        console.log("snipe tax bps for a stranger  ", forStranger);

        require(forCreator == 0, "the creator is exempt at the open");
        // Without this the assertion above passes for the wrong reason: after
        // the window everybody reads zero.
        require(forStranger > 0, "while a stranger buying at the open is taxed");
    }

    /* ------------------------------------------------------------------ */

    /// A launch, left standing in its opening seconds. Only the two tests
    /// about the opening tax want this; everything else wants `_launch()`.
    function _launchAtTheOpen() internal {
        require(FACTORY.canLaunch(creator), "launching is open to us");

        bytes32 economics = FACTORY.previewLaunchEconomics(CONFIG_ID, NATIVE);
        uint256 fee = FACTORY.launchFee();

        IPonsFactory.TokenParams memory p = IPonsFactory.TokenParams({
            name: "Stockmonsters",
            symbol: "SMON",
            logo: "ipfs://",
            description: "The currency of Stockmonsters.",
            socials: IPonsFactory.Socials({
                twitter: "https://x.com/stonksters",
                telegram: "",
                discord: "",
                website: "",
                farcaster: ""
            }),
            creatorFeeRecipient: creator,
            // Zero for the measurement. A creator tax would come off every
            // trade on top of the base fee, and pricing the game against a
            // taxed launch means measuring it with the tax on.
            creatorTaxBps: 0,
            buybackEnabled: false,
            expectedEconomics: economics,
            salt: keccak256("stockmonsters-fork-measurement")
        });

        vm.prank(creator);
        (token, curve) = FACTORY.launchToken{value: fee}(p, CONFIG_ID, NATIVE);

        require(token != address(0) && curve != address(0), "the launch produced a token and a curve");
    }

    /// A launch past its opening tax window, so what gets measured is an
    /// ordinary market rather than the first five seconds of one.
    function _launch() internal {
        _launchAtTheOpen();
        vm.warp(block.timestamp + 60);
    }

    /// Buy until the curve has nothing left to sell. The last buy is clamped
    /// to the reserved allocation and refunded the difference, so this counts
    /// what was actually spent rather than what was offered.
    function _buyOutTheCurve() internal returns (uint256 spent) {
        for (uint256 i = 0; i < 200; i++) {
            if (IPonsCurve(curve).sellableTokens() == 0) break;
            if (IPonsCurve(curve).graduated()) break;

            uint256 offer = 0.5 ether;
            uint256 before = buyer.balance;

            vm.prank(buyer);
            IPonsCurve(curve).buy{value: offer}(offer, 0, buyer);

            spent += before - buyer.balance;
        }

        require(IPonsCurve(curve).sellableTokens() == 0, "the curve sold out");
    }
}
