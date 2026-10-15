// Stockmonsters Online browser bridge.
// Finds the game's NetPlay mailbox inside the emulator's wasm memory, publishes
// the local player to the server, writes nearby players back into the mailbox
// (the ROM spawns them as overworld NPCs), draws name tags, and runs trades.
// The mailbox layout mirrors stockred/include/netplay.h; change both together.
(() => {
  const MAGIC = [0x53, 0x4d, 0x4e, 0x45, 0x54, 0x76, 0x31, 0x00]; // "SMNETv1\0"
  const VERSION = 2;
  const MAILBOX_SIZE = 0x200;
  const MAX_REMOTES = 8;
  const REMOTE_BASE = 0x28, REMOTE_SIZE = 12;
  const SCREEN_BASE = 0x88, SCREEN_SIZE = 8;
  const MON_SIZE = 100;
  const OFF = { frame: 0x08, gfx: 0x0d, g: 0x0e, n: 0x0f, x: 0x10, y: 0x12, f: 0x14, e: 0x15,
                gender: 0x16, version: 0x17, name: 0x18, heartbeat: 0x24,
                mailboxAddr: 0xc8, partyAddr: 0xcc, partyCount: 0xd0, interactSeq: 0xd1,
                interactSlot: 0xd2, ackSeq: 0xd3, result: 0xd4, hometown: 0xd5, command: 0xd8 };
  const CMD_TRADE_REPLACE = 1, CMD_GIVE = 2, CMD_REMOVE = 3;
  const RES = { OK: 1, SLOT_CHANGED: 2, BAD: 3, NO_ROOM: 4, LAST_MON: 5, NOT_FOUND: 6 };
  const RESULT = { 1: "ok", 2: "your party changed", 3: "the game rejected it", 4: "your party and PC are full",
                   5: "it's your only monster", 6: "it isn't in your game" };
  const GBA_W = 240, GBA_H = 160;

  // ---- emulator memory -----------------------------------------------------
  function emuBuffer() {
    const M = window.EJS_emulator?.gameManager?.Module ?? window.Module;
    if (!M) return null;
    return (M.HEAPU8?.buffer) || M.wasmMemory?.buffer || M.asm?.memory?.buffer
        || M.wasmExports?.memory?.buffer || null;
  }
  const view = () => { const b = emuBuffer(); return b ? new DataView(b) : null; };

  // Every match of the magic; the ROM never contains it, but rewind or
  // savestate buffers can hold stale RAM copies, so callers pick the live one.
  function scanForMagic(bytes) {
    const hits = [];
    let i = 0;
    while ((i = bytes.indexOf(MAGIC[0], i)) !== -1) {
      let ok = true;
      for (let k = 1; k < MAGIC.length; k++) if (bytes[i + k] !== MAGIC[k]) { ok = false; break; }
      if (ok && (i & 3) === 0) hits.push(i);
      i++;
    }
    return hits;
  }

  let base = -1;           // byte offset of the live mailbox in wasm memory
  let candidates = [];     // [{ off, frame }] awaiting a liveness check
  let lastScanAt = 0;

  function locate() {
    // A full scan walks the whole wasm heap (hundreds of MB): at most once a second.
    if (!candidates.length && performance.now() - lastScanAt < 1000) return;
    lastScanAt = performance.now();
    const dv = view();
    if (!dv) return status("waiting for emulator");
    if (!candidates.length) {
      candidates = scanForMagic(new Uint8Array(dv.buffer)).map((off) => ({ off, frame: dv.getUint32(off + OFF.frame, true) }));
      if (!candidates.length) status("waiting for overworld");
      return;
    }
    // Second pass: the live copy is the one whose frame counter moved.
    const live = candidates.find((c) => dv.getUint32(c.off + OFF.frame, true) !== c.frame);
    candidates = [];
    if (!live) return;
    if (dv.getUint8(live.off + OFF.version) !== VERSION) return status("ROM and player are different versions");
    base = live.off;
    lastInteractSeq = dv.getUint8(base + OFF.interactSeq);
    status("linked");
  }

  // GBA address -> offset in wasm memory. Valid for EWRAM, where both the
  // mailbox and the party live.
  const gbaToHeap = (dv, addr) => base + (addr - dv.getUint32(base + OFF.mailboxAddr, true));

  // ---- game charset (pokefirered charmap.txt, the parts names use) ---------
  function decodeText(dv, off, len) {
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = dv.getUint8(off + i);
      if (c === 0xff) break;
      if (c >= 0xbb && c <= 0xd4) s += String.fromCharCode(65 + c - 0xbb);
      else if (c >= 0xd5 && c <= 0xee) s += String.fromCharCode(97 + c - 0xd5);
      else if (c >= 0xa1 && c <= 0xaa) s += String.fromCharCode(48 + c - 0xa1);
      else if (c === 0x00) s += " ";
      else if (c === 0xad) s += ".";
      else if (c === 0xae) s += "-";
    }
    return s.trim();
  }

  function readLocal(dv) {
    const b = base;
    return {
      frame: dv.getUint32(b + OFF.frame, true),
      gfx: dv.getUint8(b + OFF.gfx), g: dv.getUint8(b + OFF.g), n: dv.getUint8(b + OFF.n),
      x: dv.getInt16(b + OFF.x, true), y: dv.getInt16(b + OFF.y, true),
      f: dv.getUint8(b + OFF.f), e: dv.getUint8(b + OFF.e),
      gender: dv.getUint8(b + OFF.gender), name: decodeText(dv, b + OFF.name, 8) || "TRAINER",
      hometown: dv.getUint8(b + OFF.hometown),
    };
  }

  // Party slots as { slot, nickname, level, personality, hex }. Nickname and
  // level sit outside the encrypted block; the server decodes the rest.
  function readParty(dv) {
    const count = Math.min(6, dv.getUint8(base + OFF.partyCount));
    const at = gbaToHeap(dv, dv.getUint32(base + OFF.partyAddr, true));
    const party = [];
    for (let s = 0; s < count; s++) {
      const o = at + s * MON_SIZE;
      const bytes = new Uint8Array(dv.buffer, o, MON_SIZE);
      party.push({
        slot: s,
        personality: dv.getUint32(o, true),
        // Same identity the server uses: personality + OT id, as 16 hex digits.
        key: dv.getUint32(o, true).toString(16).padStart(8, "0") + dv.getUint32(o + 4, true).toString(16).padStart(8, "0"),
        nickname: decodeText(dv, o + 8, 10),
        level: dv.getUint8(o + 84),
        isEgg: (dv.getUint8(o + 19) & 0b100) !== 0,
        hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
      });
    }
    return party;
  }

  // ---- remote players ------------------------------------------------------
  const others = new Map();   // id -> player from the server
  const slotOf = new Map();   // id -> mailbox slot, kept stable so NPCs don't swap
  let myId = null;

  function assignSlots(me) {
    const here = [...others.values()]
      .filter((p) => p.g === me.g && p.n === me.n)
      .sort((a, b) => (Math.abs(a.x - me.x) + Math.abs(a.y - me.y)) - (Math.abs(b.x - me.x) + Math.abs(b.y - me.y)))
      .slice(0, MAX_REMOTES);
    const keep = new Set(here.map((p) => p.id));
    for (const id of [...slotOf.keys()]) if (!keep.has(id)) slotOf.delete(id);
    const used = new Set(slotOf.values());
    for (const p of here) {
      if (slotOf.has(p.id)) continue;
      for (let s = 0; s < MAX_REMOTES; s++) if (!used.has(s)) { slotOf.set(p.id, s); used.add(s); break; }
    }
  }
  const idInSlot = (slot) => { for (const [id, s] of slotOf) if (s === slot) return id; return null; };

  function writeRemotes(dv) {
    for (let s = 0; s < MAX_REMOTES; s++) {
      const o = base + REMOTE_BASE + s * REMOTE_SIZE, p = others.get(idInSlot(s));
      if (!p) { dv.setUint8(o, 0); continue; }
      dv.setUint8(o + 1, p.gfx); dv.setUint8(o + 2, p.g); dv.setUint8(o + 3, p.n);
      dv.setInt16(o + 4, p.x, true); dv.setInt16(o + 6, p.y, true);
      dv.setUint8(o + 8, p.f); dv.setUint8(o + 9, p.e);
      dv.setUint8(o, 1); // active last, so the game never sees a half-written slot as live
    }
  }

  // ---- name tags -----------------------------------------------------------
  const tagLayer = document.createElement("div");
  tagLayer.id = "np-tags";
  document.body.appendChild(tagLayer);
  const tags = [];
  for (let s = 0; s < MAX_REMOTES; s++) {
    const t = document.createElement("div");
    t.className = "np-tag";
    tagLayer.appendChild(t);
    tags.push(t);
  }

  // Where the 240x160 picture actually sits: EmulatorJS letterboxes it inside its canvas.
  function gameRect() {
    const c = document.querySelector("#game canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const scale = Math.min(r.width / GBA_W, r.height / GBA_H);
    return { left: r.left + (r.width - GBA_W * scale) / 2, top: r.top + (r.height - GBA_H * scale) / 2, scale };
  }

  function drawTags(dv) {
    const rect = gameRect();
    for (let s = 0; s < MAX_REMOTES; s++) {
      const o = base + SCREEN_BASE + s * SCREEN_SIZE, p = others.get(idInSlot(s)), tag = tags[s];
      const x = dv.getInt16(o, true), y = dv.getInt16(o + 2, true);
      const show = rect && p && dv.getUint8(o + 4) && x >= 0 && x < GBA_W && y > -16 && y < GBA_H;
      tag.hidden = !show;
      if (!show) continue;
      if (tag.textContent !== p.name) tag.textContent = p.name;
      tag.style.transform = `translate(${rect.left + x * rect.scale}px, ${rect.top + y * rect.scale}px) translate(-50%, -110%)`;
      tag.style.fontSize = `${Math.max(10, Math.round(rect.scale * 5))}px`;
    }
  }
  const hideTags = () => tags.forEach((t) => (t.hidden = true));

  // ---- network -------------------------------------------------------------
  let ws = null, lastSent = "", lastSentAt = 0, helloName = "";
  const sendMsg = (m) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const SERVER = window.STOCKMONSTERS_SERVER || ""; // "" = same origin
  const session = () => window.StockmonstersSession;
  // login.js sets the session; nothing connects without one.
  const whenSession = () => new Promise((resolve) => {
    if (session()) return resolve(session());
    window.addEventListener("stockmonsters:session", () => resolve(session()), { once: true });
  });
  function hello(name, gender) {
    sendMsg({ t: "hello", token: session()?.token, name, gender });
  }
  // Keep the stored profile in step with the save: name, gender, and the
  // hometown (write-once on the server, so a new save can't change it).
  let savedProfile = "";
  const isHometown = (m) => (m >= 88 && m <= 96) || m === 98;
  function saveProfile(name, gender, hometown) {
    const s = session(), key = `${name}|${gender}|${hometown}`;
    if (!s || key === savedProfile) return;
    const p = s.profile;
    const homeNew = isHometown(hometown) && p?.hometown == null;
    savedProfile = key;
    if (p && p.name === name && p.gender === gender && !homeNew) return;
    fetch(SERVER + "/profile", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ name, gender, ...(homeNew ? { hometown } : {}) }) })
      .then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.profile) s.profile = b.profile; }).catch(() => {});
  }

  function connect() {
    const url = SERVER
      ? SERVER.replace(/^http/, "ws") + "/ws"
      : (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    ws = new WebSocket(url);
    ws.onopen = () => {
      helloName = "";
      const p = session()?.profile;
      hello(p?.name || "TRAINER", p?.gender ?? 0); // authenticate now, even before the game is linked
      status(base >= 0 ? "linked" : "connected");
    };
    ws.onclose = () => { others.clear(); slotOf.clear(); trade.reset(); if (!authFailed) status("offline, retrying"); setTimeout(connect, 2000); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "welcome") myId = m.id;
      else if (m.t === "auth") { if (!m.ok) { authFailed = true; status("login expired, log out and back in"); } }
      else if (m.t === "snapshot") { others.clear(); for (const p of m.players) others.set(p.id, p); }
      else if (m.t === "pos" && m.id !== myId) others.set(m.id, m);
      else if (m.t === "leave") others.delete(m.id);
      else if (m.t === "chat") chatLine(m.name + (m.scope === "map" ? " (here)" : ""), m.text);
      else if (m.t.startsWith("trade_")) trade.onMessage(m);
      else if (m.t.startsWith("battle_") || m.t.startsWith("link_")) battle.onMessage(m);
      hud();
    };
  }

  function sendLocal(me) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (me.name !== helloName) { helloName = me.name; hello(me.name, me.gender); }
    saveProfile(me.name, me.gender, me.hometown);
    const key = `${me.g}.${me.n}.${me.x}.${me.y}.${me.f}.${me.e}.${me.gfx}`;
    const now = performance.now();
    if (key === lastSent && now - lastSentAt < 2000) return; // resend every 2s as keepalive
    lastSent = key; lastSentAt = now;
    sendMsg({ t: "pos", g: me.g, n: me.n, x: me.x, y: me.y, f: me.f, e: me.e, gfx: me.gfx });
  }

  // ---- game commands -------------------------------------------------------
  // One command in flight at a time (trades, NFT deliveries and removals share
  // the slot), so they queue. The game runs each on its next overworld frame
  // and echoes seq into ackSeq; it waits while a menu or battle is open.
  let pendingCommand = null; // { seq, resolve }
  let commandChain = Promise.resolve();

  function submitCommand(type, slot, expectPersonality, monHex) {
    const issue = () => new Promise((resolve) => {
      const attempt = () => {
        const dv = view();
        if (!dv || base < 0 || pendingCommand) return setTimeout(attempt, 250);
        const c = base + OFF.command;
        const seq = (dv.getUint8(base + OFF.ackSeq) + 1) & 0xff;
        dv.setUint8(c + 1, type);
        dv.setUint8(c + 2, slot);
        dv.setUint32(c + 4, expectPersonality >>> 0, true);
        for (let i = 0; i < MON_SIZE; i++) dv.setUint8(c + 8 + i, parseInt(monHex.substr(i * 2, 2), 16));
        dv.setUint8(c, seq); // seq last: the game only acts once it changes
        pendingCommand = { seq, resolve };
      };
      attempt();
    });
    const run = commandChain.then(issue);
    commandChain = run.catch(() => {});
    return run;
  }

  function pollCommand(dv) {
    if (!pendingCommand || dv.getUint8(base + OFF.ackSeq) !== pendingCommand.seq) return;
    const result = dv.getUint8(base + OFF.result);
    pendingCommand.resolve(result);
    pendingCommand = null;
  }

  // ---- trading -------------------------------------------------------------
  const trade = (() => {
    let partner = null;    // { id, name } while a trade window is open
    let incoming = null;   // { from, name } request awaiting our answer
    let state = null;      // last trade_update
    let party = [];
    let lastRequestAt = -Infinity;
    let signing = false;   // waiting on this wallet to sign the NFT swap

    const el = document.createElement("div");
    el.id = "np-trade";
    el.hidden = true;
    document.body.appendChild(el);

    function button(label, onClick, cls = "") {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.className = cls;
      b.addEventListener("click", onClick);
      return b;
    }
    const monLine = (m) => m ? `${m.nickname || m.speciesName} · Lv ${m.level}` + (m.nickname && m.nickname !== m.speciesName ? ` (${m.speciesName})` : "") : "nothing yet";

    function render() {
      el.replaceChildren();
      if (incoming && !partner) {
        el.hidden = false;
        const h = document.createElement("h3"); h.textContent = `${incoming.name} wants to trade`;
        const row = document.createElement("div"); row.className = "np-row";
        row.append(button("Accept", () => answer(true), "primary"), button("Decline", () => answer(false)));
        el.append(h, row);
        return;
      }
      if (!partner) { el.hidden = true; return; }
      el.hidden = false;
      const h = document.createElement("h3"); h.textContent = `Trading with ${partner.name}`;
      const list = document.createElement("div"); list.className = "np-party";
      for (const mon of party) {
        const b = button(`${mon.nickname} · Lv ${mon.level}`, () => offer(mon), state?.mine?.slot === mon.slot ? "picked" : "");
        b.disabled = mon.isEgg || state?.iConfirmed;
        list.appendChild(b);
      }
      const mine = document.createElement("p"); mine.innerHTML = "<b>You give:</b> ";
      mine.append(monLine(state?.mine));
      const theirs = document.createElement("p"); theirs.innerHTML = "<b>You get:</b> ";
      theirs.append(monLine(state?.theirs));
      const flags = document.createElement("p"); flags.className = "np-muted";
      flags.textContent = signing ? "Approve the NFT swap in your wallet…"
        : state?.theyConfirmed && state?.iConfirmed ? "Swapping the NFTs…"
        : state?.theyConfirmed ? `${partner.name} confirmed.` : state?.iConfirmed ? `Waiting for ${partner.name}…` : "Pick a monster, then confirm.";
      const row = document.createElement("div"); row.className = "np-row";
      const confirm = button("Confirm trade", () => sendMsg({ t: "trade_confirm" }), "primary");
      confirm.disabled = !state?.mine || !state?.theirs || state?.iConfirmed;
      row.append(confirm, button("Cancel", () => sendMsg({ t: "trade_cancel" })));
      el.append(h, list, mine, theirs, flags, row);
    }

    function offer(mon) {
      sendMsg({ t: "trade_offer", slot: mon.slot, mon: mon.hex });
    }
    function answer(accept) {
      sendMsg({ t: "trade_respond", from: incoming.from, accept });
      incoming = null;
      render();
    }
    function refreshParty() {
      const dv = view();
      if (dv && base >= 0) party = readParty(dv);
    }

    // Both wallets sign one transaction that swaps the two NFTs.
    async function signSwap(m) {
      signing = true;
      render();
      try {
        const bytes = Uint8Array.from(atob(m.tx), (c) => c.charCodeAt(0));
        const chainId = m.cluster === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
        const signed = new Uint8Array(await window.StockmonstersWallet.signTransaction(bytes, chainId));
        let b = ""; for (const x of signed) b += String.fromCharCode(x);
        sendMsg({ t: "trade_signed", tx: btoa(b) });
      } catch (e) {
        chatLine("Trade", e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || "") ? "You declined the NFT swap." : e?.message || String(e));
        sendMsg({ t: "trade_cancel" });
      } finally {
        signing = false;
        render();
      }
    }

    async function execute(m) {
      const dv = view();
      if (!dv || base < 0) return sendMsg({ t: "trade_result", ok: false });
      chatLine("Trade", "Swapping… stay on the overworld for a moment.");
      const result = await submitCommand(CMD_TRADE_REPLACE, m.giveSlot, m.givePersonality, m.receive);
      sendMsg({ t: "trade_result", ok: result === 1 });
      if (result !== 1) chatLine("Trade", `Your game refused the swap: ${RESULT[result] ?? "unknown error"}.`);
    }

    return {
      reset() { partner = null; incoming = null; state = null; signing = false; render(); },
      request(id) {
        // Mashing A on a player would otherwise send a request per press.
        if (!others.has(id) || partner || incoming || performance.now() - lastRequestAt < 3000) return;
        lastRequestAt = performance.now();
        sendMsg({ t: "trade_request", to: id });
      },
      onMessage(m) {
        switch (m.t) {
          case "trade_request": incoming = { from: m.from, name: m.name }; break;
          case "trade_pending": chatLine("Trade", `Asked ${m.name} to trade…`); break;
          case "trade_open": partner = m.partner; state = null; refreshParty(); break;
          case "trade_update": state = m; refreshParty(); break;
          case "trade_sign": signSwap(m); break;
          case "trade_exec": execute(m); break;
          case "trade_error": chatLine("Trade", m.reason); break;
          case "trade_closed":
            chatLine("Trade", m.reason === "complete" ? `Trade with ${partner?.name ?? "partner"} complete!` : m.reason);
            partner = null; state = null; break;
        }
        render();
      },
    };
  })();

  // ---- PvP battles ---------------------------------------------------------
  // The game runs FireRed's own link battle; this pump is the "cable": it
  // carries link blocks and standby barriers between the game's buffers
  // (mailbox.link, see stockred/include/netplay.h) and the server.
  const LINK = { active: 0x144, myId: 0x145, sendSeq: 0x146, sendAck: 0x147, sendSize: 0x148, recvSeq: 0x14a,
                 recvAck: 0x14b, recvBusy: 0x14c, standbySeq: 0x14d, partnerStandby: 0x14e, partnerLost: 0x14f,
                 outcome: 0x150, outcomeSeq: 0x151, sendBufAddr: 0x154, recvBufAddr: 0x158 };
  const CMD_START_BATTLE = 4;
  const OUTCOMES = { 1: "You won!", 2: "You lost.", 3: "It's a draw." };

  const battle = (() => {
    let incoming = null;          // { from, name } challenge awaiting an answer
    let session = null;           // { linkId, partner, inbox: [], lastStandby, outcomeSeq, ended }
    let pump = null;

    const el = document.createElement("div");
    el.id = "np-battle";
    el.className = "np-panel";
    el.hidden = true;
    document.body.appendChild(el);

    function render() {
      el.replaceChildren();
      if (!incoming) { el.hidden = true; return; }
      el.hidden = false;
      const h = document.createElement("h3");
      h.textContent = `${incoming.name} challenges you to a battle!`;
      const p = document.createElement("p");
      p.className = "np-muted";
      p.textContent = "Your party is restored afterwards: no HP, PP or items are lost.";
      const row = document.createElement("div");
      row.className = "np-row";
      const yes = document.createElement("button"); yes.type = "button"; yes.className = "primary"; yes.textContent = "Battle!";
      const no = document.createElement("button"); no.type = "button"; no.textContent = "Not now";
      yes.onclick = () => answer(true);
      no.onclick = () => answer(false);
      row.append(yes, no);
      el.append(h, p, row);
    }
    function answer(accept) {
      sendMsg({ t: "battle_respond", from: incoming.from, accept });
      incoming = null;
      render();
    }

    const b64 = (u) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    function start(m) {
      session = { linkId: m.linkId, partner: m.partner, inbox: [], partnerStandby: 0, lastStandby: -1, outcomeSeq: -1, ended: false, started: false };
      chatLine("Battle", `Battle with ${m.partner.name} starting…`);
      const zero = "00".repeat(MON_SIZE);
      submitCommand(CMD_START_BATTLE, m.linkId, 0, zero).then((res) => {
        if (res !== RES.OK) { chatLine("Battle", "Your game couldn't start the battle."); finish("ended"); }
        else session && (session.started = true);
      });
      clearInterval(pump);
      pump = setInterval(step, 8);
    }

    function finish() {
      clearInterval(pump);
      pump = null;
      session = null;
    }

    // One pass of the cable: out-blocks, in-blocks, barriers, the result.
    function step() {
      const dv = view();
      if (!session || !dv || base < 0) return;
      const L = (k) => base + LINK[k];
      if (!dv.getUint8(L("active"))) {
        // Not started yet, or the game finished and closed the link.
        if (session.started && session.outcomeSeq >= 0) finish();
        return;
      }
      const toHeap = (addr) => base + (addr - dv.getUint32(base + OFF.mailboxAddr, true));

      const sendSeq = dv.getUint8(L("sendSeq"));
      if (sendSeq !== dv.getUint8(L("sendAck"))) {
        const size = dv.getUint16(L("sendSize"), true);
        const at = toHeap(dv.getUint32(L("sendBufAddr"), true));
        sendMsg({ t: "link_block", data: b64(new Uint8Array(dv.buffer, at, size)) });
        dv.setUint8(L("sendAck"), sendSeq);
      }

      const standby = dv.getUint8(L("standbySeq"));
      if (standby !== session.lastStandby) {
        session.lastStandby = standby;
        if (standby) sendMsg({ t: "link_standby", n: standby });
      }
      dv.setUint8(L("partnerStandby"), session.partnerStandby);

      if (session.inbox.length && dv.getUint8(L("recvSeq")) === dv.getUint8(L("recvAck")) && !dv.getUint8(L("recvBusy"))) {
        const block = session.inbox.shift();
        const partner = session.linkId ^ 1;
        const at = toHeap(dv.getUint32(L("recvBufAddr"), true)) + partner * 0x100;
        new Uint8Array(dv.buffer, at, block.length).set(block);
        dv.setUint8(L("recvSeq"), (dv.getUint8(L("recvSeq")) + 1) & 0xff); // last: the game acts on it
      }

      const outcomeSeq = dv.getUint8(L("outcomeSeq"));
      if (outcomeSeq && outcomeSeq !== session.outcomeSeq) {
        session.outcomeSeq = outcomeSeq;
        sendMsg({ t: "battle_end", outcome: dv.getUint8(L("outcome")) });
      }
    }

    // The game writes the outcome as it closes the link; catch it even after.
    function reportOutcome() {
      const dv = view();
      if (!session || !dv || base < 0) return;
      const seq = dv.getUint8(base + LINK.outcomeSeq);
      if (seq && seq !== session.outcomeSeq) {
        session.outcomeSeq = seq;
        sendMsg({ t: "battle_end", outcome: dv.getUint8(base + LINK.outcome) });
        finish();
      }
    }

    return {
      request(id) {
        if (session || incoming) return;
        sendMsg({ t: "battle_request", to: id });
      },
      tick() { reportOutcome(); },
      onMessage(m) {
        switch (m.t) {
          case "battle_request": incoming = { from: m.from, name: m.name }; break;
          case "battle_pending": chatLine("Battle", `Challenged ${m.name}…`); break;
          case "battle_error": chatLine("Battle", m.reason); break;
          case "battle_start": start(m); break;
          case "link_block": session?.inbox.push(unb64(m.data)); break;
          case "link_standby": if (session) session.partnerStandby = m.n; break;
          case "link_lost": {
            const dv = view();
            if (dv && base >= 0) dv.setUint8(base + LINK.partnerLost, 1);
            chatLine("Battle", `${m.name} disconnected. The win is yours.`);
            break;
          }
          case "battle_over": chatLine("Battle", `${m.text} ${OUTCOMES[{ won: 1, lost: 2, drew: 3 }[m.outcome]] ?? ""}`); break;
        }
        render();
      },
    };
  })();

  // A on another player: trade or battle?
  const actions = (() => {
    const el = document.createElement("div");
    el.id = "np-actions";
    el.className = "np-panel";
    el.hidden = true;
    document.body.appendChild(el);
    function open(id) {
      const p = others.get(id);
      if (!p) return;
      el.replaceChildren();
      const h = document.createElement("h3");
      h.textContent = p.name;
      const row = document.createElement("div");
      row.className = "np-row";
      for (const [label, fn, cls] of [["Battle", () => battle.request(id), "primary"], ["Trade", () => trade.request(id), ""], ["Cancel", null, ""]]) {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.className = cls;
        b.onclick = () => { el.hidden = true; fn?.(); };
        row.appendChild(b);
      }
      el.append(h, row);
      el.hidden = false;
    }
    return { open };
  })();

  // Pressing A on a remote in-game bumps interactSeq.
  let lastInteractSeq = 0;
  function pollInteract(dv) {
    const seq = dv.getUint8(base + OFF.interactSeq);
    if (seq === lastInteractSeq) return;
    lastInteractSeq = seq;
    const id = idInSlot(dv.getUint8(base + OFF.interactSlot));
    if (id) actions.open(id);
  }

  // ---- NFTs ----------------------------------------------------------------
  // Every party monster is an NFT in the player's wallet. New monster -> mint;
  // level went up -> resync its traits. The server builds and co-signs each
  // transaction, the wallet signs as fee payer, the server sends it.
  const nft = (() => {
    let cfg = null, lastScan = 0, busy = false;
    const owned = new Map();   // key -> { asset, level }
    const wanted = new Map();  // key -> { kind, hex, level, name, declined, blocked }

    async function call(path, body) {
      const res = await fetch(SERVER + path, {
        method: body ? "POST" : "GET", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session()?.token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out.error || `server error ${res.status}`), { status: res.status });
      return out;
    }
    const b64ToBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const bytesToB64 = (u) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const chain = () => (cfg?.cluster === "mainnet-beta" ? "solana:mainnet" : "solana:devnet");

    async function init() {
      try {
        cfg = await (await fetch(SERVER + "/nft/config", { cache: "no-store" })).json();
        if (!cfg.enabled) return;
        await refresh();
        setInterval(refresh, 20_000);
      } catch (e) { console.warn("[nft]", e); cfg = null; }
    }

    // The NFT is the monster: whatever this wallet owns belongs in this game,
    // and anything it sold has to leave. The server tracks on-chain owners.
    const inFlight = new Set(), told = new Set();
    const once = (key, text) => { if (!told.has(key)) { told.add(key); chatLine("NFT", text); } };
    const removeHex = (otId) => {
      const b = new Uint8Array(MON_SIZE);
      new DataView(b.buffer).setUint32(4, otId >>> 0, true); // REMOVE reads the OT id from mon.box.otId
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    };

    async function refresh() {
      if (!cfg?.enabled) return;
      let inv;
      try { inv = await call("/nft/mine"); } catch (e) { return console.warn("[nft]", e); }
      owned.clear();
      for (const a of inv.assets) owned.set(a.key, a);

      for (const r of inv.revocations) {
        if (inFlight.has(r.key)) continue;
        inFlight.add(r.key);
        wanted.delete(r.key);
        submitCommand(CMD_REMOVE, 0, r.personality, removeHex(r.otId)).then(async (res) => {
          if (res === RES.OK || res === RES.NOT_FOUND) {
            await call("/nft/copy", { key: r.key, action: "removed" }).catch(() => {});
            if (res === RES.OK) chatLine("NFT", `${r.name}'s NFT left your wallet, so ${r.name} left your game.`);
          } else if (res === RES.LAST_MON) {
            once(`last:${r.key}`, `${r.name}'s NFT was sold. It leaves once you have another monster in your party.`);
          }
        }).finally(() => inFlight.delete(r.key));
      }

      for (const d of inv.deliveries) {
        if (inFlight.has(d.key)) continue;
        inFlight.add(d.key);
        submitCommand(CMD_GIVE, 0, 0, d.mon).then(async (res) => {
          if (res === RES.OK) {
            await call("/nft/copy", { key: d.key, action: "delivered" }).catch(() => {});
            chatLine("NFT", `${d.name} arrived! Its NFT is in your wallet, so it's in your game.`);
          } else if (res === RES.NO_ROOM) {
            once(`room:${d.key}`, `${d.name} is waiting for you, but your party and PC are full.`);
          }
        }).finally(() => inFlight.delete(d.key));
      }
    }

    function scan(dv) {
      if (!cfg?.enabled || performance.now() - lastScan < 1500) return;
      lastScan = performance.now();
      for (const mon of readParty(dv)) {
        if (mon.isEgg) continue;
        const have = owned.get(mon.key);
        const kind = !have ? "mint" : mon.level > have.level ? "sync" : null;
        const prev = wanted.get(mon.key);
        if (!kind) { wanted.delete(mon.key); continue; }
        // A decline sticks until the monster changes again (another level).
        if (prev && prev.kind === kind && prev.level === mon.level) { prev.hex = mon.hex; continue; }
        wanted.set(mon.key, { kind, hex: mon.hex, level: mon.level, name: mon.nickname, declined: false, blocked: false });
      }
      badge();
      run();
    }

    async function run() {
      if (busy) return;
      const next = [...wanted.entries()].find(([, w]) => !w.declined && !w.blocked);
      if (!next) return;
      const [key, w] = next;
      busy = true;
      try {
        status(w.kind === "mint" ? `minting ${w.name}` : `syncing ${w.name}`);
        const op = await call(w.kind === "mint" ? "/nft/prepare-mint" : "/nft/prepare-sync", { mon: w.hex });
        const signed = await window.StockmonstersWallet.signTransaction(b64ToBytes(op.tx), chain());
        const done = await call("/nft/submit", { opId: op.opId, tx: bytesToB64(new Uint8Array(signed)) });
        owned.set(key, { asset: done.asset, level: done.level });
        wanted.delete(key);
        chatLine("NFT", w.kind === "mint" ? `${w.name} is now an NFT in your wallet.` : `${w.name}'s NFT updated to Lv ${done.level}.`);
      } catch (e) {
        const msg = e?.message || String(e);
        if (e?.code === 4001 || /reject|denied|cancel|declin/i.test(msg)) w.declined = true;
        else if (e?.status === 409 || e?.status === 403 || e?.status === 400) { w.blocked = true; chatLine("NFT", `${w.name}: ${msg}`); }
        else { w.declined = true; chatLine("NFT", `${w.name}: ${msg}`); }
      } finally {
        busy = false;
        status(base >= 0 ? "linked" : "connected");
        badge();
        setTimeout(run, 500);
      }
    }

    // Declined requests wait here; one tap asks the wallet again.
    function badge() {
      const n = [...wanted.values()].filter((w) => w.declined).length;
      const b = $(".np-nft");
      b.hidden = n === 0;
      b.textContent = n === 1 ? "1 NFT to sign" : `${n} NFTs to sign`;
    }
    function retry() {
      for (const w of wanted.values()) w.declined = false;
      badge();
      run();
    }
    return { init, scan, retry };
  })();

  // ---- main loop -----------------------------------------------------------
  let heartbeat = 0, lastFrame = -1, frameStallAt = 0;

  function tick() {
    try {
      if (base < 0) { hideTags(); locate(); return; }
      const dv = view();
      if (!dv || base + MAILBOX_SIZE > dv.byteLength) { base = -1; return; }
      const me = readLocal(dv);
      if (me.frame !== lastFrame) { lastFrame = me.frame; frameStallAt = performance.now(); }
      const stalled = performance.now() - frameStallAt > 200;
      // Overworld frames stop during battles and menus; that's normal. A long
      // stall plus a missing magic means the game reset: search again.
      if (performance.now() - frameStallAt > 5000 && dv.getUint8(base) !== MAGIC[0]) { base = -1; return; }

      dv.setUint32(base + OFF.heartbeat, ++heartbeat >>> 0, true);
      sendLocal(me);
      assignSlots(me);
      writeRemotes(dv);
      pollInteract(dv);
      pollCommand(dv);
      battle.tick();
      if (stalled) hideTags(); else { drawTags(dv); nft.scan(dv); } // no wallet pop-ups mid-battle
      hudMap = `${me.g}.${me.n}`;
    } catch (err) {
      console.warn("[netplay]", err);
      base = -1;
    }
  }
  setInterval(tick, 1000 / 30);

  // ---- HUD + chat ----------------------------------------------------------
  const ui = document.createElement("div");
  ui.id = "netplay";
  ui.innerHTML = `
    <div class="np-bar">
      <div class="np-status"><span class="np-dot"></span><span class="np-text">starting</span></div>
      <span class="np-wallet"></span>
      <button type="button" class="np-nft" hidden></button>
      <button type="button" class="np-logout" hidden>Log out</button>
    </div>
    <div class="np-chat">
      <div class="np-log"></div>
      <form class="np-form"><input class="np-input" maxlength="120" placeholder="Press T to chat" autocomplete="off"></form>
    </div>`;
  document.body.appendChild(ui);
  const $ = (s) => ui.querySelector(s);
  let statusText = "starting", hudMap = "", authFailed = false;
  $(".np-logout").addEventListener("click", () => window.StockmonstersLogout?.());
  $(".np-nft").addEventListener("click", () => nft.retry());

  function status(t) { if (authFailed && !t.startsWith("login")) return; statusText = t; hud(); }
  function hud() {
    const here = [...others.values()].filter((p) => `${p.g}.${p.n}` === hudMap).length;
    $(".np-text").textContent = `${statusText} · ${here} here`;
    $(".np-dot").dataset.state = statusText === "linked" ? "ok" : "wait";
  }

  function chatLine(name, text) {
    const line = document.createElement("div");
    line.className = "np-line";
    const who = document.createElement("b");
    who.textContent = name;
    line.append(who, document.createTextNode(": " + text));
    const log = $(".np-log");
    log.appendChild(line);
    while (log.children.length > 50) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  const input = $(".np-input");
  // Keep typed keys away from the emulator's keyboard handler.
  for (const type of ["keydown", "keyup", "keypress"]) input.addEventListener(type, (e) => {
    e.stopPropagation();
    if (type === "keydown" && e.key === "Escape") input.blur();
  });
  $(".np-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (raw) {
      const local = raw.startsWith("/here ");
      sendMsg({ t: "chat", scope: local ? "map" : "global", text: local ? raw.slice(6) : raw });
    }
    input.value = "";
    input.blur();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "t" && document.activeElement !== input) { e.preventDefault(); e.stopPropagation(); input.focus(); }
  }, true);

  whenSession().then((s) => {
    const w = s.wallet;
    $(".np-wallet").textContent = w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
    $(".np-wallet").title = w;
    $(".np-logout").hidden = false;
    nft.init();
    connect();
  });
})();
