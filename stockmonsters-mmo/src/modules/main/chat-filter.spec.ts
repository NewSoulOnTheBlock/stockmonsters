import { describe, it, expect } from 'vitest'
import { filterChat } from './chat-filter'
import { validateName } from './names'

const blocked = (s: string) => filterChat(s).ok === false
const allowed = (s: string) => filterChat(s).ok === true

describe('chat filter — legitimate messages get through', () => {
    it.each([
        'hey anyone want to trade?',
        'I caught a shiny Nvidrake!',
        'meet me at the dock in 5',
        'my team is level 20 now',
        'lol that battle was close',
        'who wants to co-op?',
        'GG well played',
        'is the cave worth it?',
        // words that merely contain a TLD substring must not trip the filter
        'welcome to the arena',
        'that was income for sure',
        'I am going to the shopping district',
    ])('allows %j', (msg) => expect(allowed(msg)).toBe(true))
})

describe('chat filter — contract addresses', () => {
    it.each([
        'buy 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
        '0x aF3D 76f1 834A 1d42',
        '0x-aF3D-76f1-834A-1d42',
        '0x.aF3D.76f1.834A.1d42',
        'ca: 0xaF3D76f1834A1d4257',
        // Solana-style base58
        '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    ])('blocks %j', (msg) => expect(blocked(msg)).toBe(true))
})

describe('chat filter — links and evasion', () => {
    it.each([
        'check example.com',
        'check example . com',
        'check example d o t com',
        'check example(dot)com',
        'visit https://scam.xyz',
        'www.freemoney.io',
        't.me/scamgroup',
        'discord.gg/abc',
        'go to pump . fun',
        'e x a m p l e . c o m',
        'ex​ample.com', // zero-width space
        'ｅxample.com', // fullwidth homoglyph
        'exampl3.c0m', // leetspeak
    ])('blocks %j', (msg) => expect(blocked(msg)).toBe(true))

    /*
     * The other half of the job, and the half that was broken.
     *
     * Squashing removes every separator, so a sentence becomes one run and any
     * run ending in a two-letter TLD reads as a domain. English is full of
     * them, and the leet folding makes it worse: 3 folds to e, so "spam 3"
     * became "spame" — "spa" plus ".me" — and was refused as a link. Two real
     * players hit this while simply talking to each other.
     */
    it.each([
        'call me',
        'text me when you are on',
        'trust me',
        'spam 3',
        'go to the shop',
        'that one is mine',
        'meet me at the dock',
        'i will buy nft box',
        'click boxes bottom menu',
        'hey',
        'good luck in the duel',
    ])('lets %j through', (msg) => expect(blocked(msg)).toBe(false))
})

describe('chat filter — basics', () => {
    it('rejects empty and whitespace-only', () => {
        expect(blocked('')).toBe(true)
        expect(blocked('   ')).toBe(true)
    })
    it('rejects over-long messages', () => {
        expect(blocked('a'.repeat(200))).toBe(true)
    })
    it('strips invisible padding but keeps the text', () => {
        const r = filterChat('hel​lo there')
        expect(r.ok && r.text).toBe('hello there')
    })
})

describe('player names', () => {
    it('accepts ordinary names', () => {
        expect(validateName('Koray')).toEqual({ name: 'Koray' })
        expect(validateName('  big_trader  ')).toEqual({ name: 'big_trader' })
        expect(validateName('Moon Boy')).toEqual({ name: 'Moon Boy' })
    })
    it('rejects too short, too long, and empty', () => {
        expect(validateName('ab')).toHaveProperty('error')
        expect(validateName('a'.repeat(20))).toHaveProperty('error')
        expect(validateName('')).toHaveProperty('error')
    })
    it('rejects reserved and impersonating names', () => {
        expect(validateName('admin')).toHaveProperty('error')
        expect(validateName('System')).toHaveProperty('error')
    })
    it('rejects links and addresses as names', () => {
        expect(validateName('buy0xaF3D76f1')).toHaveProperty('error')
        expect(validateName('scam_com')).toHaveProperty('error')
    })
    it('rejects non-ascii lookalikes', () => {
        expect(validateName('Kоray')).toHaveProperty('error') // Cyrillic о
        expect(validateName('___')).toHaveProperty('error')
    })
})
