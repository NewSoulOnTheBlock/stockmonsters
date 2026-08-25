/*
 * Wallet login (sign-in-with-Ethereum, minimal).
 *
 * The problem this solves: the room connectionId is chosen by the CLIENT and
 * is what saves key by. If the wallet address were the connectionId directly,
 * anyone could type someone else's address and load their save. So the server
 * never accepts an address as identity — it hands back an opaque id that only
 * it can compute:
 *
 *     connectionId = "w:" + HMAC-SHA256(SERVER_SECRET, lowercased address)
 *
 * Stable per wallet (so saves follow you across devices), unguessable without
 * the secret (so it can't be forged), and it keeps addresses out of room keys.
 *
 * Flow:
 *   GET  /auth/nonce              -> { nonce }
 *   POST /auth/verify {address, message, signature}
 *                                 -> { connectionId, address }
 *
 * The message must contain the nonce; nonces are single-use and expire.
 * SERVER_SECRET must be set in production — a random one is generated at boot
 * otherwise, which simply means saves reset when the process restarts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { verifyMessage } from 'viem'

const SECRET = process.env.SERVER_SECRET ?? randomBytes(32).toString('hex')
if (!process.env.SERVER_SECRET) {
  console.warn('[auth] SERVER_SECRET unset — wallet saves reset on restart')
}

const NONCE_TTL_MS = 5 * 60 * 1000
const nonces = new Map() // nonce -> expiry

function issueNonce() {
  const nonce = randomBytes(16).toString('hex')
  nonces.set(nonce, Date.now() + NONCE_TTL_MS)
  // opportunistic sweep; the map only grows with unused nonces
  if (nonces.size > 5000) {
    const now = Date.now()
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n)
  }
  return nonce
}

function consumeNonce(message) {
  for (const [nonce, exp] of nonces) {
    if (!message.includes(nonce)) continue
    nonces.delete(nonce)
    return exp >= Date.now()
  }
  return false
}

export function connectionIdFor(address) {
  return 'w:' + createHmac('sha256', SECRET).update(address.toLowerCase()).digest('hex').slice(0, 32)
}

/** Constant-time compare of two connection ids (see verifyConnectionId). */
export function verifyConnectionId(address, id) {
  const expected = Buffer.from(connectionIdFor(address))
  const given = Buffer.from(String(id))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

async function readJson(req, limit = 4096) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new Error('payload too large')
  }
  return JSON.parse(body)
}

const json = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** Returns true when it handled the request. */
export async function handleAuth(req, res) {
  const { pathname } = new URL(req.url, 'http://x')

  if (pathname === '/auth/nonce' && req.method === 'GET') {
    json(res, 200, { nonce: issueNonce() })
    return true
  }

  if (pathname === '/auth/verify' && req.method === 'POST') {
    try {
      const { address, message, signature } = await readJson(req)
      if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        json(res, 400, { error: 'bad address' }); return true
      }
      if (typeof message !== 'string' || typeof signature !== 'string') {
        json(res, 400, { error: 'bad payload' }); return true
      }
      if (!consumeNonce(message)) {
        json(res, 401, { error: 'stale or unknown nonce' }); return true
      }
      const ok = await verifyMessage({ address, message, signature })
      if (!ok) { json(res, 401, { error: 'bad signature' }); return true }
      json(res, 200, { connectionId: connectionIdFor(address), address: address.toLowerCase() })
    } catch {
      json(res, 400, { error: 'bad request' })
    }
    return true
  }

  return false
}
