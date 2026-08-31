import Link from "next/link";
import { BattleScene } from "@/components/BattleScene";
import { ContractAddress } from "@/components/ContractAddress";
import { Ledger } from "@/components/Ledger";
import { MemeWingTeaser } from "@/components/MemeWing";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { GameplayLoop, PlayToEarn } from "@/components/Gameplay";
import { StarterSelect } from "@/components/StarterSelect";
import { TickerTape } from "@/components/TickerTape";
import { TypeChart } from "@/components/TypeChart";
import { PixelHorizon, PlayButton, SectionHead, Window } from "@/components/bits";
import { CREATURES, ECONOMY, MEMES, PLAY_URL, TYPES } from "@/lib/data";

const FACTS: Array<[string, string, string]> = [
  [String(CREATURES.length), "stockmonsters", "one per listed ticker"],
  [String(TYPES.length), "elements", "with a full effectiveness chart"],
  [String(MEMES.length), "meme coins", "in the side wing"]
];

const FAQ: Array<[string, React.ReactNode]> = [
  [
    "So what actually is this?",
    <>
      A monster-collecting RPG in the old handheld style, except the roster is the US
      stock market. Every one of the {CREATURES.length} tickers has been redrawn as a
      creature with its own name, elemental typing, base stats and dex entry. Apple is a
      blossom-maned lion. NVIDIA is a dragon that gets hungrier the harder it thinks.
    </>,
  ],
  [
    "Do I need to install anything?",
    <>
      No. It runs in the browser and on a phone, with on-screen controls. It is a real
      multiplayer world rather than a stream of one — everybody has their own character,
      and you will walk past other people playing.
    </>,
  ],
  [
    "Do I need a wallet?",
    <>
      Yes, to play. Connecting one is how the game knows who you are: your name, your
      party and where you were standing all live server-side against your wallet, so you
      can close the tab and come back, or sign in from another machine, and pick up where
      you left off. Signing in is a signature, never a transaction.
    </>,
  ],
  [
    "Is any of this real money yet?",
    <>
      Yes. {ECONOMY.symbol} is deployed on {ECONOMY.network} and trading on its
      bonding curve, and the world it pays out in is live and playable now. There is
      exactly one contract address and it is in the pill at the top of this page, with
      a link to it on the explorer — check it there rather than taking anyone&apos;s
      word for it, including ours.
    </>,
  ],
  [
    "Where do the numbers come from?",
    <>
      Names, species lines, dex flavour and elemental types come from the project&apos;s
      own data files. Base stats, height and weight are read straight out of the game
      engine&apos;s creature definitions — they are the numbers the battles actually use.
      The percentages on the ticker tape are decoration: a fixed hash of each contract
      address, never a market quote.
    </>,
  ],
  [
    "Where does the reward money come from?",
    <>
      A pool that already exists. {ECONOMY.symbol} has a fixed supply and no mint
      function, so nothing the game pays out is newly created. The pool is refilled
      instead: revenue — the {ECONOMY.taxPercent}% trading tax, claim fees, box sales,
      marketplace fees — lands in the treasury, which splits everything it receives in
      half. One half is spent buying {ECONOMY.symbol} on the open market and every
      token bought goes to the reward pool; the other half funds operations. Duels and
      gyms pay out of stakes and entry fees, so they need no pool at all.
    </>,
  ],
  [
    "Is this financial advice?",
    <>
      It is a pixel-art dragon named after a graphics-card company. It is not financial
      advice, it is not affiliated with any of the companies whose tickers appear, and
      the tickers are used as parody subject matter. Please do not make portfolio
      decisions based on type coverage.
    </>,
  ],
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ============================== HERO ============================== */}
        <section className="relative isolate overflow-hidden">
          {/* pixel Wall St horizon, tiled at integer scale */}
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute inset-0 grid-floor opacity-25" />
            <PixelHorizon />
            {/* keep the copy legible where it crosses the skyline */}
            <div className="absolute inset-0 bg-gradient-to-r from-void via-void/55 to-transparent lg:via-void/35" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-void to-transparent" />
          </div>

          <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:gap-14 lg:pb-24 lg:pt-24">
            <div className="animate-rise">
              <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-gold">LEDGER v1.0</span>
                <span className="text-dimmer">/</span>
                <span>{CREATURES.length} listed</span>
                <span className="text-dimmer">/</span>
                <span>{TYPES.length} elements</span>
              </p>

              <h1 className="display mt-5 text-[clamp(2.6rem,10vw,6rem)] hard-shadow">
                <span className="block text-gold">STOCK</span>
                <span className="block text-bone">MONSTERS</span>
              </h1>

              <p className="serif-lede mt-6 max-w-xl text-[clamp(1.35rem,4.2vw,2rem)] italic leading-[1.15] text-bone">
                The market, except you can catch it.
              </p>

              <p className="mt-5 max-w-xl text-[14px] leading-relaxed text-dim sm:text-[15px]">
                {CREATURES.length} US tickers redrawn as collectible monsters, each with an
                elemental typing, a real stat line and a dex entry. Apple is a lion. NVIDIA
                is a dragon. Tesla runs on the tide. Catch them in a shared world, mint the
                ones you keep, and fight other traders for theirs.
              </p>

              <ContractAddress className="mt-8" />

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <PlayButton big label="Play now" />
                <Link
                  href="#ledger"
                  className="group inline-flex items-center gap-2 font-display text-[11px] uppercase text-bone transition-colors hover:text-gold"
                >
                  Open the ledger
                  <span className="transition-transform group-hover:translate-y-0.5">↓</span>
                </Link>
              </div>

              <p className="mt-4 max-w-md text-[11px] leading-relaxed text-dimmer">
                Runs in the browser and on a phone — nothing to install. Connect a wallet
                and your trainer follows you to any device. Live on {ECONOMY.network}.
              </p>
            </div>

            <div className="animate-rise [animation-delay:120ms]">
              <BattleScene foe="NVDA" ally="AAPL" />
              <p className="mt-3 text-center text-[10px] uppercase tracking-[0.2em] text-dimmer">
                Not a mockup — that is the roster
              </p>
            </div>
          </div>
        </section>

        <TickerTape />

        {/* ============================== FACTS ============================== */}
        <section className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
          <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
            {FACTS.map(([n, label, sub]) => (
              <div key={label} className="bg-void p-5 sm:p-6">
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span className="display block text-[clamp(1.8rem,6vw,2.6rem)] text-gold tabular-nums">
                    {n}
                  </span>
                  <span className="mt-2 block font-display text-[10px] uppercase text-bone">
                    {label}
                  </span>
                  <span className="mt-1.5 block text-[11px] leading-snug text-dimmer">{sub}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ============================ STARTERS ============================ */}
        <section className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
          <SectionHead
            id="starters"
            num="01"
            eyebrow="First choice"
            title="Choose your starter"
            lede={
              <>
                The reskin dropped straight onto the engine&apos;s starter slots, so the
                three creatures a new trader picks between are Apple, NVIDIA and Tesla.
                Grass, fire, water. Flora, Blaze, Tide.
              </>
            }
          />
          <div className="mt-9">
            <StarterSelect />
          </div>
        </section>

        {/* ============================ GAMEPLAY ============================ */}
        <section className="border-y border-line bg-pit/60">
          <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
            <SectionHead
              id="gameplay"
              num="02"
              eyebrow="The loop"
              title="How it plays"
              lede={
                <>
                  One world, everybody in it. The RPG half is the one you already know —
                  walk, find something, wear it down, catch it. What is new is that the
                  creature you catch is yours on chain, and so is the one you take off
                  somebody else.
                </>
              }
            />
            <div className="mt-9">
              <GameplayLoop />
            </div>
          </div>
        </section>

        {/* ========================== PLAY TO EARN ========================== */}
        <section className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
          <SectionHead
            id="earn"
            num="03"
            eyebrow="Play to earn"
            title="Paid out of a pool, not printed"
            lede={
              <>
                Four ways to make {ECONOMY.symbol}, and one rule they all obey: none of
                them creates a single new token. That is the whole design, and it is why
                the board can be priced in dollars rather than in a number that quietly
                means less every week.
              </>
            }
          />
          <div className="mt-9">
            <PlayToEarn />
          </div>
        </section>

        {/* =========================== TYPE CHART =========================== */}
        <section className="border-y border-line bg-pit/60">
          <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
            <SectionHead
              id="types"
              num="04"
              eyebrow="Combat"
              title={
                <>
                  Eighteen elements,
                  <br />
                  one brutal chart
                </>
              }
              lede={
                <>
                  Toxic assets rot Flora. Shadow — the shortsellers — walks straight through
                  Spectre. Every multiplier below is read out of the game&apos;s own type
                  files, not made up for the website.
                </>
              }
            />
            <div className="mt-9">
              <TypeChart />
            </div>
          </div>
        </section>

        {/* ============================= LEDGER ============================= */}
        <section className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
          <SectionHead
            id="ledger"
            num="05"
            eyebrow="The full board"
            title="The ledger"
            lede={
              <>
                All {CREATURES.length} of them. Search by ticker, monster name or company,
                filter by element or power tier, then open any entry for its stat line,
                matchups and contract address.
              </>
            }
          />
          <div className="mt-9">
            <Ledger />
          </div>
        </section>

        {/* =========================== MEME WING =========================== */}
        <section className="mx-auto max-w-[1400px] px-4 pb-14 sm:px-6 sm:pb-20">
          <SectionHead num="06" eyebrow="Side wing" title="The meme coin wing" />
          <div className="mt-8">
            <MemeWingTeaser />
          </div>
        </section>

        {/* ============================== FAQ ============================== */}
        <section className="border-t border-line bg-pit/60">
          <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
            <SectionHead id="faq" num="07" eyebrow="Briefing" title="How it works" />
            <div className="mt-9 grid gap-4 lg:grid-cols-2">
              {FAQ.map(([q, a]) => (
                <Window key={q} arrow={false}>
                  <h3 className="font-display text-[11px] leading-relaxed text-gold">{q}</h3>
                  <p className="mt-3 text-[13px] leading-relaxed text-dim">{a}</p>
                </Window>
              ))}
            </div>
          </div>
        </section>

        {/* ============================ FINAL CTA ============================ */}
        <section className="relative overflow-hidden border-t border-line">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute inset-0 grid-floor opacity-20" />
            <PixelHorizon />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-void to-transparent" />
          </div>
          <div className="mx-auto max-w-[1400px] px-4 py-20 text-center sm:px-6 sm:py-28">
            <p className="eyebrow">Press start</p>
            <h2 className="display mx-auto mt-5 max-w-3xl text-[clamp(1.7rem,6.5vw,3.6rem)] hard-shadow">
              <span className="text-bone">Go catch </span>
              <span className="text-gold">the market</span>
            </h2>
            <div className="mt-9 flex justify-center">
              <PlayButton big label="Play now" />
            </div>
            <p className="mx-auto mt-5 max-w-sm text-[11px] leading-relaxed text-dimmer">
              Opens {PLAY_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")} in a new tab.
              Bring a wallet — it is how the world remembers you.
            </p>
          </div>
        </section>

        <TickerTape speed="slow" reverse />
      </main>

      <SiteFooter />
    </>
  );
}
