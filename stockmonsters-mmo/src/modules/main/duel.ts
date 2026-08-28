import type { RpgPlayer } from '@rpgjs/server'
import { dmNearby } from './dm'
import { resolveDuel, type DuelSide } from '../../battle/duel'
import { createExactCreature } from '../../battle/factory'
import speciesRaw from '../../data/studio/species.json'
import dexRaw from '../../data/dex.json'
import { awardXp } from './trainer'
import { questProgress } from './quests'

/*
 * duel.ts — walk up to someone, bet on your Stockmonster, and find out.
 *
 * ## The flow, and why each step is where it is
 *
 *   1. OFFER      you must be standing next to them (dm.ts decides that, not
 *                 the client) and both of you must have a wallet.
 *   2. ACCEPT     nothing is escrowed yet; declining costs nothing.
 *   3. PICK       each side names a creature. The server keeps both secret and
 *                 gives each a random salt, so neither can see the other's and
 *                 neither can change theirs afterwards.
 *   4. SIGN       once both picks are locked the server builds ONE wager — the
 *                 amount, both commitments and the seed commitment — and both
 *                 players sign it in their own wallets. Two signatures are
 *                 what make it a bet rather than something done to somebody.
 *   5. OPEN       one of them sends `open()`. The tokens escrow on chain.
 *   6. FIGHT      only after the SERVER has read the escrow back off the chain.
 *                 A client saying "I opened it" is a claim, not a fact.
 *   7. SETTLE     the fight is resolved from the committed seed, the server
 *                 signs the result, and the winner sends `settle()` themselves.
 *
 * ## What this file is not allowed to do
 *
 * It never moves a token, never holds a key, and never decides that a match is
 * open. Everything it knows about money it learned by reading the arena
 * contract. `src/modules/**` is bundled into the browser, so the chain is
 * reached only through the object server.mjs hangs on globalThis — the same
 * seam profiles and the token store use.
 *
 * ## The one honest limitation
 *
 * The result is only as good as this server. That is bounded on chain (a wager
 * cap, a daily payout cap, an expiry, and a refund either player can take if
 * no result arrives) and it is stated in the UI. See docs/token-economy.md.
 */

/* -------------------------------------------------------------- tuning ---*/

/** How long a duel offer stands before it is forgotten. */
const OFFER_TTL_MS = 60_000
/** How long the whole thing may take before the server stops caring. */
const DUEL_TTL_MS = 20 * 60_000
/** One offer at a time, and not to the same person twice a minute. */
const OFFER_COOLDOWN_MS = 20_000

const species = speciesRaw as Record<string, { id: number }>
const dbSymbolByDexId: Record<number, string> = {}
for (const [sym, s] of Object.entries(species)) dbSymbolByDexId[s.id] = sym

const dex = dexRaw as Array<{ dexId: number; ticker: string; name: string; sprite: string }>
const dexByDexId = new Map(dex.map((e) => [e.dexId, e]))

const NATURES = [
    'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish',
    'lax', 'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful',
    'rash', 'calm', 'gentle', 'sassy', 'careful', 'quirky',
]

/* --------------------------------------------------------------- types ---*/

type Phase = 'offered' | 'picking' | 'signing' | 'opening' | 'fighting' | 'settled' | 'dead'

interface Fighter {
    walletId: string
    address: string
    name: string
    playerId: string
    tokenId: string | null
    salt: string | null
    commit: string | null
    signature: string | null
}

interface Duel {
    id: string
    /** The 32-byte match id the contract knows this by. */
    matchId: string
    amount: string
    seed: string
    seedCommit: string
    phase: Phase
    createdAt: number
    /**
     * The wager's expiry, in unix seconds, FIXED AT CREATION.
     *
     * The expiry is inside the signed Wager struct, so every party — both
     * signers and the open() call — must use the identical number. It used to
     * be computed twice, once from Date.now() at signing and once from
     * createdAt at opening; the two differed by however long the players took
     * to pick, the digests diverged, and every open reverted BAD_SIGNATURE_A.
     * A signature over a timestamp is a signature over THAT timestamp.
     */
    expiry: number
    /** A is the challenger — the one who offered, and the one who opens. */
    a: Fighter
    b: Fighter
    winner: string | null
}

const duels = new Map<string, Duel>()
const lastOffer = new Map<string, number>()

/* ------------------------------------------------------------- bridges ---*/

interface TokenBridge {
    enabled?: boolean
    arena?: string | null
    chainId?: number
    canSignBattles?: boolean
    toBaseUnits?: (v: string | number) => Promise<bigint>
    /* The two commitments live on the bridge, so no crypto library is pulled
       into the browser bundle for a hash only the server computes. */
    commitSeed?: (seed: string) => string
    commitPick?: (tokenId: string, salt: string) => string
    readMatch?: (matchId: string) => Promise<null | {
        status: number; playerA: string; playerB: string; amount: string
        seedCommit: string; pickA: string; pickB: string
    }>
    signMatchResult?: (p: Record<string, unknown>) => Promise<{ contract: string; chainId: number; deadline: number; signature: string }>
    arenaAllowanceCovers?: (owner: string, amount: string) => Promise<boolean>
}
interface BoxBridge {
    creatureForToken?: (p: { walletId: string; tokenId: string }) => Promise<null | {
        tokenId: string; dexId: number; level: number; ivs: number[]; natureId: number; shiny: boolean
    }>
}

const tokens = (): TokenBridge | null =>
    ((globalThis as Record<string, unknown>).__smTokens as TokenBridge | undefined) ?? null
const boxes = (): BoxBridge | null =>
    ((globalThis as Record<string, unknown>).__smBoxes as BoxBridge | undefined) ?? null

/* ------------------------------------------------------------ plumbing ---*/

const WALLET = /^w:[0-9a-f]{32}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const walletOf = (p: unknown) => {
    const v = (p as any)?.getVariable?.('WALLET_ID')
    return typeof v === 'string' && WALLET.test(v) ? v : null
}
const addressOf = (p: unknown) => {
    const v = (p as any)?.getVariable?.('WALLET_ADDRESS')
    return typeof v === 'string' && ADDRESS.test(v) ? v : null
}
const nameOf = (p: unknown) => {
    const v = (p as any)?.getVariable?.('NAME')
    return typeof v === 'string' && v ? v : 'Trader'
}

/** Everyone who is connected, so the other side can be reached. */
const connected = new Map<string, RpgPlayer>()
export function addDuelMember(player: RpgPlayer) {
    connected.set(String(player.id), player)
}
export function removeDuelMember(player: RpgPlayer) {
    connected.delete(String(player.id))
}

const say = (player: unknown, text: string, tone: 'info' | 'warn' | 'ok' = 'info') =>
    (player as any)?.emit?.('duel:system', { text, tone })

/**
 * 32 random bytes as hex.
 *
 * `crypto.getRandomValues` exists in Node 19+ and in every browser this runs
 * in. It is the salt that hides a pick and the seed that decides a fight, so a
 * predictable source here would quietly break both.
 */
function random32(): string {
    const bytes = new Uint8Array(32)
    ;(globalThis.crypto as Crypto).getRandomValues(bytes)
    return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const other = (duel: Duel, walletId: string): Fighter => (duel.a.walletId === walletId ? duel.b : duel.a)
const mine = (duel: Duel, walletId: string): Fighter | null =>
    duel.a.walletId === walletId ? duel.a : duel.b.walletId === walletId ? duel.b : null

const playerFor = (f: Fighter): RpgPlayer | null => connected.get(f.playerId) ?? null

function prune() {
    const now = Date.now()
    for (const [id, d] of duels) {
        const ttl = d.phase === 'offered' ? OFFER_TTL_MS : DUEL_TTL_MS
        if (now - d.createdAt > ttl) duels.delete(id)
    }
}

/** What each side is told about the duel. Never the other's pick. */
function view(duel: Duel, walletId: string) {
    const me = mine(duel, walletId)
    const them = other(duel, walletId)
    return {
        id: duel.id,
        matchId: duel.matchId,
        phase: duel.phase,
        amount: duel.amount,
        isChallenger: duel.a.walletId === walletId,
        opponent: { name: them.name, address: them.address, picked: !!them.tokenId, signed: !!them.signature },
        me: { picked: !!me?.tokenId, tokenId: me?.tokenId ?? null, signed: !!me?.signature },
        seedCommit: duel.seedCommit,
        winner: duel.winner,
    }
}

const push = (duel: Duel) => {
    for (const f of [duel.a, duel.b]) playerFor(f)?.emit?.('duel:state', view(duel, f.walletId))
}

/* ------------------------------------------------------------ the flow ---*/

/** `duel:offer` {amount} — challenge whoever you are standing next to. */
export async function handleDuelOffer(player: RpgPlayer, data: unknown): Promise<void> {
    prune()
    const t = tokens()
    if (!t?.enabled || !t.arena) {
        say(player, 'Duels need the game token, and this server has none configured.', 'warn')
        return
    }
    if (!t.canSignBattles) {
        say(player, 'This server cannot referee a duel — it has no battle signer.', 'warn')
        return
    }

    const walletId = walletOf(player)
    const address = addressOf(player)
    if (!walletId || !address) {
        say(player, 'Connect your wallet before betting on a duel.', 'warn')
        return
    }

    const now = Date.now()
    if (now - (lastOffer.get(walletId) ?? 0) < OFFER_COOLDOWN_MS) {
        say(player, 'Give them a moment before challenging again.', 'warn')
        return
    }

    // Proximity is decided server-side, by the same code the DM window uses.
    const peer = dmNearby(player)
    if (!peer) {
        say(player, 'Stand next to someone to challenge them.', 'warn')
        return
    }
    const opponent = connected.get(peer.id)
    if (!opponent) {
        say(player, 'They just left.', 'warn')
        return
    }
    const theirWallet = walletOf(opponent)
    const theirAddress = addressOf(opponent)
    if (!theirWallet || !theirAddress) {
        say(player, `${peer.name} has no wallet connected, so there is nothing to bet with.`, 'warn')
        return
    }

    const whole = String((data as { amount?: unknown })?.amount ?? '')
    if (!/^\d{1,12}$/.test(whole) || Number(whole) <= 0) {
        say(player, 'Name a whole number of tokens to bet.', 'warn')
        return
    }
    const amount = (await t.toBaseUnits!(whole)).toString()

    for (const d of duels.values()) {
        if (d.phase === 'dead' || d.phase === 'settled') continue
        if ([d.a.walletId, d.b.walletId].includes(walletId)) {
            say(player, 'You are already in a duel. Finish it first.', 'warn')
            return
        }
    }

    lastOffer.set(walletId, now)
    const id = random32().slice(2, 18)
    const seed = random32()
    const duel: Duel = {
        id,
        matchId: random32(),
        amount,
        seed,
        seedCommit: tokens()!.commitSeed!(seed),
        phase: 'offered',
        createdAt: now,
        expiry: Math.floor((now + DUEL_TTL_MS) / 1000),
        a: fighter(walletId, address, nameOf(player), String(player.id)),
        b: fighter(theirWallet, theirAddress, peer.name, peer.id),
        winner: null,
    }
    duels.set(id, duel)

    opponent.emit?.('duel:invite', {
        id,
        from: nameOf(player),
        amount,
        amountWhole: whole,
        expiresIn: Math.floor(OFFER_TTL_MS / 1000),
    })
    say(player, `Challenged ${peer.name} for ${whole} tokens. Waiting for them.`, 'ok')
    push(duel)
}

const fighter = (walletId: string, address: string, name: string, playerId: string): Fighter => ({
    walletId, address, name, playerId, tokenId: null, salt: null, commit: null, signature: null,
})

/** `duel:respond` {id, accept} */
export function handleDuelRespond(player: RpgPlayer, data: unknown): void {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel || duel.b.walletId !== walletId || duel.phase !== 'offered') return

    if (!(data as { accept?: unknown })?.accept) {
        duel.phase = 'dead'
        duels.delete(id)
        say(playerFor(duel.a), `${duel.b.name} turned the duel down.`)
        say(player, 'Declined.')
        return
    }
    duel.phase = 'picking'
    for (const f of [duel.a, duel.b]) {
        say(playerFor(f), 'Duel accepted. Pick your Stockmonster — neither of you sees the other\'s.', 'ok')
    }
    push(duel)
}

/**
 * `duel:pick` {id, tokenId} — lock in a creature.
 *
 * The pick is stored here and hashed with a random salt. Nothing about it goes
 * to the other player until the fight is over, and the salt is what stops them
 * guessing it from the hash: there are only a few thousand token ids.
 */
export async function handleDuelPick(player: RpgPlayer, data: unknown): Promise<void> {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel) return
    const me = mine(duel, walletId)
    if (!me || duel.phase !== 'picking') return

    const tokenId = String((data as { tokenId?: unknown })?.tokenId ?? '')
    const creature = await boxes()?.creatureForToken?.({ walletId, tokenId })
    if (!creature) {
        say(player, 'Pick a Stockmonster you own and have opened. A sealed box cannot fight.', 'warn')
        return
    }

    me.tokenId = tokenId
    me.salt = random32()
    me.commit = tokens()!.commitPick!(tokenId, me.salt)
    say(player, 'Locked in. They cannot see it.', 'ok')

    if (duel.a.commit && duel.b.commit) {
        duel.phase = 'signing'
        const payload = {
            id: duel.id,
            matchId: duel.matchId,
            arena: tokens()?.arena ?? null,
            chainId: tokens()?.chainId ?? 0,
            playerA: duel.a.address,
            playerB: duel.b.address,
            amount: duel.amount,
            seedCommit: duel.seedCommit,
            pickA: duel.a.commit,
            pickB: duel.b.commit,
            expiry: duel.expiry,
        }
        for (const f of [duel.a, duel.b]) playerFor(f)?.emit?.('duel:sign', payload)
    }
    push(duel)
}

/** `duel:signed` {id, signature} — one half of the agreement. */
export function handleDuelSigned(player: RpgPlayer, data: unknown): void {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel) return
    const me = mine(duel, walletId)
    const sig = String((data as { signature?: unknown })?.signature ?? '')
    if (!me || duel.phase !== 'signing' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return

    me.signature = sig
    if (duel.a.signature && duel.b.signature) {
        duel.phase = 'opening'
        // Logged, never swallowed: a failure in here is a duel that silently
        // sticks at "waiting for the escrow", which is the exact bug this
        // rewrite exists to kill.
        void openWhenBothCanPay(duel).catch((e) => console.error('[duel] open flow:', e))
    }
    push(duel)
}

/**
 * The escrow pulls BOTH stakes in one transaction.
 *
 * `open()` does `_pull(playerA); _pull(playerB)` — two transferFroms — so it
 * reverts unless BOTH players have approved the arena first. The old flow only
 * ever had the challenger approve (inside their open step), so the open
 * reverted on the opponent's allowance every single time, and both players sat
 * at "waiting for the escrow" until the duel expired. Found by a real pair of
 * players; the modal was honest, the plan behind it was wrong.
 *
 * So: check the CHAIN for the opponent's allowance. If it is already there
 * (a rematch, say), tell the challenger to open at once. If not, tell the
 * opponent to approve, and only hand the challenger the open step once the
 * chain shows the allowance is real. A client saying "I approved" is a claim;
 * the allowance read is the fact.
 */
async function openWhenBothCanPay(duel: Duel): Promise<void> {
    await driveOpening(duel)
    /*
     * AND KEEP DRIVING IT. A single emit is a single point of failure: the
     * engine hands out fresh player objects and an emit on a stale one is
     * silently lost — the documented trap of this codebase, and precisely the
     * "approve happened but nothing followed" that players reported. So while
     * the duel sits in 'opening', the server re-checks the chain and re-sends
     * whichever instruction is due, every few seconds, until the escrow is
     * open or the duel dies. The clients guard against acting twice, and the
     * chain refuses a second open anyway.
     */
    const tick = setInterval(() => {
        const live = duels.get(duel.id)
        if (!live || live.phase !== 'opening') { clearInterval(tick); return }
        if (Date.now() - live.createdAt > DUEL_TTL_MS) { clearInterval(tick); return }
        void driveOpening(live).catch((e) => console.error('[duel] drive:', e))
    }, 8000)
}

async function driveOpening(duel: Duel): Promise<void> {
    const t = tokens()
    const covered = await t?.arenaAllowanceCovers?.(duel.b.address, duel.amount)
    if (duel.phase !== 'opening') return // cancelled or expired while we read
    if (covered) {
        tellChallengerToOpen(duel)
        say(playerFor(duel.b), 'Both signed. Waiting for the escrow to be opened on chain.')
        return
    }
    playerFor(duel.b)?.emit?.('duel:approve', {
        id: duel.id,
        arena: t?.arena ?? null,
        amount: duel.amount,
    })
    say(playerFor(duel.a),
        `Both signed. Waiting for ${duel.b.name} to allow the arena to hold their stake.`)
}

function tellChallengerToOpen(duel: Duel): void {
    // The challenger opens the escrow. Somebody has to, and making it the one
    // who started the fight means the other side is never asked to pay the gas
    // for a duel they were dragged into. Their own approve happens inside this
    // step, on their side.
    playerFor(duel.a)?.emit?.('duel:open', {
        id: duel.id,
        matchId: duel.matchId,
        arena: tokens()?.arena ?? null,
        token: null,
        // The client encodes the open() call itself, and the contract takes
        // both player addresses as arguments. These two fields were missing
        // for as long as this emit has existed, so encodeOpen threw on
        // word(undefined) every single time and no escrow was EVER opened
        // through the UI — the flow only looked plausible because everything
        // up to this point worked. Found by the first end-to-end drive.
        playerA: duel.a.address,
        playerB: duel.b.address,
        amount: duel.amount,
        seedCommit: duel.seedCommit,
        pickA: duel.a.commit,
        pickB: duel.b.commit,
        expiry: duel.expiry,
        sigA: duel.a.signature,
        sigB: duel.b.signature,
    })
}

/**
 * `duel:approved` {id} — the opponent says their approval is on chain.
 *
 * Taken as a nudge to look, never as the truth: the allowance is read back off
 * the chain, and only a read that shows the money can actually be pulled moves
 * the duel forward. The client retries this poke, so an approval that is still
 * in the mempool on the first look is caught by the second.
 */
export async function handleDuelApproved(player: RpgPlayer, data: unknown): Promise<void> {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel || !mine(duel, walletId) || duel.phase !== 'opening') return
    // Whoever poked, refresh our idea of where their live player object is:
    // the engine hands out fresh RpgPlayer objects, and emitting on a stale
    // one is silently lost. The poke itself carries the current object.
    const me = mine(duel, walletId)!
    me.playerId = String(player.id)
    connected.set(String(player.id), player)

    const covered = await tokens()?.arenaAllowanceCovers?.(duel.b.address, duel.amount)
    if (duel.phase !== 'opening') return
    if (!covered) return // not on chain yet — their client will poke again
    tellChallengerToOpen(duel)
    say(playerFor(duel.b), 'Stake allowed. Waiting for the escrow to be opened on chain.')
}

/**
 * `duel:opened` {id} — the challenger says the escrow is live.
 *
 * THE SERVER CHECKS IT ITSELF. It reads the match back off the arena and
 * refuses to fight unless the players, the amount and both commitments match
 * what it remembers. A client claiming this is a claim; the contract is the
 * fact.
 */
export async function handleDuelOpened(player: RpgPlayer, data: unknown): Promise<void> {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel || !mine(duel, walletId)) return
    if (duel.phase !== 'opening' && duel.phase !== 'fighting') return

    const onChain = await tokens()?.readMatch?.(duel.matchId)
    if (!onChain || onChain.status !== 1) {
        say(player, 'The escrow is not open yet — give the transaction a moment.', 'warn')
        return
    }
    const same =
        onChain.playerA.toLowerCase() === duel.a.address.toLowerCase() &&
        onChain.playerB.toLowerCase() === duel.b.address.toLowerCase() &&
        onChain.amount === duel.amount &&
        onChain.seedCommit.toLowerCase() === duel.seedCommit.toLowerCase() &&
        onChain.pickA.toLowerCase() === (duel.a.commit ?? '').toLowerCase() &&
        onChain.pickB.toLowerCase() === (duel.b.commit ?? '').toLowerCase()
    if (!same) {
        duel.phase = 'dead'
        for (const f of [duel.a, duel.b]) {
            say(playerFor(f), 'That escrow does not match this duel. Nothing will be settled.', 'warn')
        }
        return
    }
    if (duel.phase === 'fighting') return
    duel.phase = 'fighting'
    await fight(duel)
}

/** Resolve it, tell both sides, and sign the result for the winner to submit. */
async function fight(duel: Duel): Promise<void> {
    const sides: DuelSide[] = []
    for (const f of [duel.a, duel.b]) {
        const raw = await boxes()?.creatureForToken?.({ walletId: f.walletId, tokenId: f.tokenId! })
        if (!raw) {
            for (const g of [duel.a, duel.b]) {
                say(playerFor(g), 'A chosen Stockmonster could not be loaded. Nobody wins; take a refund when the window passes.', 'warn')
            }
            duel.phase = 'dead'
            return
        }
        const dbSymbol = dbSymbolByDexId[raw.dexId]
        const ivs = Array.isArray(raw.ivs) ? raw.ivs : [0, 0, 0, 0, 0, 0]
        sides.push({
            owner: f.address,
            creature: createExactCreature(
                dbSymbol,
                raw.level,
                { hp: ivs[0], atk: ivs[1], dfe: ivs[2], spd: ivs[3], ats: ivs[4], dfs: ivs[5] },
                NATURES[raw.natureId] ?? NATURES[0],
            ),
        })
    }

    // The creatures as they go in, for the opening shot of the replay:
    // resolveDuel works on copies, but the HP shown has to be the full bar
    // both fighters started with.
    const openingViews = sides.map((s, i) => viewOfDuellist(s, [duel.a, duel.b][i]))

    const result = resolveDuel(sides[0], sides[1], duel.seed)
    duel.winner = result.winner === 0 ? duel.a.address : duel.b.address
    const winnerFighter = result.winner === 0 ? duel.a : duel.b
    const loserFighter = result.winner === 0 ? duel.b : duel.a
    // Trainer XP, not money — the tokens are settled on chain by the winner.
    // A duel is worth the most of anything because another player had to agree
    // to lose it, which is the one thing a script cannot manufacture alone.
    const winnerPlayer = playerFor(winnerFighter)
    if (winnerPlayer) {
        awardXp(winnerPlayer, 'duelWin')
        questProgress(winnerPlayer, 'duelWin')
    }

    /*
     * THE FIGHT, ANIMATED, THROUGH THE SCENE THAT ALREADY EXISTS.
     *
     * battle-scene.ts is driven entirely by three socket events, so a duel
     * needs no new client code — it needs the same three events. The only
     * subtlety is that the scene calls side 0 "mine": player B's replay is the
     * same fight with every side index flipped, or they would watch themselves
     * from the wrong chair.
     */
    for (const [i, f] of [duel.a, duel.b].entries()) {
        const p = playerFor(f)
        if (!p) continue
        const meFirst = i === 0
        p.emit?.('battle:state', {
            mine: meFirst ? openingViews[0] : openingViews[1],
            wild: meFirst ? openingViews[1] : openingViews[0],
            intro: true,
        })
        const events = meFirst ? result.events : result.events.map(mirror)
        if (events.length) p.emit?.('battle:turn', { events })
    }
    // Let the scene play out before tearing it down. It paces itself at a few
    // hundred ms per beat, so the wait is derived from the fight rather than
    // guessed at — and capped, because a hundred-round slugfest should not
    // hold the screen for five minutes.
    const showFor = Math.min(45_000, 1_500 + result.events.length * 420)
    setTimeout(() => {
        for (const f of [duel.a, duel.b]) playerFor(f)?.emit?.('battle:end', {})
    }, showFor)

    // The whole fight, to both sides, with the seed opened — anyone can now
    // replay it and check the server did what it said.
    for (const f of [duel.a, duel.b]) {
        playerFor(f)?.emit?.('duel:result', {
            id: duel.id,
            won: f.walletId === winnerFighter.walletId,
            winner: winnerFighter.name,
            rounds: result.rounds,
            reason: result.reason,
            seed: duel.seed,
            events: result.events,
            picks: {
                [duel.a.name]: duel.a.tokenId,
                [duel.b.name]: duel.b.tokenId,
            },
        })
    }

    try {
        const signed = await tokens()!.signMatchResult!({
            matchId: duel.matchId,
            winner: duel.winner,
            seed: duel.seed,
            tokenA: duel.a.tokenId,
            saltA: duel.a.salt,
            tokenB: duel.b.tokenId,
            saltB: duel.b.salt,
        })
        duel.phase = 'settled'
        playerFor(winnerFighter)?.emit?.('duel:settle', {
            id: duel.id,
            matchId: duel.matchId,
            winner: duel.winner,
            seed: duel.seed,
            tokenA: duel.a.tokenId,
            saltA: duel.a.salt,
            tokenB: duel.b.tokenId,
            saltB: duel.b.salt,
            ...signed,
        })
        say(playerFor(loserFighter), `${winnerFighter.name} won the duel.`)
    } catch (err) {
        for (const f of [duel.a, duel.b]) {
            say(playerFor(f), 'The result could not be signed. Take your refund when the window passes.', 'warn')
        }
        console.error('[duel] signing failed', err)
    }
}

/** The scene's view of one fighter: name, level, HP and the dex sprite. */
function viewOfDuellist(side: DuelSide, f: Fighter) {
    const c = side.creature
    const entry = dexByDexId.get(species[c.dbSymbol]?.id ?? -1)
    return {
        name: entry?.ticker ?? entry?.name ?? f.name,
        level: c.level,
        hp: c.maxHp,
        maxHp: c.maxHp,
        sprite: entry?.sprite ?? '',
        status: undefined,
    }
}

/**
 * The same event seen from the other chair.
 *
 * Every scene event carries `side`, where 0 is "the creature at the bottom of
 * my screen". Sending player B the unflipped stream would show them cheering
 * for their opponent.
 */
function mirror(e: unknown): unknown {
    const ev = e as Record<string, unknown>
    if (typeof ev?.side !== 'number') return e
    return { ...ev, side: ev.side === 0 ? 1 : 0 }
}

/** `duel:cancel` {id} — walk away before anything is escrowed. */
export function handleDuelCancel(player: RpgPlayer, data: unknown): void {
    const walletId = walletOf(player)
    const id = String((data as { id?: unknown })?.id ?? '')
    const duel = duels.get(id)
    if (!walletId || !duel || !mine(duel, walletId)) return
    // Once money is on chain this cannot undo it: the refund lives in the
    // contract, and saying otherwise here would be a lie with a stake behind it.
    if (duel.phase === 'fighting' || duel.phase === 'settled') {
        say(player, 'Too late — the escrow is open. The contract refunds you if no result arrives.', 'warn')
        return
    }
    duels.delete(id)
    for (const f of [duel.a, duel.b]) say(playerFor(f), 'The duel was called off.')
}

/* ---------------------------------------------------------------- tests ---*/

export function resetDuels(): void {
    duels.clear()
    lastOffer.clear()
    connected.clear()
}

export const duelCount = () => duels.size
