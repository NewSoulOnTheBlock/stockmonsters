/*
 * chain-guard.js — the one place that decides which chain the player is on.
 *
 *   await SMChain.ensure(window.ethereum)   // switches, or throws saying why
 *   SMChain.explorerTx(hash)                // a link the player can open
 *
 * ## Why this is a classic script in public/ and not a module
 *
 * Two callers need it and they live in different worlds: the title screen is
 * plain inline script inside index.html, and the game UI is bundled
 * TypeScript. A `public/` script is the one shape both can use without either
 * duplicating the logic — index.html loads it with a <script src>, and
 * src/chain-guard.ts is a thin typed shim over the same global.
 *
 * ## Why a guard at all
 *
 * Every signature this game produces is bound to a chain id: the box voucher,
 * the duel wager, the reward claim. A wallet parked on mainnet will happily
 * sign a Sepolia-domain message and then broadcast the transaction to
 * mainnet, where the contract address is somebody else's contract — or
 * nothing at all. The failure is silent and expensive, so the switch happens
 * BEFORE the first signature rather than after a failed send.
 */
(function () {
  'use strict';

  /*
   * Chains we can ADD to a wallet that has never seen them. Switching to a
   * chain the wallet already knows needs none of this — which covers Sepolia
   * in every mainstream wallet — so the table exists for the local anvil case
   * and as a fallback.
   *
   * The RPC URLs here are deliberately public ones and NOT the server's own
   * SM_RPC_URL: that may later be a keyed endpoint, and handing a paid API key
   * to every visitor's wallet is how a key ends up in someone else's app.
   */
  var KNOWN = {
    1: {
      chainId: '0x1',
      chainName: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-rpc.publicnode.com'],
      blockExplorerUrls: ['https://etherscan.io']
    },
    11155111: {
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
      blockExplorerUrls: ['https://sepolia.etherscan.io']
    },
    31337: {
      chainId: '0x7a69',
      chainName: 'Anvil (local)',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['http://127.0.0.1:8545'],
      blockExplorerUrls: []
    }
  };

  function fail(code, message) {
    var err = new Error(message);
    err.smCode = code;
    return err;
  }

  /** A wallet's own "the user clicked reject" across the several shapes of it. */
  function isRejection(err) {
    if (!err) return false;
    if (err.code === 4001) return true;
    return /user rejected|user denied|request rejected/i.test(err.message || '');
  }

  /**
   * "This wallet has never heard of that chain." MetaMask says 4902; several
   * wrappers bury the same thing in a -32603 with the code nested, and mobile
   * wallets sometimes only say it in the message.
   */
  function isUnknownChain(err) {
    if (!err) return false;
    if (err.code === 4902) return true;
    if (err.data && err.data.originalError && err.data.originalError.code === 4902) return true;
    return /unrecognized chain|unrecognised chain|chain .*not (been )?added|add.*chain first/i
      .test(err.message || '');
  }

  var expectedPromise = null;

  /**
   * What the SERVER says the chain is. Asking the server rather than baking it
   * into the page means moving from Sepolia to mainnet is one env var, and it
   * cannot drift from the chain id the server signs its vouchers with.
   */
  function expected() {
    if (!expectedPromise) {
      expectedPromise = fetch('/token/chain')
        .then(function (r) {
          if (!r.ok) throw fail('no-config', 'The server did not say which chain to use.');
          return r.json();
        })
        .then(function (info) {
          if (!info || !info.chainId) {
            throw fail('no-config', 'The server has no chain configured.');
          }
          return info;
        })
        .catch(function (err) {
          // Do not cache a failure: a server that was restarting should not
          // leave the page permanently unable to transact.
          expectedPromise = null;
          throw err;
        });
    }
    return expectedPromise;
  }

  function current(eth) {
    return eth.request({ method: 'eth_chainId' }).then(function (hex) {
      return parseInt(hex, 16);
    });
  }

  /**
   * Put the wallet on the right chain, or explain why it is not there.
   *
   * Returns the chain id on success. Every failure carries `smCode` so callers
   * can tell "they said no" from "their wallet cannot do this" without parsing
   * a wallet vendor's prose.
   */
  function ensure(eth) {
    if (!eth) return Promise.reject(fail('no-wallet', 'No browser wallet found.'));
    return expected().then(function (info) {
      var want = Number(info.chainId);
      var hex = '0x' + want.toString(16);
      return current(eth).then(function (have) {
        if (have === want) return want;

        return eth
          .request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
          .catch(function (err) {
            if (isRejection(err)) {
              throw fail('rejected', 'Staying on the wrong network — ' + info.name
                + ' is where this game lives.');
            }
            if (!isUnknownChain(err)) throw err;
            var params = KNOWN[want];
            if (!params) {
              throw fail('cannot-add', 'Add ' + info.name + ' (chain ' + want
                + ') to your wallet manually, then try again.');
            }
            return eth
              .request({ method: 'wallet_addEthereumChain', params: [params] })
              .catch(function (addErr) {
                throw isRejection(addErr)
                  ? fail('rejected', info.name + ' was not added to your wallet.')
                  : addErr;
              })
              .then(function () {
                // Adding a chain is not selecting it. Some wallets switch as a
                // side effect and some leave you exactly where you were, so the
                // switch has to be asked for again — proven in a real browser,
                // where skipping this left the wallet on mainnet.
                return eth.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: hex }]
                });
              })
              .catch(function (againErr) {
                if (isRejection(againErr)) {
                  throw fail('rejected', 'Staying on the wrong network — ' + info.name
                    + ' is where this game lives.');
                }
                // Not fatal on its own: the read below is the real verdict.
                return null;
              });
          })
          .then(function () {
            // Some wallets resolve the switch before it has taken. Trust the
            // read, not the resolved promise.
            return current(eth);
          })
          .then(function (now) {
            if (now !== want) {
              throw fail('wrong-chain', 'Your wallet is on chain ' + now + '. Switch it to '
                + info.name + ' and try again.');
            }
            return want;
          });
      });
    });
  }

  /** A block explorer link, or null when the chain has no explorer we know. */
  function explorerTx(hash) {
    var info = SMChain._last;
    var known = info && KNOWN[Number(info.chainId)];
    var base = (info && info.explorer) || (known && known.blockExplorerUrls[0]);
    return base ? base.replace(/\/$/, '') + '/tx/' + hash : null;
  }

  /**
   * A player who switches network mid-session is holding a page whose every
   * cached address is now wrong. Say so once, loudly, rather than letting the
   * next transaction fail somewhere confusing.
   */
  function watch() {
    if (!window.ethereum || watch._on) return;
    watch._on = true;
    window.ethereum.on &&
      window.ethereum.on('chainChanged', function (hex) {
        var now = parseInt(hex, 16);
        expected()
          .then(function (info) {
            window.dispatchEvent(
              new CustomEvent('sm:chain', {
                detail: { chainId: now, expected: Number(info.chainId), ok: now === Number(info.chainId) }
              })
            );
          })
          .catch(function () {});
      });
  }

  var SMChain = {
    expected: expected,
    current: current,
    ensure: ensure,
    explorerTx: explorerTx,
    watch: watch,
    _last: null
  };
  // Cache the last answer synchronously so explorerTx() can stay sync.
  expected()
    .then(function (info) { SMChain._last = info; })
    .catch(function () {});

  window.SMChain = SMChain;
  watch();
})();
