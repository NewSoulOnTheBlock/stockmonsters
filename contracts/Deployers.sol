// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockmonstersProxy} from "./Upgradeable.sol";
import {StockmonstersTreasury} from "./StockmonstersTreasury.sol";
import {StockmonstersRewards} from "./StockmonstersRewards.sol";
import {StockmonstersToken} from "./StockmonstersToken.sol";
import {StockmonstersNFT} from "./StockmonstersNFT.sol";
import {StockmonstersMarket} from "./StockmonstersMarket.sol";
import {StockmonstersGyms} from "./StockmonstersGyms.sol";
import {StockmonstersArena} from "./StockmonstersArena.sol";

/// @title One place that knows how each contract is put behind a proxy
///
/// Every upgradeable contract here is deployed the same way — implementation,
/// then a proxy that initialises it IN THE SAME TRANSACTION. That second part
/// is not tidiness: a proxy that exists for even one block uninitialised can be
/// initialised by whoever is watching, and they become the owner.
///
/// The tests and the deploy script both go through here, so there is one
/// definition of "deployed correctly" rather than two that can drift.
library Deployers {
    function treasury(address token, address rewardsPool, address opsWallet, address owner)
        internal
        returns (StockmonstersTreasury)
    {
        StockmonstersTreasury impl = new StockmonstersTreasury();
        return StockmonstersTreasury(
            payable(
                address(
                    new StockmonstersProxy(
                        address(impl),
                        abi.encodeCall(StockmonstersTreasury.initialize, (token, rewardsPool, opsWallet, owner))
                    )
                )
            )
        );
    }

    function rewards(address token, address claimSigner, address owner)
        internal
        returns (StockmonstersRewards)
    {
        StockmonstersRewards impl = new StockmonstersRewards();
        return StockmonstersRewards(
            address(
                new StockmonstersProxy(
                    address(impl), abi.encodeCall(StockmonstersRewards.initialize, (token, claimSigner, owner))
                )
            )
        );
    }

    function token(
        string memory name,
        string memory symbol,
        uint256 supply,
        address rewardsPool,
        address treasury_,
        string memory logo,
        string memory description,
        address holder
    ) internal returns (StockmonstersToken) {
        StockmonstersToken impl = new StockmonstersToken();
        return StockmonstersToken(
            address(
                new StockmonstersProxy(
                    address(impl),
                    abi.encodeCall(
                        StockmonstersToken.initialize,
                        (name, symbol, supply, rewardsPool, treasury_, logo, description, holder)
                    )
                )
            )
        );
    }

    function nft(address gameSigner, string memory imageBaseURI, string memory sealedImageURI, address owner)
        internal
        returns (StockmonstersNFT)
    {
        StockmonstersNFT impl = new StockmonstersNFT();
        return StockmonstersNFT(
            address(
                new StockmonstersProxy(
                    address(impl),
                    abi.encodeCall(StockmonstersNFT.initialize, (gameSigner, imageBaseURI, sealedImageURI, owner))
                )
            )
        );
    }

    function market(address collection, address feeRecipient, uint96 feeBps, address owner)
        internal
        returns (StockmonstersMarket)
    {
        StockmonstersMarket impl = new StockmonstersMarket();
        return StockmonstersMarket(
            address(
                new StockmonstersProxy(
                    address(impl),
                    abi.encodeCall(StockmonstersMarket.initialize, (collection, feeRecipient, feeBps, owner))
                )
            )
        );
    }

    function gyms(
        address token_,
        address treasury_,
        address resultSigner,
        uint256 minStake,
        uint256 maxStake,
        address owner
    ) internal returns (StockmonstersGyms) {
        StockmonstersGyms impl = new StockmonstersGyms();
        return StockmonstersGyms(
            address(
                new StockmonstersProxy(
                    address(impl),
                    abi.encodeCall(
                        StockmonstersGyms.initialize, (token_, treasury_, resultSigner, minStake, maxStake, owner)
                    )
                )
            )
        );
    }

    function arena(
        address token_,
        address treasury_,
        address resultSigner,
        uint256 maxWager,
        uint256 dailyPayoutCap,
        address owner
    ) internal returns (StockmonstersArena) {
        StockmonstersArena impl = new StockmonstersArena();
        return StockmonstersArena(
            address(
                new StockmonstersProxy(
                    address(impl),
                    abi.encodeCall(
                        StockmonstersArena.initialize,
                        (token_, treasury_, resultSigner, maxWager, dailyPayoutCap, owner)
                    )
                )
            )
        );
    }
}
