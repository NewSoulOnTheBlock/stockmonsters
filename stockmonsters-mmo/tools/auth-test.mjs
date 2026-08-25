import { privateKeyToAccount } from 'viem/accounts'
const B = 'http://localhost:4131'
const a = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const b = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const nonce = async () => (await (await fetch(B + '/auth/nonce')).json()).nonce
const msg = (addr, n) => `Stockmonsters login\nAddress: ${addr}\nNonce: ${n}`
const post = (body) => fetch(B + '/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let n = await nonce(), m = msg(a.address, n)
let r = await post({ address: a.address, message: m, signature: await a.signMessage({ message: m }) })
const ok1 = await r.json()
console.log('1 honest login     ->', r.status, String(ok1.connectionId).slice(0, 10) + '...')

n = await nonce(); m = msg(a.address, n)
r = await post({ address: a.address, message: m, signature: await a.signMessage({ message: m }) })
const ok2 = await r.json()
console.log('2 stable id        ->', ok2.connectionId === ok1.connectionId ? 'SAME id OK' : 'DIFFERENT FAIL')

n = await nonce(); m = msg(a.address, n)
r = await post({ address: a.address, message: m, signature: await b.signMessage({ message: m }) })
console.log('3 impersonation    ->', r.status, (await r.json()).error ?? 'ACCEPTED FAIL')

r = await post({ address: a.address, message: m, signature: await a.signMessage({ message: m }) })
console.log('4 nonce replay     ->', r.status, (await r.json()).error ?? 'ACCEPTED FAIL')

m = msg(a.address, await nonce())
r = await post({ address: a.address, message: m, signature: '0x' + '11'.repeat(65) })
console.log('5 forged signature ->', r.status, (await r.json()).error ?? 'ACCEPTED FAIL')

n = await nonce(); m = msg(b.address, n)
r = await post({ address: b.address, message: m, signature: await b.signMessage({ message: m }) })
const ok6 = await r.json()
console.log('6 distinct wallets ->', ok6.connectionId !== ok1.connectionId ? 'DIFFERENT OK' : 'COLLIDE FAIL')

m = 'Stockmonsters login\nAddress: ' + a.address + '\nNonce: deadbeef'
r = await post({ address: a.address, message: m, signature: await a.signMessage({ message: m }) })
console.log('7 unknown nonce    ->', r.status, (await r.json()).error ?? 'ACCEPTED FAIL')
