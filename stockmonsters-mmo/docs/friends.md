# Friends

Type someone's name, they get an ask, and **nothing happens until they press
ACCEPT**. Once they have, you can see when they are online and message them from
anywhere in the world.

```
db/migrations/0004_friends.sql   the two tables
profiles.mjs                     the SQL (Node only)
src/modules/main/friends.ts      server: requests, roster, presence, the gate
src/modules/main/friends.spec.ts the rules above, against fake players
src/friends-ui.ts                the panel on the left edge
src/modules/main/player.ts       routes the actions, keeps the roster fresh
test/friends.test.mjs            the SQL against real Postgres
tools/e2e-friends.mjs            two browsers, two wallets, real clicks
```

## Acceptance is the whole feature

`dm.ts` refuses any message between two players who are not standing next to
each other (`NEAR_PX`, 64px). A friendship is the one exception — and it is an
exception the recipient granted themselves.

That gate lives on the server. The client never says whether two people are
friends; it asks, renders the answer, and a client that claims otherwise is
ignored. `dm.ts` calls `areFriends()` **on every single message**, so removing a
friend cuts the line immediately — an open window is not a channel that outlives
the friendship.

Gifting works the same way: a friend can send tokens or an NFT from anywhere, a
stranger has to be standing next to you.

## What is stored, and where

Friendships are **relational rows, not part of the save blob**. A friendship
belongs to two players at once; half of it written by one player's flush is not
a friendship.

`friend_requests` is directed and temporary — a sender, a receiver, and it stops
existing the moment it is answered. `friendships` is undirected and permanent
until someone removes it: **one row per pair, ever**, guaranteed by storing the
two wallet ids in canonical order (`wallet_lo < wallet_hi`) as the primary key.
Without that ordering, `(a,b)` and `(b,a)` are two different keys, and a
double-accept — two sockets, two clicks, one race — leaves a pair that is
friends twice and un-friends once.

Everything is keyed by **wallet id**, the same identity chat, names and saves
use. So a friendship survives a reload, a different browser and a different
device. A player with no wallet cannot have friends, and the panel says why.

### Two requests that cross

If you ask someone who has already asked you, you are simply friends. Both
players have said yes; making them wait for a click that adds no information
reads as a bug.

### Without a database

`friends.ts` falls back to a session-only store, so the feature works in dev
(vite runs the server inside the page — there is no Postgres). The client is
told `persistent: false` and **the panel says so on screen**. A feature that
quietly forgets everything on restart reads as broken.

If the database is configured but unreachable, nothing falls back silently: the
player is told friends are unavailable. An empty list would look like everyone
had unfriended them.

## Presence

The panel shows a green pip for online friends and a MESSAGE button next to
them; offline friends stay in the list, greyed.

Presence is pushed as a **patch** (`friends:presence`), not a fresh list, so one
player logging in does not cost a database read for every friend they have.

**A map transfer looks exactly like leaving.** The engine reconnects the socket
and builds a fresh `RpgPlayer` for the new room, so acting on a disconnect
immediately would tell every friend you went offline and came back each time you
walked through a door. Leaving therefore *schedules* the goodbye and arriving
cancels it.

### `onDisconnected` does not exist

RPG-JS beta.33 documents an `onDisconnected` player hook and **never calls it**.
The engine dispatches `server-player-onConnected`, `-onJoinMap` and
`-onLeaveMap`, and nothing else. Verified by instrumenting the hook and closing a
real browser: it did not fire.

Everything that hung off it was dead code — the chat roster, the DM roster, and
the final profile save on exit. `player.ts` now detects leaving from
`onLeaveMap` with the delay described above. If a later version starts calling
`onDisconnected`, it is still wired, and both firing is harmless.

## Limits

| | |
|---|---|
| friends | 200 |
| requests waiting for an answer | 30 |
| new requests | one every 2 seconds, charged to the wallet |
| a declined request | cannot be re-sent for the rest of the server's session |

The decline rule matters: without it, DECLINE is a two-second speed bump. It is
held in memory, so it lasts until the server restarts rather than forever —
there is no "blocked forever" list, and adding one is a product decision, not a
patch.

Names are resolved exactly (case-insensitively). An unknown name gets the same
answer whether it is free or belongs to someone who has never played, so this
cannot be used to enumerate which names exist.

## The panel

Left edge, always-visible tab, collapsed by default. The tab carries the number
of requests waiting for an answer: a friend request that only appears in a panel
you happened to have open is a request that never arrives.

It is deliberately **not** a modal. You can walk with it open, and it does not
join the ui-kit escape stack — doing so would disable the space-to-talk key
while it was up. Escape closes it, and is consumed so it does not also open the
game menu behind it.

One thing the panel gets right that is easy to get wrong: the **add-by-name
field is built once and moved**, never rebuilt. `render()` runs whenever the
server pushes anything, and rebuilding the field would wipe a half-typed name
and drop the caret, so ADD would send nothing. Found by driving it in a real
browser — a presence update landed between the typing and the click.

## Running the tests

```bash
npx vitest run src/modules/main/friends.spec.ts   # rules, no database
npm run test:friends                              # the SQL, real Postgres
npm run test:e2e:friends                          # two browsers, real clicks
```

The end-to-end run is the one that matters. It signs two wallets in, walks one
player away from the other, proves a DM is refused, adds a friend by name,
proves nothing happened until ACCEPT, sends a message across the map, closes a
tab and watches the row go offline, then reloads and finds the friend still
there.
