# Player persistence

Server-side saves keyed by wallet, in Postgres. This is what makes a caught
Stockmonster still be yours after a page reload, and after moving to another
computer.

---

## The problem it solves

RPG-JS keys room storage by the **transport connection id**. We deliberately
set `connectionIdScope: 'ephemeral'`, so that id is brand new on every page
load — reusing one left the socket able to receive but not send, and the player
could not move, chat or change character (HANDOVER, "Reload-kills-input
blocker").

That fix cost us persistence. With a throwaway id, nothing server-side was
keyed to a returning player:

- `PARTY`, `BOX` and `BAG` reset every session. Creatures you caught did not
  survive a reload — and `BOX` is the NFT mint queue, so that is real value
  evaporating.
- `CHARACTER` and `NAME` *appeared* to survive only because the **client**
  replayed them out of `localStorage` and re-sent them after connecting. That
  is forgeable with devtools, and it does not travel between devices.

The identity to key saves to already existed and was sound. `auth.mjs` verifies
a nonce-bound `personal_sign` and returns

```
connectionId = "w:" + HMAC-SHA256(SERVER_SECRET, lowercase address)   // 32 hex
```

Unforgeable without `SERVER_SECRET`, stable per wallet, and it keeps raw
addresses out of anything a client can type. The client presents it after
connecting via the `auth:wallet` action. That id — not the transport id — is
now the primary key of every save.

---

## Where each piece of player state lives now

| State | Before | Now | Authoritative? |
|---|---|---|---|
| `CHARACTER` (graphic id array) | `localStorage['sm-character']`, replayed to the server on every connect | `player_state.state.character` | **Server.** The client copy is a hint that loses every conflict. |
| `NAME` | `localStorage['sm-name']`, replayed | `players.name`, **globally unique** | **Server.** A rejected name comes back on the existing `name:rejected` path. |
| `PARTY` (`CreatureInstance[]`) | player variable, gone on reload | `player_state.state.party` | Server — it is the only copy. |
| `BOX` (caught creatures / mint queue) | player variable, gone on reload | `player_state.state.box` | Server — the only copy. |
| `BAG` (`{balls, potions}`) | player variable, gone on reload | `player_state.state.bag` | Server — the only copy. |
| `WALLET_ID` | player variable, per session | `players.wallet_id` (PK) | Server. |
| `WALLET_ADDRESS` | player variable, per session | `players.wallet_address` | Server. |
| `SPAWNED` | player variable | unchanged — still per session | Deliberate: it means "already placed on a map this connection". |
| map / x / y | `data/rooms.sqlite`, keyed by the ephemeral connection id | unchanged | **Not persisted per wallet yet** — see "Left undone". |

Two different stores now sit in this process and they are easy to confuse:

- **`data/rooms.sqlite`** is the *room's* storage. It is keyed by the ephemeral
  connection id, so it survives a server restart but not a page reload. It is
  the engine's, not ours.
- **Postgres** is the *player's* profile, keyed by wallet id. This is the one
  that follows a person around.

---

## Schema

`db/migrations/0001_players.sql`. Two tables, no ORM.

```sql
CREATE TABLE players (
    wallet_id      TEXT PRIMARY KEY CHECK (wallet_id ~ '^w:[0-9a-f]{32}$'),
    wallet_address TEXT CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-f]{40}$'),
    name           TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 3 AND 14),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX players_name_lower_key ON players (lower(name)) WHERE name IS NOT NULL;
CREATE INDEX players_wallet_address_idx ON players (wallet_address);

CREATE TABLE player_state (
    wallet_id  TEXT PRIMARY KEY REFERENCES players (wallet_id) ON DELETE CASCADE,
    version    INTEGER NOT NULL DEFAULT 1,
    state      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Decisions worth knowing:

- **The `wallet_id` CHECK is not decoration.** If a bug ever let a raw address
  through as an identity, saves would become forgeable by anyone who can type
  an address. The database refuses the shape outright.
- **Name uniqueness is enforced by the index, not by application code.** A
  read-then-write in Node loses the race between two sockets claiming the same
  name at the same moment — and will lose it far more often once there is more
  than one process. `claimName()` simply attempts the write and treats the
  `23505` unique violation as the answer. The index is on `lower(name)` so
  `Satoshi` and `satoshi` are the same claim; impersonation is the risk being
  managed. It is a *partial* index (`WHERE name IS NOT NULL`) so the hundreds of
  players who have not chosen a name yet do not all collide on `NULL`.
- **`state` is JSONB, on purpose.** `CreatureInstance` is still growing fields
  (status and IVs arrived this month), `BAG` is about to gain items, and the
  character array changes with every designer revision. Anything we need to
  *query* — leaderboards, "who owns this creature", the mint queue — gets a real
  column or its own table when that query exists. The blob is for state we only
  ever load and store whole.
- **`version`** is there so a future shape change can be migrated rather than
  guessed at. Read it before trusting the contents.
- **`last_seen_at` vs `updated_at`**: `last_seen_at` is a heartbeat touched on
  every login; `updated_at` only moves when something a human would call a
  change actually changed.

### Migration runner

`db/migrate.mjs` — plain `.sql` files applied in filename order, recorded in
`schema_migrations`. One transaction per file, a Postgres advisory lock so two
runners cannot race, and a checksum per file so **editing an already-applied
migration is an error** rather than a silent divergence between machines.

```
npm run db:migrate              # apply pending
npm run db:status               # show applied / pending
npm run db:migrate -- --reset   # dev only: drop the app tables and re-apply
```

### Migrating existing player data

**There is none, and that is not ambiguity — it is the finding.** Before this
change nothing durable existed to migrate:

- Room storage was keyed by an id thrown away on every page load, so no
  returning player had a row that meant anything.
- The only surviving state lived in each player's own browser `localStorage`,
  which the server cannot read and should not trust.

So there is no backfill script and no import step. Every wallet starts empty.
Existing players keep their character and name in practice anyway, because the
client still replays its `localStorage` copy on first login and the server
adopts it when it has nothing stored — see `hydrate()` in
`src/modules/main/player.ts`.

---

## How the pieces fit

```
browser ──auth:wallet {id, address}──▶ player.ts  hydrate()
                                          │
                                          ▼
                          src/modules/main/profile.ts     ← bundled to BOTH
                                          │                  client and server
                                globalThis.__smProfiles    ← the seam
                                          │
                                     profiles.mjs          ← Node only, owns `pg`
                                          │
                                       Postgres
```

### The bridge, and why it is a global

`src/modules/main/**` is compiled into the **client** bundle as well as the
server one. A `node:fs` import in `player.ts` once took the entire browser
bundle down. So that tree may not import `pg`, may not import `node:*`, and may
not hold a secret.

`server.mjs` therefore constructs the store and hangs it on
`globalThis.__smProfiles`. `src/modules/main/profile.ts` reads that global
through a typed interface and falls back to a **no-op store** when it is
absent — which is exactly what happens in the browser, under `vite dev`, and on
a server started without `DATABASE_URL`.

Verified after a production build (`RPG_TYPE=mmorpg npx vite build`):

```
$ grep -r -i -E "postgres|DATABASE_URL|SERVER_SECRET|pg\.Pool|player_state|connectionString" dist/client/
(no matches)

$ grep -r -o "__smProfiles" dist/client/
dist/client/assets/index-*.js:__smProfiles
```

The only thing that crossed the boundary is the name of the global. The driver
and the connection string are not in the client bundle, and are not in the
compiled *server* bundle either — they live in `server.mjs`/`profiles.mjs`,
which Node loads directly.

`src/modules/main/profile.spec.ts` runs in vitest's bare node environment where
`pg` is not resolvable, so it doubles as a guard: if anyone adds a Node-only
import to `profile.ts`, that suite stops loading long before the client breaks.

### Server-wins, and why it needed more than "load, then apply"

The client replays `CHARACTER` out of `localStorage` on boot, retries until the
server acknowledges, **and re-asserts after every map change**. That replay
predates server persistence and is now a competing, forgeable source of truth.

`player.ts` resolves it like this:

1. `auth:wallet` arrives → `hydrate()` starts and marks the player `loading`,
   with a **boot window** of 8 seconds.
2. A `character:set` or `name:set` arriving while `loading` is **parked**, not
   applied — otherwise the player visibly flips from their local look to their
   real one a moment later.
3. When the profile lands: if the server has a stored value it wins, the parked
   client claim is recorded as **stale**, and the server's value is pushed back
   over the existing `character:accepted` / `name:accepted` channels. If the
   server has nothing stored, the parked claim is adopted and saved — that is a
   first-time login, or a server with no database.
4. A stale claim stays rejected **for the whole session**, so the client's retry
   loop and its post-map-change re-assert cannot quietly win an hour later.
5. Past the boot window, a value that is not stale is a genuine choice: it is
   accepted, applied, and persisted. Changing your character in the designer
   still works. This is covered by an explicit end-to-end check, because a
   "server wins" rule implemented as a permanent lock would silently brick the
   designer.

`name:accepted` is better than `character:accepted` here: `chat-ui.ts` writes
the accepted name into `localStorage`, so pushing the server's name repairs a
stale client outright. Nothing writes `sm-character` back, so a client holding
a stale character keeps re-offering it and keeps being told no. Harmless, but
see "Left undone".

### When writes happen

Never on a variable change. `saveProfile()` merges into a per-wallet cache and
schedules **one** flush; a battle that mutates `PARTY` twenty times produces one
`UPDATE`, and a patch identical to what is already cached produces zero queries.
A flush is triggered by:

- the batching timer (`PROFILE_FLUSH_MS`, default 1500 ms);
- a background sweeper in `profile.ts` that scans connected wallets every 5 s —
  this is how `PARTY`/`BOX`/`BAG` get saved without touching `battle.ts`;
- any player input (free when nothing changed);
- `onDisconnected`, which does a final write and drops the cache entry;
- `SIGINT`/`SIGTERM`, which drains everything before the process exits.

Writes are chained per wallet, so two flushes cannot land out of order and
resurrect an older party.

---

## Degrading without a database

A database outage must never stop people playing. Every entry point in
`profiles.mjs` is total.

| Situation | What happens |
|---|---|
| `DATABASE_URL` unset | One warning line at boot. `loadProfile` returns `null`, `saveProfile` is a no-op, `claimName` accepts. The game behaves exactly as it did before persistence existed: session-only state, client-supplied character and name. |
| Postgres unreachable at boot | Same, plus a `[profiles] Postgres unavailable …` warning **once**, not once per query. A circuit breaker stops further attempts for 10 s at a time. |
| Postgres dies mid-session | The failed write stays pending and is retried after the breaker cooldown, so a Postgres restart costs the player nothing. `[profiles] Postgres reachable again` is logged when it recovers. |
| Postgres up but a name is taken | `{ok: false}` and the existing `name:rejected` path. This is the database answering, not an outage — constraint violations (`23xxx`) never trip the breaker. |
| Postgres down and a name is requested | The name is **accepted** for the session and queued; it is properly claimed (and may still lose the race) when the database returns. Refusing every name because of our infrastructure is a worse failure than a duplicate name. |
| An idle pooled client is dropped by the server | Handled by a `pool.on('error')` listener. Without one, that event is an unhandled `'error'` and takes the whole game server down. |

`GET /health` reports it without leaking anything:

```json
{"ok":true,"profiles":{"enabled":true,"healthy":true,"loads":3,"writes":11,
                       "writeErrors":0,"nameConflicts":1,"cached":2}}
```

`enabled` = a `DATABASE_URL` was configured. `healthy` = configured **and**
believed reachable right now.

---

## Redis: why it is in the compose file and why nothing talks to it

**Recommendation: leave it running, leave it unwired. Do not add a Redis
dependency to the game today.**

With one Node process, Redis buys us nothing that correctness depends on:

- **Shared state between processes** — there is one process. The room state is
  already in that process's memory; putting it in Redis would add a network hop
  and a second source of truth for zero benefit.
- **Caching profiles** — `profiles.mjs` already caches the connected players in
  a `Map`, which is faster than Redis and cannot go stale, because that Map *is*
  the write-back buffer. A Redis layer in front of Postgres here would be a
  cache with one reader.
- **A session store** — sessions are the wallet HMAC; there is nothing to store.

The three things it *would* genuinely buy us, each of which is real but none of
which is true yet:

1. **Rate limiting shared across processes.** `/auth/nonce` and `/auth/verify`
   are unauthenticated and currently unthrottled. A per-process counter is
   sufficient for one process and useless for two. When we run two, this is the
   first thing to move to Redis.
2. **Chat pub/sub.** Chat is broadcast inside one room in one process today. The
   moment the world is split across processes — and the moment a horizontal
   scale-out happens at all — cross-process chat needs a bus, and Redis pub/sub
   is the smallest one that works.
3. **Login nonces surviving a restart.** `auth.mjs` keeps nonces in an in-memory
   `Map`. Restart the server and every in-flight login fails with "stale or
   unknown nonce". That is a five-second annoyance today; with rolling deploys
   it becomes a steady trickle of failed logins. Nonces are short-lived
   key-value data with a TTL, which is precisely what Redis is for.

Adding it now would mean a second thing that can be down, a second thing to
provision, and a `redis` dependency in the auth path — in exchange for nothing
a single process needs. It stays in `docker-compose.yml` so the environment is
already correct on the day one of the three above becomes true, and so nobody
has to re-litigate the decision then.

It listens on **6380** (not 6379) so it cannot collide with a Redis you already
run.

---

## Running it

```bash
cp .env.example .env          # then edit SERVER_SECRET
docker compose up -d          # postgres:16 on 5433, redis:7 on 6380
npm run db:migrate
RPG_TYPE=mmorpg npx vite build
npm start
```

Host ports are deliberately non-default (5433 / 6380) so this stack can never
collide with a Postgres or Redis already on the machine. Override with
`POSTGRES_PORT` / `REDIS_PORT`.

### SERVER_SECRET is the primary key of every save

`wallet_id = "w:" + HMAC-SHA256(SERVER_SECRET, address)`. Change the secret and
every wallet hashes to a *different* id: returning players connect as brand-new
characters, and their party, box, bag, name and look are orphaned in the
database — not deleted, just unreachable. Generate it once, back it up, treat it
like a database password:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Leaving it unset in development means a random one per boot, i.e. saves reset on
every restart. `auth.mjs` warns when that happens. `.env` is gitignored.

### Tests

```bash
npm run test:profiles           # 16 node:test cases against a real Postgres
npx vitest run                  # 122 cases, incl. 21 for the client-safe bridge
npm run test:e2e:persistence    # 28 puppeteer checks against a production build
```

The end-to-end run (`tools/e2e-persistence.mjs`) is the one that proves the user
-visible fix. Its shape matters: a naive "reload and look" test passes even with
no server persistence at all, because the client replays `localStorage` — that
is exactly how the old behaviour fooled everyone. So it destroys the client's
copy and restores **only** the wallet, which is all that signing in on a new
device would give you, and then asserts the character, the name and the caught
creatures come back anyway.

---

## Bug found and fixed on the way

`player.setVariable(key, value)` hands the value to the engine's reactive store,
which makes it reactive **in place** — the array you passed in comes back
carrying a sync callback. Emitting that same object then reaches
`structuredClone` inside the transport, which cannot clone a function, and the
resulting `DataCloneError` **killed the whole Node process**, not just that
request.

`useCharacter()` in `player.ts` therefore builds three separate copies: one for
`setVariable`, one for `setGraphic`, and a fresh one for the wire. Anything that
came out of `getVariable` is scrubbed with `plain()` before it is emitted or
stored. Every fire-and-forget profile call also has a `.catch`, because Node
exits on an unhandled rejection and nothing about persistence is allowed to end
the server process.

---

## Left undone

1. **The title screen still gates entry on `localStorage`.** `index.html` shows
   the character picker when `sm-character` is absent, so a returning player on
   a clean device is sent through the picker even though the server already
   knows their look. Their real character *is* applied — the sprite is
   server-driven and the e2e proves it — but the flow is wrong. The fix is one
   line outside this change's file boundaries: write `sm-character` from the
   `character:accepted` handler in `src/game-ui.ts`, the way `chat-ui.ts`
   already does for `sm-name`.
2. **Position is not saved per wallet.** A returning player always spawns at the
   dock. `x`/`y`/`map` live in `rooms.sqlite` under the ephemeral connection id,
   so they are effectively session-only. Adding them is a `state.position` key
   and a `changeMap` in `hydrate()`; it was left out because respawning
   somewhere sensible is a design decision, not a storage one.
3. **Two tabs on the same wallet: last write wins.** Both sessions load the same
   profile and both write to it. There is no session lock. Rare today; it needs
   either a "you are already logged in" check or a per-write revision column
   before it matters.
4. **The stale-claim heuristic has one narrow false positive.** A client claim
   the server has rejected stays rejected for the session, so if a player whose
   `localStorage` holds character A (while the server holds B) deliberately
   re-picks *exactly* A in the same session, it is ignored until they reload.
   The clean fix is a `source: 'user'` flag on `character:set` from the designer,
   which needs a client change.
5. **`PARTY`/`BOX`/`BAG` are captured by a 5-second sweeper**, not by `battle.ts`
   calling save directly (that file was out of bounds for this change). A hard
   `kill -9` mid-battle can therefore lose up to five seconds. `SIGTERM`,
   `SIGINT` and a clean disconnect all drain first.
6. **`players.name`'s CHECK duplicates `validateName`'s 3–14 length bounds.** If
   those bounds change in `names.ts`, a migration has to change too. The check
   is a deliberate backstop, not the primary gate.
7. **No CI wiring.** `npm run db:migrate` is not run automatically on deploy, and
   `test:profiles` / `test:e2e:persistence` are not in a pipeline.
