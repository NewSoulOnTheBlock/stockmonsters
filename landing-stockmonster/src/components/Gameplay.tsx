import { ECONOMY } from "@/lib/data";
import { Window } from "./bits";

/* ------------------------------------------------------------------ *
 *  What you actually do, and how the money actually works.
 *
 *  Both blocks exist because the site used to describe a different game:
 *  a single streamed session with limited seats. It is an MMO now — every
 *  player has their own character in one shared world — and it has an
 *  economy attached, which is the part people ask about first.
 *
 *  The numbers all come from `ECONOMY` in lib/data.ts, which mirrors the
 *  deployed contracts. Nothing here is aspirational: if a line cannot be
 *  pointed at a contract or a screen in the game, it is not on this page.
 * ------------------------------------------------------------------ */

type Beat = { n: string; title: string; body: React.ReactNode };

const LOOP: Beat[] = [
  {
    n: "01",
    title: "Walk into a shared world",
    body: (
      <>
        One map of 171 places — a dock, a trading tower, forests, caves, whole
        cities — with every other player walking around in it. Chat, add friends,
        message whoever is standing next to you.
      </>
    ),
  },
  {
    n: "02",
    title: "Catch the market",
    body: (
      <>
        Tickers roam the overworld. Wear one down, throw a ball, and it is yours —
        with the individual values, nature and shiny roll that make it a specific
        creature rather than a copy of its species.
      </>
    ),
  },
  {
    n: "03",
    title: "Mint it, or do not",
    body: (
      <>
        A catch lands in your box. Claiming it as an NFT is optional and costs a
        small fee. It arrives SEALED: what is inside is a commitment on chain, and
        only opening it reveals what you caught. Sealed boxes are sold outright
        too — {ECONOMY.boxUsd[0]}, {ECONOMY.boxUsd[1]} and {ECONOMY.boxUsd[2]},
        the dearer ones with better odds and a higher floor on every stat.
      </>
    ),
  },
  {
    n: "04",
    title: "Fight someone for theirs",
    body: (
      <>
        Duels are blind-pick and settled on chain. Both sides commit a creature
        behind a hash, both stakes lock in the arena contract, and the winner takes
        the pot. Nobody can see your pick or swap it afterwards.
      </>
    ),
  },
];

export function GameplayLoop() {
  return (
    <ol className="grid gap-px bg-line sm:grid-cols-2">
      {LOOP.map((b) => (
        <li key={b.n} className="bg-void p-6 sm:p-7">
          <span className="display block text-[clamp(1.6rem,5vw,2.2rem)] leading-none text-gold tabular-nums">
            {b.n}
          </span>
          <h3 className="mt-3 font-display text-[11px] uppercase leading-relaxed text-bone">
            {b.title}
          </h3>
          <p className="mt-2.5 text-[13px] leading-relaxed text-dim">{b.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */

const EARN: Array<{ title: string; lede: React.ReactNode; note: string }> = [
  {
    title: "Daily quests",
    lede: (
      <>
        {ECONOMY.questCount} of them, refreshed every day: win battles, catch
        something, find a place you have never stood. They pay in {ECONOMY.symbol},
        priced against the dollar rather than fixed in tokens.
      </>
    ),
    note: `The whole board is worth about ${ECONOMY.questBoardUsd} a day`,
  },
  {
    title: "Duels and gyms",
    lede: (
      <>
        Zero-sum, plus a rake. Nothing is created here — a duel moves one player&apos;s
        stake to another, and a gym pays its challengers out of the entry fees they
        chose to pay.
      </>
    ),
    note: "No emissions anywhere in it",
  },
  {
    title: "The marketplace",
    lede: (
      <>
        Sell what you caught, in ETH or {ECONOMY.symbol}. Orders are signed off
        chain and settled on it, and the contract never takes custody of your NFT.
      </>
    ),
    note: `Seller keeps ${ECONOMY.sellerKeepsPercent}% — ${ECONOMY.marketFeePercent}% protocol, ${ECONOMY.royaltyPercent}% royalty`,
  },
  {
    title: "Trading tax, bought back",
    lede: (
      <>
        Buying or selling {ECONOMY.symbol} carries a {ECONOMY.taxPercent}% tax;
        moving it between wallets is free. What it collects reaches the treasury,
        which spends {ECONOMY.taxToPlayersPercent}% of everything it receives
        buying {ECONOMY.symbol} on the open market — and every token it buys goes
        to the reward pool.
      </>
    ),
    note: `The players' share cannot be set below ${ECONOMY.minPlayerSharePercent}%`,
  },
];

export function PlayToEarn() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:gap-12">
      <div className="grid gap-px bg-line sm:grid-cols-2">
        {EARN.map((e) => (
          <div key={e.title} className="bg-void p-6">
            <h3 className="font-display text-[11px] uppercase leading-relaxed text-gold">
              {e.title}
            </h3>
            <p className="mt-2.5 text-[13px] leading-relaxed text-dim">{e.lede}</p>
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-snug text-dimmer">
              {e.note}
            </p>
          </div>
        ))}
      </div>

      <Window arrow={false} className="self-start">
        <h3 className="font-display text-[11px] uppercase leading-relaxed text-gold">
          The rule underneath all of it
        </h3>
        <p className="serif-lede mt-4 text-[clamp(1.15rem,3vw,1.5rem)] italic leading-[1.25] text-bone">
          The game never mints.
        </p>
        <p className="mt-4 text-[13px] leading-relaxed text-dim">
          {ECONOMY.symbol} has a fixed supply of {ECONOMY.supply} and no mint
          function — not a policy, an absence. Every reward is therefore a claim on
          a pool that already exists, refilled by the treasury spending half of all
          revenue buying the token back off the market and into that pool.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-dim">
          That is the difference between a game economy and a countdown. There is
          no faucet to turn off, because there is no faucet.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-px border-t border-line bg-line pt-px">
          {[
            ["Supply", ECONOMY.supply],
            ["Mint function", "none"],
            ["Wallet to wallet", "0% tax"],
            ["Live on", ECONOMY.network],
          ].map(([k, v]) => (
            <div key={k} className="bg-void px-3 py-3">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-dimmer">{k}</dt>
              <dd className="mt-1 font-display text-[11px] leading-snug text-bone">{v}</dd>
            </div>
          ))}
        </dl>
      </Window>
    </div>
  );
}
