# Direct messages and gifting

Walk up to another player, press the action key, and a window opens with their
name in it. Type, they see it immediately, they can reply or block you. The same
window hands you their wallet address so your own wallet can send them coin or
an NFT.

```
src/modules/main/dm.ts        server: roster, proximity, blocks, rate limit
src/modules/main/dm.spec.ts   the rules above, against fake players
src/dm-ui.ts                  the client window
src/modules/main/player.ts    routes the actions and keeps the roster fresh
```

## Nothing is stored

There is no table, no file, no cache, no `localStorage`. A message is a socket
frame that is delivered and then forgotten. Close the window and the
conversation is gone; reload and it was never there.

This is a product decision, not an unfinished one. A private message log is the
single most sensitive thing a game like this could hold, and the only way to
promise it is not kept is to never write it.

**The window says so on screen, every time.** That line is load-bearing: a
window that looks like every other chat window will be assumed to have history,
and a player who assumes that will say something they would not otherwise say.
Do not remove it to save space.

The one consequence worth naming: a DM cannot be reported to a moderator after
the fact, because there is nothing to produce. The moderation model here is the
recipient's BLOCK button and the fact that you have to be standing next to
someone to say anything to them at all.

## The action key

The action key is `space`, and RPG-JS cannot route it for us: `onAction` only
fires for **events** the player is facing, and other players are not events.

So the client listens for the key itself and asks:

```
client                                     server
  space ──> processAction('dm:nearby') ──> dmNearby(player)
       <── 'dm:nearby-result' ──────────── closest player within 64px, or null
```

Two details that came out of real bugs:

- **The key is never swallowed.** `dm-ui.ts` does not `preventDefault`, and it
  stands down entirely when a text field, a `.rpg-ui-dialog`, the name modal,
  the character designer, the title screen or another `ui-kit` window owns the
  moment. Space still talks to NPCs and still types a space.
- **One send is not assumed to arrive.** `processAction` is dropped silently
  while the player cannot act — most often mid map-transfer — and the engine
  samples input per frame, so a short tap can be missed outright. `askNearby`
  sends up to five times over three seconds and then says *"the world is still
  catching up"* rather than leaving the key looking dead. `dm:gift-info` retries
  the same way, because asking for an address is a read.

  `dm:send` is deliberately **not** retried: a retry could double-post. The
  sender's own line only appears when the SERVER echoes it back, so a dropped
  send shows up as nothing appearing, never as a message you think landed.

## Proximity

`dmNearby(player)` returns the **closest other player on the same map within 64
pixels** — two tiles at 32px/tile, measured centre to centre — or `null`.

- One tile is too strict: the physics repulsion pushes two players standing on
  the same spot apart, and a one-tile rule then refuses a DM between two
  characters that are visibly touching.
- Three tiles starts to include people you are not actually with.

Every `dm:send` re-checks it. **A DM is a conversation between two people
standing together, not a whisper across the world.** Walk away and the next
message is refused with *"You have walked away from X. Stand next to them to
talk."*

That rule is the whole privacy and anti-spam model. To talk to someone you have
to be able to see them; to escape someone you can walk away. A cross-world
whisper would be an unmoderatable spam pipe within a day, and a stranger could
reach you from anywhere with no way to get out of range.

Proximity is computed **server-side, from the live roster**. A client never gets
to name its own conversation partner.

Note: the server's idea of where you are lags the client's own prediction — on
a loaded machine we measured the client at x=884 while the server still had 815.
That is normal, and the server's position is the one that counts.

## The roster

`addDmMember` is called from **`onConnected` AND `onJoinMap`**.

This is not belt and braces. The engine hands each room a **fresh** `RpgPlayer`
object, and `emit` on a stale one silently does nothing — it needs a current
map. A stale roster entry produces a message that looks delivered and reaches
nobody. `chat.ts` paid for this lesson; this file copies it. The DM roster has
a second reason: it reads *positions* off those objects, so a stale entry would
also place the player on the map they just left.

Positions are read at query time, never cached.

## Blocking

`dm:block` / `dm:unblock`, in memory only, for the life of the server process.
Nothing is written down.

Blocks are keyed by **wallet** where there is one, so a block survives the
blocked player reloading the page and coming back with a brand-new connection
id — which is exactly what someone does when they want to get around a block.
A player with no wallet can only be identified by their connection id, so a
block against them lasts only until they reload. That is weaker; it is also the
best that is available without an identity, and it is the same trade `chat.ts`
makes for its rate limit.

A block does four things:

1. The blocked player's messages are refused: *"X is not accepting messages from
   you."* Honest, but neutral — "they blocked you" is an invitation to go and
   ask why in person.
2. The **blocker** cannot send either. A block ends the conversation rather than
   making it one-way.
3. Neither is offered to the other by `dmNearby` any more, in **both**
   directions. Pressing the action key next to someone you blocked must not put
   their name back in front of you.
4. Gifting between the two is refused.

You can block someone who has already walked off or closed the tab — that is
precisely when you want the button — so `dm.ts` keeps a bounded table of the
identities it has seen this session, not only the ones currently connected.

## Rate limit

**One message every 2 seconds, charged to the wallet.** Repeating the same line
inside 15 seconds is refused separately.

Chat is 5 seconds because chat is a broadcast: one bad line costs the whole
server's attention. A DM reaches exactly one person, who is standing next to
you, and who has a one-click off switch. 5 seconds would make a real
back-and-forth unusable — an actual exchange is several short lines in a row —
so the limit only has to stop a firehose, not to moderate. 2 seconds caps a
scripted sender at 30 lines a minute against a single target who can end it.

Charged to the **wallet**, never the connection: the connection id is
regenerated on every page load, so a connection-keyed limit hands a fresh budget
to anyone who presses F5.

The checks run in this order — filter, name, recipient, block, distance, rate
limit — so that nothing which was going to be refused anyway spends your budget.
A blocked link costs you nothing.

## Filtering

DM text goes through the same `filterChat` as public chat: no links, no contract
addresses, no long base58/hex runs, with the same homoglyph and spacing evasion
handling. See `chat-filter.ts`.

The rules apply **more** in private, not less. A public shill is visible to
everyone and gets shouted down; the same message whispered to one person
standing next to a dock is a targeted scam with no witnesses.

## Gifting

`dmGiftInfo(player, { to })` returns **the recipient's wallet address**. That is
the entire server side of gifting.

```
SEND TOKEN  window.ethereum eth_sendTransaction { from, to: <their address>, value }
SEND NFT    window.ethereum eth_sendTransaction { from, to: <NFT contract>,
                                                  data: safeTransferFrom(from,to,tokenId) }
```

**The server never moves value.** It holds no key that can spend a player's
funds, signs no transfer, and never learns whether one happened. It hands over
an address; the player's own wallet builds, signs and pays. If the transfer
fails, succeeds, or is never sent, this server does not know and does not care.

Which also means: **the game does not tell the recipient.** Nothing watches the
chain. The sender's window says so — *"tell them yourself"* — rather than
implying a notification that does not exist.

### This discloses an address

`dmGiftInfo` gives your wallet address to somebody standing next to you. There
is no way around that: you cannot be sent anything at an address the sender is
not told.

Stating it plainly rather than burying it:

- The address is handed over **only when a gift is actually being started**, not
  as part of the roster and not in `dm:nearby-result`. What `dmNearby` returns
  is a boolean `hasWallet`, so the window can grey out the buttons without
  leaking anything.
- Both sides must have a connected wallet, must be within 64px of each other,
  and must not have blocked each other.
- On a public chain the address is public anyway; what this links is the address
  to *this character, here, now*. Anyone who can already see you standing there
  is the only person who can obtain it.

If that trade is unacceptable for a given player, the answer is not to press
SEND TOKEN — and, if someone keeps asking, to press BLOCK.

### The NFT selector

`safeTransferFrom(address,address,uint256)` = `0x42842e0e`, hand-encoded in
`dm-ui.ts` exactly as `box-shop.ts` encodes `mintCaught` and `open`, and for the
same reason: viem is a server dependency and is not worth ~60 KB of browser
bundle for one three-word static call.

Verified against the compiled artifact:

```
contracts/out/StockmonstersNFT.sol/StockmonstersNFT.json
  methodIdentifiers["safeTransferFrom(address,address,uint256)"] = 42842e0e
```

Beware the overload: `safeTransferFrom(address,address,uint256,bytes)` is
`0xb88d4fde`. This is the three-argument one.

The contract address comes from `POST /box/quote` — the same source the box shop
uses — so there is one place that knows it. **If no contract is configured the
window says so** and does not open the wallet, rather than sending calldata to
nowhere.

### Both gifts confirm twice

Amount (or token id), recipient name, recipient address and your own address are
restated in full, with *"this happens on chain and cannot be undone — there is
no refund and no take-backs"* in words. The button then arms into an explicit
`YES — SEND 0.05 ETH` / `YES — GIFT #1234` before `window.ethereum` is touched
at all.

## Wire protocol

Client → server (`engine.processAction`):

| action          | data              | reply |
|-----------------|-------------------|-------|
| `dm:nearby`     | `{}`              | `dm:nearby-result` |
| `dm:send`       | `{ to, text }`    | `dm:message` to both sides, or `dm:system` |
| `dm:block`      | `{ id }`          | `dm:blocked` |
| `dm:unblock`    | `{ id }`          | `dm:blocked` |
| `dm:gift-info`  | `{ id }`          | `dm:gift-result` |

Server → client (`player.emit`):

| event              | payload |
|--------------------|---------|
| `dm:nearby-result` | `{ peer: { id, name, hasWallet } \| null, reason }` |
| `dm:message`       | `{ peer: { id, name }, from, text, mine, at }` |
| `dm:system`        | `{ text, peer: { id, name } \| null }` |
| `dm:blocked`       | `{ id, name, blocked }` |
| `dm:gift-result`   | `{ id, name, address }` or `{ error }` |

`dm:message` is sent to **both** sides with a payload each: each side is told
who the *other* person is, so the client never needs to know its own player id
to file a line into the right conversation.

## Mounting the client

```ts
import { mountDmUi, openDmWith } from './dm-ui'

mountDmUi(engine, socket)   // once, from game-ui.ts
openDmWith(playerId)        // optional: open it from elsewhere (a profile card…)
```

The window is a sibling of `marketplace.ts` and `box-shop.ts` — same
`ensureUiKit`, `el`, `guardKeys`, `pushLayer`, `watchGameDialog`,
`makeDraggable`, same `THEME`, same `Z` budget. It sits at `Z.marketWindow`
(960), below the RPG-JS dialog layer, and hides itself while a dialog is up.

## Tests

`npx vitest run` — `src/modules/main/dm.spec.ts` drives fake players (the shape
`chat.spec.ts` uses): the 64px boundary exactly, diagonal distance, refusing a
DM once the two have walked apart or changed map, blocks in both directions and
across a reload, the wallet-keyed rate limit, filtered text, and `dmGiftInfo`
refusing when either side has no wallet.

The end-to-end proof is two real browsers with two real wallets against a
production `server.mjs`: both enter the world, one presses the action key, and
the message is asserted in the **other** browser's DOM — the only check an
optimistic client echo cannot fake. It also walks one player away until the
server itself refuses on distance, and blocks from the other side.
