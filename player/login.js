// Stockmonsters wallet login. Runs before the emulator exists: finds Ethereum
// wallets (EIP-6963 + window.ethereum), has the chosen one sign a plain-text
// login message (personal_sign), and trades that for a server session.
// Later, minting a Stockmonster's NFT or trading one asks the same wallet to
// send a transaction or sign a swap (window.StockmonstersWallet); the player
// approves each one in the wallet. Never keys or seeds.
// "Play as guest" skips the wallet: { guest: true, wallet: null, token: null },
// so the server treats the player as a listener (no chat, trades, battles, NFTs).
// On success: window.StockmonstersSession = { wallet, token, profile }, the
// "stockmonsters:session" event fires, and window.bootStockmonsters() runs.
(() => {
  const TOKEN_KEY = "stockmonsters.session";
  const WALLET_KEY = "stockmonsters.wallet"; // which wallet app to reconnect for transactions
  const remember = {
    get() { try { return localStorage.getItem(WALLET_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(WALLET_KEY, v); } catch {} },
  };
  let activeConn = null; // { address, provider, name } once connected this page load
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };
  const short = (w) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);
  const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const utf8Hex = (s) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

  // ---- wallet discovery ----------------------------------------------------
  // EIP-6963: every installed wallet announces itself, so MetaMask, Rabby,
  // Coinbase, Trust... all show up side by side instead of fighting over
  // window.ethereum.
  const found = []; // { name, icon, rdns, provider }
  const seen = (name) => found.some((w) => w.name.toLowerCase() === name.toLowerCase());

  window.addEventListener("eip6963:announceProvider", (e) => {
    try {
      const { info, provider } = e.detail || {};
      if (!info?.name || !provider?.request || seen(info.name)) return;
      found.push({ name: info.name, icon: info.icon, rdns: info.rdns, provider });
      render();
    } catch {}
  });
  try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch {}

  // Older wallets only inject window.ethereum.
  function addLegacy() {
    const p = window.ethereum;
    if (!p?.request || found.some((w) => w.provider === p)) return;
    const name = p.isMetaMask ? "MetaMask" : p.isCoinbaseWallet ? "Coinbase Wallet" : p.isTrust ? "Trust Wallet" : "Browser wallet";
    if (!seen(name)) found.push({ name, icon: null, provider: p });
  }

  // ---- connect + sign ------------------------------------------------------
  async function connectWallet(entry) {
    const p = entry.provider;
    const accounts = await p.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0];
    if (!address) throw new Error("The wallet didn't share an account.");
    return { address, provider: p, name: entry.name };
  }

  // Wallets reject a request on the wrong network; move them to the game's.
  async function ensureChain(conn, chainId) {
    const want = "0x" + Number(chainId).toString(16);
    const have = await conn.provider.request({ method: "eth_chainId" });
    if (String(have).toLowerCase() === want) return;
    try { await conn.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
    catch { throw new Error(Number(chainId) === 1 ? "Switch your wallet to Ethereum mainnet and try again." : `Switch your wallet to chain ${chainId} and try again.`); }
  }

  async function api(path, opts = {}) {
    const res = await fetch((window.STOCKMONSTERS_SERVER || "") + path, { cache: "no-store", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 404 && !body?.error) throw new Error("This server doesn't support login yet (restart it).");
      throw new Error(body?.error || `Server error ${res.status}`);
    }
    return body;
  }

  async function signIn(entry) {
    setBusy(`Connecting to ${entry.name}…`);
    try {
      const conn = await connectWallet(entry);
      activeConn = conn;
      remember.set(entry.name);
      const { nonce } = await api(`/auth/nonce?wallet=${encodeURIComponent(conn.address)}`);
      const message = `Stock Monsters login\nWallet: ${conn.address}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
      setBusy(`Approve the sign-in message in ${entry.name}.`);
      const signature = await conn.provider.request({ method: "personal_sign", params: [utf8Hex(message), conn.address] });
      setBusy("Checking signature…");
      const s = await api("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ wallet: conn.address, message, signature }),
      });
      store.set(s.token);
      start(s);
    } catch (e) {
      const msg = e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || "") ? "Request cancelled in the wallet." : e?.message || String(e);
      setBusy(null, msg);
    }
  }

  // ---- session -------------------------------------------------------------
  let started = false;
  function start(s) {
    if (started) return;
    started = true;
    window.StockmonstersSession = { wallet: s.wallet, token: s.token, profile: s.profile, guest: !!s.guest };
    overlay.remove();
    window.dispatchEvent(new CustomEvent("stockmonsters:session", { detail: window.StockmonstersSession }));
    window.bootStockmonsters?.(s.guest ? "guest" : s.wallet);
  }

  // The logged-in wallet, for NFT mints and trades. A resumed session has no
  // live connection yet, so reconnect the remembered wallet first.
  async function liveConn() {
    if (!activeConn) {
      const name = remember.get();
      let entry = null;
      for (let i = 0; i < 20 && !entry; i++) {
        entry = found.find((w) => name ? w.name === name : true) || null;
        if (!entry) await new Promise((r) => setTimeout(r, 100));
      }
      if (!entry) throw new Error("Your wallet isn't available in this browser right now.");
      activeConn = await connectWallet(entry);
    }
    const wallet = window.StockmonstersSession?.wallet;
    if (wallet && !sameAddr(activeConn.address, wallet))
      throw new Error(`Switch your wallet to ${short(wallet)}, the account you logged in with.`);
    return activeConn;
  }

  window.StockmonstersWallet = {
    /** Sends { to, data, chainId } from the logged-in wallet; resolves to the tx hash. */
    async sendTransaction(tx) {
      const conn = await liveConn();
      await ensureChain(conn, tx.chainId);
      return conn.provider.request({ method: "eth_sendTransaction", params: [{ from: conn.address, to: tx.to, data: tx.data }] });
    },
    /** EIP-712 signature (eth_signTypedData_v4) over a wallet-ready payload. */
    async signTypedData(typedData) {
      const conn = await liveConn();
      await ensureChain(conn, typedData.domain.chainId);
      return conn.provider.request({ method: "eth_signTypedData_v4", params: [conn.address, JSON.stringify(typedData)] });
    },
  };

  window.StockmonstersLogout = async () => {
    const token = window.StockmonstersSession?.token || store.get();
    store.clear();
    if (token) { try { await fetch((window.STOCKMONSTERS_SERVER || "") + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }); } catch {} }
    location.reload();
  };

  // ---- overlay -------------------------------------------------------------
  const TOKEN_CA = "0x1b05d9458cbe691127a3f0de4f546aa32de7ffff";
  const css = document.createElement("style");
  css.textContent = `
    #sm-login { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px;
      box-sizing: border-box; overflow-y: auto; background: radial-gradient(ellipse at top, #161b22, #0d1117 70%);
      font: 15px/1.45 system-ui, sans-serif; color: #e6edf3; }
    #sm-login .card { width: min(380px, 100%); box-sizing: border-box; padding: 24px 20px; border-radius: 12px;
      background: #0d1117; border: 1px solid #30363d; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    #sm-login h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: .08em; color: #3fb950; text-align: center; }
    #sm-login .sub { margin: 0 0 18px; color: #8b949e; text-align: center; font-size: 14px; }
    #sm-login .list { display: grid; gap: 8px; }
    #sm-login button, #sm-login a.w { display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
      padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d; background: #161b22; color: inherit;
      font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
    #sm-login button:hover:not(:disabled), #sm-login a.w:hover { border-color: #3fb950; background: #12261a; }
    #sm-login button:disabled { opacity: .5; cursor: default; }
    #sm-login .ico { width: 28px; height: 28px; flex: none; border-radius: 6px; display: grid; place-items: center;
      background: #21262d; font-weight: 700; color: #3fb950; overflow: hidden; }
    #sm-login .ico img { width: 100%; height: 100%; object-fit: cover; }
    #sm-login .hint { margin: 14px 0 0; font-size: 13px; color: #8b949e; text-align: center; min-height: 1.2em; }
    #sm-login .err { color: #f85149; }
    #sm-login .fine { margin: 16px 0 0; font-size: 12px; color: #6e7681; text-align: center; }
    #sm-login .or { margin: 14px 0 8px; font-size: 12px; color: #6e7681; text-align: center; }
    #sm-login button.guest { justify-content: center; color: #8b949e; }
    #sm-login button.ca { display: block; margin: 0 0 16px; padding: 8px 10px; text-align: center; background: #161b22; }
    #sm-login .ca .k { display: block; font-size: 11px; letter-spacing: .08em; color: #8b949e; }
    #sm-login .ca code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #3fb950; word-break: break-all; }`;
  document.head.appendChild(css);

  const overlay = document.createElement("div");
  overlay.id = "sm-login";
  overlay.innerHTML = `
    <div class="card" role="dialog" aria-labelledby="sm-login-title">
      <button type="button" class="ca" title="Copy contract address"><span class="k">CA · tap to copy</span><code>${TOKEN_CA}</code></button>
      <h1 id="sm-login-title">STOCK MONSTERS</h1>
      <p class="sub">Connect an Ethereum wallet</p>
      <div class="list"></div>
      <p class="hint" aria-live="polite"></p>
      <p class="fine">You only sign a login message. No transaction, no fees, and never your seed phrase.</p>
    </div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector(".list"), hint = overlay.querySelector(".hint");
  const caLabel = overlay.querySelector(".ca .k");
  overlay.querySelector(".ca").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(TOKEN_CA); caLabel.textContent = "COPIED"; }
    catch { caLabel.textContent = "COPY FAILED, SELECT IT MANUALLY"; }
    setTimeout(() => { caLabel.textContent = "CA · tap to copy"; }, 1500);
  });
  let busy = false, ready = false;

  function icon(entry) {
    const box = document.createElement("span");
    box.className = "ico";
    if (entry.icon && /^data:image\/|^https:\/\//.test(entry.icon)) {
      const img = document.createElement("img");
      img.src = entry.icon; img.alt = "";
      box.appendChild(img);
    } else box.textContent = entry.name[0];
    return box;
  }

  function render() {
    if (started || !ready) return;
    list.replaceChildren();
    if (!found.length) {
      hint.textContent = "No Ethereum wallet found in this browser. Install one, then reload:";
      for (const [name, url] of [["MetaMask", "https://metamask.io/download/"], ["Rabby", "https://rabby.io/"], ["Coinbase Wallet", "https://www.coinbase.com/wallet/downloads"]]) {
        const a = document.createElement("a");
        a.className = "w"; a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.append(icon({ name }), document.createTextNode(`Get ${name}`));
        list.appendChild(a);
      }
      return guestButton();
    }
    if (!busy && !hint.classList.contains("err")) hint.textContent = "";
    for (const entry of found) {
      const b = document.createElement("button");
      b.type = "button"; b.disabled = busy;
      b.append(icon(entry), document.createTextNode(entry.name));
      b.addEventListener("click", () => signIn(entry));
      list.appendChild(b);
    }
    guestButton();
  }

  // Guests play offline-style: their save stays in this browser, and online
  // features need a wallet. Not remembered, so a reload shows this screen again.
  function guestButton() {
    const or = document.createElement("p");
    or.className = "or";
    or.textContent = "or";
    const b = document.createElement("button");
    b.type = "button"; b.className = "guest"; b.disabled = busy;
    b.textContent = "Play as guest";
    b.title = "No wallet: chat, trades, battles and NFTs stay off";
    b.addEventListener("click", () => start({ guest: true, wallet: null, token: null, profile: null }));
    list.append(or, b);
  }

  function setBusy(text, error) {
    busy = !!text;
    hint.classList.toggle("err", !!error);
    hint.textContent = error || text || "";
    render();
  }

  // ---- boot ----------------------------------------------------------------
  (async () => {
    const token = store.get();
    if (token) {
      hint.textContent = "Resuming your session…";
      try {
        const s = await api("/auth/session", { headers: { Authorization: `Bearer ${token}` } });
        return start({ ...s, token });
      } catch { store.clear(); hint.textContent = ""; }
    }
    // Injected providers can appear a beat after load.
    const settle = () => { ready = true; addLegacy(); render(); };
    if (document.readyState === "complete") setTimeout(settle, 150);
    else window.addEventListener("load", () => setTimeout(settle, 150));
    setTimeout(settle, 1200);
  })();
})();
