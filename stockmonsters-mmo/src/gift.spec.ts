import { describe, it, expect } from 'vitest'
import { encodeFunctionData, parseAbi, toFunctionSelector, parseUnits as viemParseUnits } from 'viem'
import { encodeTransfer, TRANSFER_SELECTOR, parseUnits } from './wallet-ui'

/*
 * Gifting the game token to another player.
 *
 * The SEND TOKEN button sent ether for its whole life — in a game whose token
 * is SMON, a mislabelled feature rather than a missing one. This is the ERC-20
 * path behind it.
 *
 * Calldata is hand-encoded so viem stays out of the browser bundle, which means
 * the encoding has to be checked against viem HERE instead. A wrong word is not
 * a revert with a useful message; it is a transfer to the wrong address, or of
 * the wrong amount, and it cannot be undone.
 */

const ERC20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])
const TO = '0x1234567890AbcdEF1234567890aBcdef12345678'

describe('the transfer calldata', () => {
    it('uses the real selector', () => {
        expect(TRANSFER_SELECTOR).toBe(toFunctionSelector('transfer(address,uint256)'))
    })

    it('matches viem byte for byte', () => {
        for (const amount of ['1', '1000', '1000000000000000000', '999999999999999999999999']) {
            expect(encodeTransfer(TO, amount)).toBe(
                encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [TO, BigInt(amount)] }),
            )
        }
    })

    it('left-pads the address rather than truncating it', () => {
        // The classic hand-encoding bug: an address is 20 bytes in a 32-byte
        // word, and getting the alignment wrong sends the money somewhere that
        // is still a valid address.
        const data = encodeTransfer(TO, '1')
        expect(data.slice(10, 10 + 24)).toBe('0'.repeat(24))
        expect(data.slice(34, 74).toLowerCase()).toBe(TO.slice(2).toLowerCase())
    })

    it('is exactly a selector and two words', () => {
        expect(encodeTransfer(TO, '1').length).toBe(2 + 8 + 64 * 2)
    })
})

describe('reading an amount the player typed', () => {
    it('agrees with viem at 18 decimals', () => {
        for (const text of ['1', '0.5', '1000', '0.000000000000000001', '123.456']) {
            expect(parseUnits(text, 18)).toBe(viemParseUnits(text, 18).toString())
        }
    })

    it('honours a token that is not 18 decimals', () => {
        // Assuming 18 for a 6-decimal token is a factor of a million in
        // somebody's gift, which is why the decimals are read off the token.
        expect(parseUnits('1', 6)).toBe('1000000')
        expect(parseUnits('1.5', 6)).toBe('1500000')
        expect(parseUnits('1', 0)).toBe('1')
    })

    it('drops digits past the token\'s precision instead of inventing units', () => {
        expect(parseUnits('1.9999999', 2)).toBe('199')
    })

    it('refuses anything that is not a positive number', () => {
        for (const bad of ['', ' ', '.', '0', '0.0', '-1', 'abc', '1e18', '1,5', '0x10']) {
            expect(parseUnits(bad, 18)).toBeNull()
        }
    })

    it('never returns NaN units for a silly decimals value', () => {
        expect(parseUnits('1', Number.NaN)).toBe('1000000000000000000')
        expect(parseUnits('1', -3)).toBe('1000000000000000000')
    })
})
