// Stockmonsters wallet login. Runs before the emulator exists: finds Solana
// wallets (Wallet Standard + legacy injected providers), has the chosen one
// sign a plain-text login message, and trades that for a server session.
// Login only uses signMessage. Later, minting and updating a Stockmonster's NFT
// asks the same wallet to sign a transaction (window.StockmonstersWallet); the
// player approves each one in the wallet. Never keys or seeds.
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
  let activeConn = null; // { address, sign, signTransaction } once connected this page load
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };
  const short = (w) => (w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);

  // ---- base58 encode (only for wallets that hand us raw key bytes) ---------
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58(bytes) {
    const digits = []; // little-endian base-58
    for (const b of bytes) {
      let carry = b;
      for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
      while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
    }
    let s = "";
    for (const b of bytes) { if (b) break; s += "1"; }
    for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
    return s;
  }
  const b64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const keyString = (pk) => !pk ? "" : typeof pk === "string" ? pk : pk.toBase58 ? pk.toBase58() : pk instanceof Uint8Array ? base58(pk) : String(pk);

  // ---- wallet discovery ----------------------------------------------------
  const found = []; // { name, icon, kind: "standard"|"legacy", wallet|provider }
  const seen = (name) => found.some((w) => w.name.toLowerCase() === name.toLowerCase());

  function addStandard(w) {
    try {
      const f = w.features || {};
      const solana = (w.chains || []).some((c) => String(c).startsWith("solana:"));
      if (!solana || !f["solana:signMessage"] || !f["standard:connect"] || seen(w.name)) return;
      found.push({ name: w.name, icon: w.icon, kind: "standard", wallet: w });
      render();
    } catch {}
  }

  // Wallet Standard, by hand: wallets that loaded first answer app-ready;
  // wallets that load later announce themselves with register-wallet.
  const registerApi = Object.freeze({
    register(...wallets) { wallets.forEach(addStandard); return () => {}; },
  });
  window.addEventListener("wallet-standard:register-wallet", (e) => {
    try { e.detail(registerApi); } catch {}
  });
  try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: registerApi })); } catch {}

  function addLegacy() {
    const legacy = [
      ["Phantom", window.phantom?.solana?.isPhantom ? window.phantom.solana : null],
      ["Solflare", window.solflare?.isSolflare || window.solflare?.signMessage ? window.solflare : null],
      ["Backpack", window.backpack?.signMessage ? window.backpack : null],
    ];
    for (const [name, provider] of legacy) if (provider && !seen(name)) found.push({ name, icon: null, kind: "legacy", provider });
  }

  // ---- connect + sign ------------------------------------------------------
  async function connectWallet(entry) {
    if (entry.kind === "standard") {
      const w = entry.wallet;
      const sign = w.features["solana:signMessage"];
      const res = await w.features["standard:connect"].connect();
      const accounts = res?.accounts?.length ? res.accounts : w.accounts || [];
      const account = accounts.find((a) => !a.chains || a.chains.some((c) => String(c).startsWith("solana:"))) || accounts[0];
      if (!account) throw new Error("The wallet didn't share an account.");
      return {
        address: account.address || keyString(account.publicKey),
        sign: async (msg) => {
          const out = await sign.signMessage({ account, message: new TextEncoder().encode(msg) });
          const r = Array.isArray(out) ? out[0] : out;
          return { signature: r.signature, signed: r.signedMessage ? new TextDecoder().decode(r.signedMessage) : msg };
        },
        signTransaction: async (bytes, chain) => {
          const f = w.features["solana:signTransaction"];
          if (!f) throw new Error(`${w.name} can't sign transactions here; log in with another wallet.`);
          const out = await f.signTransaction({ account, transaction: bytes, chain });
          const r = Array.isArray(out) ? out[0] : out;
          return r.signedTransaction;
        },
      };
    }
    const p = entry.provider;
    const res = await p.connect();
    const address = keyString(res?.publicKey ?? p.publicKey);
    if (!address) throw new Error("The wallet didn't share an address.");
    return {
      address,
      sign: async (msg) => {
        const out = await p.signMessage(new TextEncoder().encode(msg), "utf8");
        return { signature: out?.signature ?? out, signed: msg };
      },
      signTransaction: async () => {
        throw new Error("This wallet connection can't sign game transactions; log in with a wallet from the list that supports Wallet Standard.");
      },
    };
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
      const { signature, signed } = await conn.sign(message);
      setBusy("Checking signature…");
      const s = await api("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ wallet: conn.address, message: signed, signature: b64(new Uint8Array(signature)) }),
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

  // Signs a serialized transaction with the logged-in wallet. A resumed
  // session has no live connection yet, so reconnect the remembered wallet.
  window.StockmonstersWallet = {
    async signTransaction(bytes, chain) {
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
      if (wallet && activeConn.address !== wallet)
        throw new Error(`Switch your wallet to ${short(wallet)}, the account you logged in with.`);
      return activeConn.signTransaction(bytes, chain);
    },
  };

  window.StockmonstersLogout = async () => {
    const token = window.StockmonstersSession?.token || store.get();
    store.clear();
    if (token) { try { await fetch((window.STOCKMONSTERS_SERVER || "") + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }); } catch {} }
    location.reload();
  };

  // ---- overlay -------------------------------------------------------------
  const TOKEN_CA = "JAZWKW1smaRGRPqK9K2P8r97Jjy2fYxcPH7fcJteXpww";
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
      <p class="sub">Connect a Solana wallet</p>
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
      hint.textContent = "No Solana wallet found in this browser. Install one, then reload:";
      for (const [name, url] of [["Phantom", "https://phantom.com/download"], ["Solflare", "https://solflare.com/download"], ["Backpack", "https://backpack.app/download"]]) {
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
