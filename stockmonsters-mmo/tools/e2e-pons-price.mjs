/*
 * e2e-pons-price.mjs — prove the live price path against the real chain.
 *
 * The game's token does not exist yet, so the thing that has to be proved
 * BEFORE it does is the mechanism: that a pons launch record can be read, that
 * a v4 PoolKey built from it hashes to a pool the singleton actually holds,
 * and that the sqrtPriceX96 in that pool turns into a dollar price that
 * matches what the chain would really trade at.
 *
 * So this script goes and finds somebody else's launch. It indexes
 * TokenLaunched off the pons factory, splits the results into graduated and
 * still-on-the-curve, and prices one of each — then cross-checks the graduated
 * one against the Uniswap v4 Quoter, which is an INDEPENDENT answer: the
 * quoter simulates a real swap through the pool instead of reading a number
 * out of storage. Spot must sit between what a buy pays and what a sell gets,
 * because the difference is the fee. If it does not, the arithmetic is wrong.
 *
 *   node tools/e2e-pons-price.mjs
 *   node --env-file-if-exists=.env tools/e2e-pons-price.mjs   # also prices ours
 *   SPAN=50000 node tools/e2e-pons-price.mjs                  # widen the index
 */
import { createPublicClient, http, defineChain } from 'viem'
import {
    PONS, TOKEN_LAUNCHED_TOPIC, LAUNCHED_TOKEN_ABI, STATE_VIEW_ABI,
    createPriceOracle, poolKeyFor, priceFromSqrtPriceX96,
} from '../price-oracle.mjs'

const RPC = process.env.SM_PONS_RPC_URL || PONS.rpcUrl
const SPAN = Number(process.env.SPAN ?? 10_000)
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }
const usd = (n) => n === null || n === undefined ? 'n/a' : '$' + (n < 0.01 ? n.toExponential(4) : n.toFixed(2))

const chain = defineChain({
    id: PONS.chainId, name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
})
const client = createPublicClient({ chain, transport: http(RPC) })

/* ------------------------------------------------------------ the chain --*/
console.log(`\npons on ${RPC}`)
const id = await client.getChainId()
const head = await client.getBlockNumber()
check(`chain id is ${PONS.chainId}`, id === PONS.chainId, String(id))
console.log(`  head block ${head}`)
for (const [name, address] of Object.entries({
    factory: PONS.factory, stateView: PONS.stateView, poolManager: PONS.poolManager,
    quoter: PONS.quoter, hook: PONS.hook,
})) {
    const code = await client.getBytecode({ address })
    check(`${name} has code`, Boolean(code) && code !== '0x', `${address} ${((code?.length ?? 2) - 2) / 2}b`)
}

/* -------------------------------------------------- find somebody's launch */
console.log(`\nindexing TokenLaunched over the last ${SPAN} blocks`)
const logs = await client.getLogs({
    address: PONS.factory, fromBlock: head - BigInt(SPAN), toBlock: head,
})
const launched = [...new Set(logs.filter((l) => l.topics[0] === TOKEN_LAUNCHED_TOPIC)
    .map((l) => '0x' + l.topics[1].slice(26)))]
check('the factory launched tokens in that window', launched.length > 0, `${launched.length} tokens`)

const ERC20 = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }]
const graduated = []
const onCurve = []
for (const token of launched) {
    const record = await client.readContract({
        address: PONS.factory, abi: LAUNCHED_TOKEN_ABI, functionName: 'getLaunchedToken', args: [token],
    })
    if (!record.exists) continue
    if (BigInt(record.pairToken) !== 0n) continue  // not an ETH pair; we cannot price it in dollars
    const { poolId, tokenIsCurrency0 } = poolKeyFor(record)
    const slot0 = await client.readContract({
        address: PONS.stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId],
    })
    const symbol = await client.readContract({ address: token, abi: ERC20, functionName: 'symbol' }).catch(() => '???')
    const row = { token, symbol, record, poolId, tokenIsCurrency0, sqrtPriceX96: slot0[0], tick: slot0[1] }
    if (slot0[0] > 0n) graduated.push(row); else onCurve.push(row)
}
console.log(`  ${graduated.length} graduated (a live v4 pool), ${onCurve.length} still on their bonding curve`)
check('at least one graduated pons pool exists to price', graduated.length > 0)

/* ------------------------------------------------------- price a real pool */
for (const row of graduated.slice(0, 3)) {
    console.log(`\n${row.symbol}  ${row.token}`)
    console.log(`  phase ${row.record.phase}  fee ${row.record.poolFee}  tickSpacing ${row.record.tickSpacing}`)
    console.log(`  poolId ${row.poolId}`)
    console.log(`  sqrtPriceX96 ${row.sqrtPriceX96}   tick ${row.tick}`)

    const liquidity = await client.readContract({
        address: PONS.stateView, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [row.poolId],
    })
    check('the pool holds liquidity', liquidity > 0n, String(liquidity))

    const oracle = createPriceOracle({ token: row.token })
    const snap = await oracle.refresh()
    console.log(`  ETH/USD ${usd(snap.ethUsd)} from ${snap.ethUsdSource}`)
    console.log(`  price   ${snap.tokenEth} ETH  = ${Math.round(snap.tokenEth * 1e18)} wei  per token`)
    console.log(`  price   ${usd(snap.tokenUsd)} per token, from the ${snap.tokenPriceSource}`)
    console.log(`  market cap ${(snap.tokenEth * 1e9).toFixed(4)} ETH = ${usd(snap.tokenUsd * 1e9)} at a billion supply`)
    check('the oracle priced it off the pool', snap.tokenPriceSource === 'pool', snap.lastError ?? '')

    /* slot0 carries the price TWICE, in two unrelated encodings: sqrtPriceX96
     * as a Q64.96 fixed point, and `tick` as a base-1.0001 logarithm. Deriving
     * the price from the tick is arithmetic that shares no line of code with
     * `priceFromSqrtPriceX96`, so agreeing to a tick's width (1bp) means the
     * fixed-point conversion, the inversion and the decimals are all right.
     * Read in the SAME call as the price: these pools trade, and comparing two
     * reads seconds apart compares two different markets. */
    const detail = await oracle.readTokenEth()
    const perCurrency0 = 1.0001 ** detail.tick
    const fromTick = detail.tokenIsCurrency0 ?? row.tokenIsCurrency0 ? perCurrency0 : 1 / perCurrency0
    check('the tick in slot0 implies the same price as its sqrtPriceX96',
        Math.abs(detail.price / fromTick - 1) < 1e-4,
        `tick ${detail.tick} -> ${fromTick.toExponential(6)} vs ${detail.price.toExponential(6)}`)

    /* ---- the independent answer: simulate a swap instead of reading storage */
    const POOL_KEY = {
        name: 'poolKey', type: 'tuple', components: [
            { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
        ],
    }
    const QUOTER_ABI = [{
        type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
        inputs: [{
            name: 'params', type: 'tuple', components: [
                POOL_KEY, { name: 'zeroForOne', type: 'bool' },
                { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' },
            ],
        }],
        outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
    }]
    const { key } = poolKeyFor(row.record)
    const quote = async (zeroForOne, exactAmount) => {
        const { result } = await client.simulateContract({
            address: PONS.quoter, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle',
            args: [{ poolKey: key, zeroForOne, exactAmount, hookData: '0x' }],
        })
        return result[0]
    }
    try {
        const IN_ETH = 10n ** 16n            // 0.01 ETH in
        const IN_TOKENS = 10n ** 24n         // 1,000,000 tokens in
        const tokensOut = await quote(!row.tokenIsCurrency0, IN_ETH)
        const ethOut = await quote(row.tokenIsCurrency0, IN_TOKENS)
        const buyPrice = Number(IN_ETH) / Number(tokensOut)     // ETH paid per token
        const sellPrice = Number(ethOut) / Number(IN_TOKENS)    // ETH received per token
        console.log(`  quoter: 0.01 ETH buys ${(Number(tokensOut) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 })} tokens  (${buyPrice.toExponential(5)} ETH each)`)
        console.log(`  quoter: 1,000,000 tokens sell for ${(Number(ethOut) / 1e18).toExponential(5)} ETH  (${sellPrice.toExponential(5)} ETH each)`)
        check('spot sits between the sell and the buy, as a fee implies',
            snap.tokenEth > sellPrice && snap.tokenEth < buyPrice,
            `${sellPrice.toExponential(5)} < ${snap.tokenEth.toExponential(5)} < ${buyPrice.toExponential(5)}`)
    } catch (e) {
        check('the quoter cross-check ran', false, String(e.shortMessage ?? e.message).slice(0, 160))
    }
}

/* ------------------------------------------------ and one still on a curve */
if (onCurve.length) {
    const row = onCurve[0]
    console.log(`\n${row.symbol}  ${row.token}  (not graduated — bonding curve)`)
    const oracle = createPriceOracle({ token: row.token })
    const snap = await oracle.refresh()
    console.log(`  curve ${row.record.curve}  phase ${row.record.phase}`)
    console.log(`  price ${snap.tokenEth} ETH = ${Math.round(snap.tokenEth * 1e18)} wei per token, from the ${snap.tokenPriceSource}`)
    console.log(`  ${usd(snap.tokenUsd)} per token, market cap ${usd(snap.tokenUsd * 1e9)}`)
    check('a token that has not graduated is still priced', snap.tokenPriceSource === 'curve', snap.lastError ?? '')
    check('and it is priced off the curve, not off an empty pool', row.sqrtPriceX96 === 0n)
}

/* ----------------------------------------------------- the fallback path --*/
console.log('\nwhen the chain cannot be reached')
{
    const dead = createPriceOracle({
        token: graduated[0]?.token ?? onCurve[0]?.token ?? PONS.factory,
        client: { readContract: async () => { throw new Error('RPC down') } },
        fetch: async () => { throw new Error('no network') },
        env: { SM_TOKEN_USD: '0.0002', SM_ETH_USD: '3000' },
        log: { warn: (m) => console.log('   ', m) },
    })
    const snap = await dead.refresh()
    check('it falls back to SM_TOKEN_USD and says so', snap.tokenPriceSource === 'env' && snap.tokenUsd === 0.0002)
    const naked = createPriceOracle({
        token: PONS.factory,
        client: { readContract: async () => { throw new Error('RPC down') } },
        fetch: async () => { throw new Error('no network') },
        env: {},
        log: { warn: () => {} },
    })
    const bare = await naked.refresh()
    check('with no fallback configured it reports no price at all rather than guessing',
        bare.tokenUsd === null && bare.tokenPriceSource === null)
}

/* -------------------------------------------------------------- our token */
const ours = process.env.SM_PRICE_TOKEN_ADDRESS || process.env.SM_TOKEN_ADDRESS
if (ours) {
    console.log(`\nthe game's own token ${ours}`)
    const oracle = createPriceOracle()
    const snap = await oracle.refresh()
    if (!snap.enabled) {
        // Not a failure: SM_TOKEN_ADDRESS is still the Sepolia deployment, and
        // the pons factory would answer about it confidently and emptily.
        console.log(`  not on the pons chain (SM_CHAIN_ID=${process.env.SM_CHAIN_ID}), so it is priced from SM_TOKEN_USD.`)
        console.log('  Set SM_PRICE_TOKEN_ADDRESS to price it here before the rest of the game moves chains.')
    } else {
        console.log(`  source ${snap.tokenPriceSource}  ${usd(snap.tokenUsd)} per token`)
        if (snap.lastError) console.log(`  lastError: ${snap.lastError}`)
    }
} else {
    console.log('\nSM_TOKEN_ADDRESS is unset — nothing of ours to price yet, which is the expected state before launch')
}

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
