/*
 * quests.ts — daily quests, unlocked by owning a Stockmonster.
 *
 * ## The gate, and why it is the whole design
 *
 * Quest rewards are real tokens, so the first question is not "what are the
 * quests" but "why can't a script farm them with a thousand fresh accounts".
 * Two answers, both required, both the user's own design:
 *
 * 1. **Quests only open for a wallet that OWNS an opened Stockmonster.** An
 *    account is free; a Stockmonster costs a box. Ownership is read off the
 *    chain at qualification time, never taken from the client.
 *
 * 2. **One Stockmonster unlocks quests for ONE wallet per epoch.** Without
 *    this, a single NFT passed wallet-to-wallet is a skeleton key for as many
 *    accounts as its owner has patience for. The first wallet to qualify with
 *    a token in an epoch takes that token's slot for the whole epoch — decided
 *    by a primary-key insert in Postgres, so there is nothing to race — and a
 *    transfer does not release it.
 *
 * On top of that, every payout goes through `credit()` in earnings.ts, so
 * quest income lives under the same DAILY_CAP as everything else and claims
 * are still bounded per-epoch on chain. Quests change how fast a player
 * reaches the cap, never the cap.
 *
 * ## Progress is server-observed, never client-reported
 *
 * The quest kinds are exactly the events the server already witnesses first
 * hand — battles it simulated, catches it rolled, maps it moved the player
 * to, duels it refereed. `questProgress()` is called from those handlers, so
 * a client cannot claim progress; it can only play.
 */
import type { RpgPlayer } from '@rpgjs/server'
import { credit, currentEpoch } from './earnings'
import { tokensForUsd, usdForTokens } from './pricing'

/* ------------------------------------------------------------ the board ---*/

export interface QuestDef {
    id: string
    title: string
    /** The event counted, matching the questProgress() call sites. */
    counts: QuestEvent
    goal: number
    /**
     * What the quest is WORTH, in dollars. Not a token amount.
     *
     * A fixed token reward is a promise about a number rather than about
     * value — it quietly becomes generous or worthless as the price moves,
     * without anybody deciding it should. The board is priced in dollars and
     * the tokens are derived at claim time; see pricing.ts.
     */
    usd: number
}

export type QuestEvent = 'battleWin' | 'catch' | 'newMap' | 'duelWin' | 'boxOpen' | 'chat'

/**
 * The daily board. Deliberately finishable in one sitting: a board that
 * cannot be cleared reads as a treadmill, and the point of quests is to give
 * a session a shape — log in, clear the board, done.
 *
 * A dollar for the short ones, two for the ones that take a while or need
 * another player. Seven dollars for the full board, which is the number to
 * argue about — the token amounts follow from it and the price.
 */
export const DAILY_QUESTS: readonly QuestDef[] = [
    { id: 'warmup', title: 'Win 3 wild battles', counts: 'battleWin', goal: 3, usd: 1 },
    { id: 'hunter', title: 'Catch 2 Stockmonsters', counts: 'catch', goal: 2, usd: 1.5 },
    { id: 'walker', title: 'Discover a map you have never visited', counts: 'newMap', goal: 1, usd: 1 },
    { id: 'grinder', title: 'Win 10 wild battles', counts: 'battleWin', goal: 10, usd: 1.5 },
    { id: 'gambler', title: 'Win a duel against another player', counts: 'duelWin', goal: 1, usd: 2 },
]

/** What a quest pays right now, in whole tokens. */
export const questReward = (q: QuestDef): number => tokensForUsd(q.usd)

const V_QUESTS = 'QUESTS'
/** Confirmed eligibility for an epoch, so the chain is not re-read per event. */
const V_QUEST_GATE = '_QUEST_GATE'

interface QuestState {
    epoch: number
    /** Event tallies for the epoch, e.g. { battleWin: 4 }. */
    n: Partial<Record<QuestEvent, number>>
    /** Quest ids already claimed this epoch. */
    claimed: string[]
}

/* -------------------------------------------------------------- bridges ---*/

interface TokenBridge {
    nftOwnership?: (tokenId: string) => Promise<null | { owner: string; opened: boolean }>
}
interface ProfileBridge {
    enabled?: boolean
    lockQuestToken?: (epoch: number, tokenId: string, walletId: string) => Promise<'locked' | 'taken' | 'down'>
    questTokenOf?: (epoch: number, walletId: string) => Promise<string | null>
}
interface BoxBridge {
    /** lootbox.mjs: the boxes this wallet minted, with token ids and status. */
    listBoxes?: (q: { walletId: string; address: string | null }) => Promise<Array<{ tokenId: string | null; status: string }>>
}

const g = globalThis as Record<string, unknown>
const tokens = (): TokenBridge | null => (g.__smTokens as TokenBridge | undefined) ?? null
const profiles = (): ProfileBridge | null => (g.__smProfiles as ProfileBridge | undefined) ?? null
const boxes = (): BoxBridge | null => (g.__smBoxes as BoxBridge | undefined) ?? null

const WALLET = /^w:[0-9a-f]{32}$/
const walletOf = (p: RpgPlayer) => {
    const id = p.getVariable?.('WALLET_ID')
    return typeof id === 'string' && WALLET.test(id) ? id : null
}
const addressOf = (p: RpgPlayer) => {
    const a = p.getVariable?.('WALLET_ADDRESS')
    return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null
}

/* ---------------------------------------------------------------- state ---*/

/** The engine's reactive wrappers cannot be structuredClone'd; scrub via JSON. */
function readState(player: RpgPlayer): QuestState {
    const raw = player.getVariable?.(V_QUESTS)
    const epoch = currentEpoch()
    try {
        const s = JSON.parse(JSON.stringify(raw)) as QuestState
        if (s && typeof s === 'object' && s.epoch === epoch && s.n && Array.isArray(s.claimed)) return s
    } catch { /* fresh state below */ }
    return { epoch, n: {}, claimed: [] }
}

const writeState = (player: RpgPlayer, s: QuestState) => player.setVariable?.(V_QUESTS, s)

/** The gate note: which epoch this player proved eligibility for, and how. */
function gateOf(player: RpgPlayer): { epoch: number; tokenId: string } | null {
    const raw = player.getVariable?.(V_QUEST_GATE) as { epoch?: number; tokenId?: string } | undefined
    return raw && raw.epoch === currentEpoch() && typeof raw.tokenId === 'string'
        ? { epoch: raw.epoch, tokenId: raw.tokenId }
        : null
}

/* ----------------------------------------------------------- the gate -----*/

/**
 * Is this player allowed to quest this epoch — and if not yet, can they be?
 *
 * The happy path re-qualifies silently: a player who quested yesterday and
 * still owns their Stockmonster should not have to think about the gate. The
 * failure paths each carry their own sentence, because "quests are locked"
 * with no reason reads as a bug.
 */
async function qualify(player: RpgPlayer): Promise<{ ok: true; tokenId: string } | { ok: false; reason: string }> {
    const cached = gateOf(player)
    if (cached) return { ok: true, tokenId: cached.tokenId }

    const walletId = walletOf(player)
    const address = addressOf(player)
    if (!walletId || !address) return { ok: false, reason: 'Connect your wallet to take quests.' }

    const p = profiles()
    if (!p?.enabled || !p.lockQuestToken || !p.questTokenOf) {
        return { ok: false, reason: 'Quests need the database, and this server has none.' }
    }

    const epoch = currentEpoch()

    // Already qualified this epoch (a reconnect, a second device).
    const held = await p.questTokenOf(epoch, walletId)
    if (held) {
        player.setVariable?.(V_QUEST_GATE, { epoch, tokenId: String(held) })
        return { ok: true, tokenId: String(held) }
    }

    // Candidate tokens: the opened boxes this wallet minted. Chain ownership
    // is verified per candidate — a sold token stops qualifying the seller the
    // moment it leaves their wallet, whatever the box table remembers.
    const rows = (await boxes()?.listBoxes?.({ walletId, address }).catch(() => null)) ?? []
    const candidates = rows.filter((b) => b.tokenId && b.status === 'opened').map((b) => String(b.tokenId))
    if (!candidates.length) {
        return { ok: false, reason: 'Quests open once you own an opened Stockmonster. Buy a box, open it, come back.' }
    }

    let sawTaken = false
    for (const tokenId of candidates.slice(0, 8)) {
        const chain = await tokens()?.nftOwnership?.(tokenId)
        if (!chain || !chain.opened) continue
        if (chain.owner.toLowerCase() !== address.toLowerCase()) continue
        const lock = await p.lockQuestToken(epoch, tokenId, walletId)
        if (lock === 'locked') {
            player.setVariable?.(V_QUEST_GATE, { epoch, tokenId })
            return { ok: true, tokenId }
        }
        if (lock === 'taken') { sawTaken = true; continue }
        return { ok: false, reason: 'The quest board is unreachable right now. Try again in a moment.' }
    }
    return {
        ok: false,
        reason: sawTaken
            ? 'That Stockmonster already opened quests for another trader today. One creature, one trader, per day.'
            : 'None of your Stockmonsters could be verified on chain just now. Try again in a moment.',
    }
}

/* ------------------------------------------------------------- progress ---*/

/**
 * Count one event toward the board. Called from the same server handlers that
 * pay rewards and XP — battle wins, catches, map discovery, duel wins.
 *
 * Cheap on purpose: no chain read, no database. Progress only ever counts for
 * a player who already passed the gate this epoch, so the expensive checks
 * happen once per day in qualify(), not once per battle.
 */
export function questProgress(player: RpgPlayer, event: QuestEvent, times = 1): void {
    if (!gateOf(player)) return
    const s = readState(player)
    s.n[event] = (s.n[event] ?? 0) + Math.max(0, Math.floor(times))
    writeState(player, s)
    // A quest crossing its goal is worth a nudge; spamming one per kill is not.
    const done = DAILY_QUESTS.filter((q) => q.counts === event
        && !s.claimed.includes(q.id)
        && (s.n[event] ?? 0) >= q.goal
        && (s.n[event] ?? 0) - times < q.goal)
    for (const q of done) player.emit?.('quests:done', { id: q.id, title: q.title, reward: questReward(q) })
}

/* --------------------------------------------------------------- actions ---*/

function view(player: RpgPlayer, gate: { ok: boolean; reason?: string; tokenId?: string }) {
    const s = readState(player)
    return {
        epoch: s.epoch,
        unlocked: gate.ok,
        reason: gate.ok ? null : gate.reason,
        tokenId: gate.ok ? gate.tokenId : null,
        quests: DAILY_QUESTS.map((q) => ({
            id: q.id,
            title: q.title,
            goal: q.goal,
            reward: questReward(q),
            usd: q.usd,
            have: Math.min(s.n[q.counts] ?? 0, q.goal),
            claimed: s.claimed.includes(q.id),
            claimable: !s.claimed.includes(q.id) && (s.n[q.counts] ?? 0) >= q.goal,
        })),
    }
}

/** `quests:list` — the whole board, qualifying on the way if possible. */
export async function handleQuestList(player: RpgPlayer): Promise<void> {
    const gate = await qualify(player)
    player.emit?.('quests:state', view(player, gate))
}

/**
 * `quests:claim` {id} — pay a finished quest into the earnings ledger.
 *
 * The payout runs through credit(), so it obeys the daily cap and lands in
 * the same per-epoch ledger the on-chain claim reads. A quest is marked
 * claimed BEFORE the credit so a double-send cannot pay twice; the credit
 * cannot fail for a gated player short of the cap, and at the cap the honest
 * outcome is exactly "claimed, paid what fit".
 */
export async function handleQuestClaim(player: RpgPlayer, data: unknown): Promise<void> {
    const gate = await qualify(player)
    if (!gate.ok) { player.emit?.('quests:state', view(player, gate)); return }

    const id = String((data as { id?: unknown })?.id ?? '')
    const quest = DAILY_QUESTS.find((q) => q.id === id)
    if (!quest) return

    const s = readState(player)
    if (s.claimed.includes(id)) { player.emit?.('quests:state', view(player, gate)); return }
    if ((s.n[quest.counts] ?? 0) < quest.goal) { player.emit?.('quests:state', view(player, gate)); return }

    s.claimed.push(id)
    writeState(player, s)
    const paid = credit(player, 'quest', questReward(quest))
    player.emit?.('quests:claimed', { id, title: quest.title, paid, usd: usdForTokens(paid) })
    player.emit?.('quests:state', view(player, gate))
}

/* ---------------------------------------------------------------- tests ---*/

export function resetQuestGate(player: RpgPlayer): void {
    player.setVariable?.(V_QUEST_GATE, null)
}
