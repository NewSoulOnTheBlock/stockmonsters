/*
 * Unit tests for the client-safe half of persistence.
 *
 * The point of profile.ts is that it works with NOTHING behind it — that is
 * what runs in the browser, in `vite dev`, and on a server started without
 * DATABASE_URL. So most of this file asserts on the no-op path.
 *
 * It also stands as a guard on the boundary: this suite runs in vitest's plain
 * node environment with no `pg` available, so if anyone ever adds a database
 * import to profile.ts, these tests stop importing it at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VARS,
  __resetTracking,
  applyInventory,
  collectState,
  hasProfileStore,
  profileCharacter,
  profiles,
  syncPlayer,
  trackPlayer,
  untrackPlayer,
  type PlayerLike,
  type ProfilePatch,
  type StoredProfile,
} from './profile'

/** A stand-in for RpgPlayer: profile.ts only needs get/setVariable. */
function fakePlayer(initial: Record<string, unknown> = {}): PlayerLike & { vars: Map<string, unknown> } {
  const vars = new Map(Object.entries(initial))
  return {
    vars,
    getVariable: (k) => vars.get(k),
    setVariable: (k, v) => void vars.set(k, v),
  }
}

function fakeStore() {
  const saves: Array<{ walletId: string; patch: ProfilePatch }> = []
  const released: string[] = []
  return {
    saves,
    released,
    enabled: true,
    loadProfile: vi.fn(async () => null),
    saveProfile: (walletId: string, patch: ProfilePatch) => void saves.push({ walletId, patch }),
    claimName: vi.fn(async (_id: string, name: string) => ({ ok: true as const, name })),
    release: async (walletId: string) => void released.push(walletId),
  }
}

const WALLET = 'w:' + 'a'.repeat(32)

const emptyProfile = (over: Partial<StoredProfile> = {}): StoredProfile => ({
  walletId: WALLET,
  address: null,
  name: null,
  character: null,
  party: null,
  box: null,
  bag: null,
  version: 1,
  ...over,
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__smProfiles
  __resetTracking()
  vi.useRealTimers()
})

describe('the missing-store fallback', () => {
  it('reports that there is no store', () => {
    expect(hasProfileStore()).toBe(false)
    expect(profiles().enabled).toBe(false)
  })

  it('loads nothing rather than throwing', async () => {
    await expect(profiles().loadProfile(WALLET)).resolves.toBeNull()
  })

  it('saving is a silent no-op — a game handler must never see a throw', () => {
    expect(() => profiles().saveProfile(WALLET, { party: [{ a: 1 }] })).not.toThrow()
  })

  it('still lets a player have a name', async () => {
    // No database means no global registry; refusing every name would be a
    // worse failure than allowing a duplicate.
    await expect(profiles().claimName(WALLET, 'Trader Joe')).resolves.toEqual({
      ok: true,
      name: 'Trader Joe',
    })
  })

  it('ignores an injected object that is not a store', () => {
    ;(globalThis as Record<string, unknown>).__smProfiles = { nonsense: true }
    expect(hasProfileStore()).toBe(false)
  })
})

describe('the injected store', () => {
  it('is picked up from the global', () => {
    const store = fakeStore()
    ;(globalThis as Record<string, unknown>).__smProfiles = store
    expect(hasProfileStore()).toBe(true)
    expect(profiles()).toBe(store)
  })
})

describe('collectState', () => {
  it('reads exactly the persistable variables', () => {
    const player = fakePlayer({
      [VARS.character]: ['ch-female-01'],
      [VARS.party]: [{ dbSymbol: 'applion', level: 9 }],
      [VARS.box]: [{ dbSymbol: 'nvidrake', level: 4 }],
      [VARS.bag]: { balls: 4, potions: 2 },
      [VARS.walletAddress]: '0x' + '11'.repeat(20),
      SPAWNED: true, // not persistable: it is per-session
    })
    const patch = collectState(player)
    expect(patch).toEqual({
      character: ['ch-female-01'],
      party: [{ dbSymbol: 'applion', level: 9 }],
      box: [{ dbSymbol: 'nvidrake', level: 4 }],
      bag: { balls: 4, potions: 2 },
      address: '0x' + '11'.repeat(20),
    })
    expect('SPAWNED' in patch).toBe(false)
  })

  it('omits absent keys instead of sending undefined', () => {
    // A patch full of undefined would blank a stored party the moment a fresh
    // socket connected — this is the guard against that.
    expect(collectState(fakePlayer())).toEqual({})
  })

  it('drops values of the wrong shape', () => {
    const player = fakePlayer({
      [VARS.character]: ['', 'ok'], // an empty graphic id renders nothing
      [VARS.bag]: { balls: 'lots' },
      [VARS.party]: 'not a list',
    })
    expect(collectState(player)).toEqual({})
  })

  it('keeps an empty party — that is real state, not a missing value', () => {
    expect(collectState(fakePlayer({ [VARS.party]: [] }))).toEqual({ party: [] })
  })
})

describe('applyInventory', () => {
  it('writes party, box and bag into the player', () => {
    const player = fakePlayer()
    const restored = applyInventory(
      player,
      emptyProfile({
        party: [{ dbSymbol: 'applion' }],
        box: [{ dbSymbol: 'nvidrake' }, { dbSymbol: 'teslazar' }],
        bag: { balls: 7, potions: 1 },
      }),
    )
    expect(player.vars.get(VARS.party)).toEqual([{ dbSymbol: 'applion' }])
    expect(player.vars.get(VARS.box)).toHaveLength(2)
    expect(player.vars.get(VARS.bag)).toEqual({ balls: 7, potions: 1 })
    expect(restored).toEqual(['party:1', 'box:2', 'bag'])
  })

  it('leaves the player untouched when the profile is empty', () => {
    const player = fakePlayer({ [VARS.party]: [{ dbSymbol: 'keep-me' }] })
    expect(applyInventory(player, emptyProfile())).toEqual([])
    expect(player.vars.get(VARS.party)).toEqual([{ dbSymbol: 'keep-me' }])
  })

  it('does not overwrite a live party with a stored empty one', () => {
    // An empty stored party means "never played", not "lost everything".
    const player = fakePlayer({ [VARS.party]: [{ dbSymbol: 'starter' }] })
    applyInventory(player, emptyProfile({ party: [] }))
    expect(player.vars.get(VARS.party)).toEqual([{ dbSymbol: 'starter' }])
  })
})

describe('profileCharacter', () => {
  it('accepts a well formed id array', () => {
    expect(profileCharacter(emptyProfile({ character: ['hero'] }))).toEqual(['hero'])
  })

  it('rejects anything that would render the player invisible', () => {
    expect(profileCharacter(emptyProfile({ character: [] }))).toBeNull()
    expect(profileCharacter(emptyProfile({ character: [''] as string[] }))).toBeNull()
    expect(profileCharacter(emptyProfile())).toBeNull()
  })
})

describe('background sync', () => {
  it('does not start a timer when there is no store', () => {
    vi.useFakeTimers()
    trackPlayer(WALLET, fakePlayer({ [VARS.party]: [{ a: 1 }] }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sweeps tracked players into the store on a timer', () => {
    vi.useFakeTimers()
    const store = fakeStore()
    ;(globalThis as Record<string, unknown>).__smProfiles = store
    const player = fakePlayer({ [VARS.bag]: { balls: 1, potions: 1 } })
    trackPlayer(WALLET, player)
    expect(store.saves).toHaveLength(0)

    // A battle mutates the bag; nobody calls save.
    player.vars.set(VARS.bag, { balls: 0, potions: 1 })
    vi.advanceTimersByTime(5000)
    expect(store.saves.at(-1)).toEqual({ walletId: WALLET, patch: { bag: { balls: 0, potions: 1 } } })
  })

  it('final-saves and releases on disconnect, and stops the timer', async () => {
    vi.useFakeTimers()
    const store = fakeStore()
    ;(globalThis as Record<string, unknown>).__smProfiles = store
    const player = fakePlayer({ [VARS.party]: [{ dbSymbol: 'applion' }] })
    trackPlayer(WALLET, player)
    expect(vi.getTimerCount()).toBe(1)

    await untrackPlayer(WALLET)
    expect(store.saves.at(-1)?.patch).toEqual({ party: [{ dbSymbol: 'applion' }] })
    expect(store.released).toEqual([WALLET])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tracking the same wallet twice keeps one timer', () => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).__smProfiles = fakeStore()
    trackPlayer(WALLET, fakePlayer())
    trackPlayer(WALLET, fakePlayer())
    expect(vi.getTimerCount()).toBe(1)
  })

  it('syncPlayer pushes the current state immediately', () => {
    const store = fakeStore()
    ;(globalThis as Record<string, unknown>).__smProfiles = store
    syncPlayer(WALLET, fakePlayer({ [VARS.box]: [{ dbSymbol: 'caught' }] }))
    expect(store.saves).toEqual([{ walletId: WALLET, patch: { box: [{ dbSymbol: 'caught' }] } }])
  })

  it('untracking an unknown wallet is harmless', async () => {
    await expect(untrackPlayer('w:' + 'b'.repeat(32))).resolves.toBeUndefined()
  })
})
