import { describe, it, expect } from 'vitest'
import {
  bubbleText,
  bubbleMs,
  BUBBLE_MAX_CHARS,
  BUBBLE_MIN_MS,
  BUBBLE_MAX_MS,
} from './chat-bubbles'

/*
 * The two decisions a speech bubble makes before it is drawn: what it says and
 * how long it stays. Both are pure, so they are checked here; that the box
 * lands over the right character is a rendering claim and is checked in a real
 * browser (tools/e2e-chat-bubble.mjs).
 */

describe('what the bubble says', () => {
  it('leaves an ordinary line alone', () => {
    expect(bubbleText('meet me at the dock')).toBe('meet me at the dock')
  })

  it('collapses newlines and runs of spaces', () => {
    expect(bubbleText('  hello   there\nfriend ')).toBe('hello there friend')
  })

  it('cuts a long message rather than papering the map with it', () => {
    const long = 'a'.repeat(200)
    const out = bubbleText(long)
    expect(out.length).toBe(BUBBLE_MAX_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })

  it('is empty for anything that is not a string', () => {
    // The payload comes off a socket: a number, or nothing at all, must not
    // become the string "undefined" over somebody's head.
    expect(bubbleText(undefined)).toBe('')
    expect(bubbleText(42)).toBe('')
    expect(bubbleText('   ')).toBe('')
  })
})

describe('how long it stays', () => {
  it('gives a long line more time than a short one', () => {
    expect(bubbleMs('hi')).toBeLessThan(bubbleMs('a much longer sentence than that one'))
  })

  it('never drops below the time it takes to notice it', () => {
    expect(bubbleMs('')).toBeGreaterThanOrEqual(BUBBLE_MIN_MS)
  })

  it('never parks a box on the map', () => {
    // 140 is the server's own chat cap (chat-filter CHAT_MAX).
    expect(bubbleMs('x'.repeat(140))).toBe(BUBBLE_MAX_MS)
  })
})
