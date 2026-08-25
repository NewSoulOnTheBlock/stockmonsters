import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { MemeStrip } from "@/components/MemeWing";
import { PlayButton, Sprite, TypeChip } from "@/components/bits";
import { CREATURES, MEMES, TYPE_BY_NAME } from "@/lib/data";

export const metadata: Metadata = {
  title: "The meme coin wing",
  description: `${MEMES.length} meme coins reimagined as monsters — Shibazan, Muchwow, Pepetoad and the rest of the side wing of Stockmonsters.`,
};

export default function MemesPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div
            className="absolute inset-0 -z-10 opacity-60"
            style={{
              background:
                "radial-gradient(80% 60% at 20% 0%, rgba(255,62,207,.14), transparent 60%), radial-gradient(60% 50% at 90% 20%, rgba(255,198,30,.08), transparent 60%)",
            }}
          />
          <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
            <Link
              href="/"
              className="font-display text-[10px] uppercase text-dim transition-colors hover:text-gold"
            >
              ← Main floor
            </Link>
            <p className="eyebrow mt-6">Side wing · {MEMES.length} entries</p>
            <h1 className="display mt-4 text-[clamp(2rem,8vw,4.4rem)] hard-shadow">
              <span className="block text-chroma">MEME COIN</span>
              <span className="block text-bone">WING</span>
            </h1>
            <p className="serif-lede mt-6 max-w-2xl text-[clamp(1.2rem,3.4vw,1.7rem)] italic leading-tight text-dim">
              The stocks got a trading floor. The coins got a petting zoo.
            </p>
            <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-dim">
              A separate roster, drawn from the same engine: {MEMES.length} meme coins with
              their own creature, typing and dex entry. Everything below — names, species
              lines, flavour text, base stats — comes out of the project&apos;s data files.
              No prices, no charts, no advice.
            </p>
            <div className="mt-8">
              <PlayButton label="Play now" />
            </div>
          </div>
          <div className="border-t border-line/60">
            <MemeStrip />
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 sm:py-16">
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MEMES.map((m) => {
              const accent = TYPE_BY_NAME[m.types[0]]?.color ?? "#ff3ecf";
              return (
                <li
                  key={m.ticker}
                  className="group relative flex min-w-0 gap-4 bg-slab p-4 transition-colors hover:bg-slab-hi"
                  style={{
                    boxShadow:
                      "0 -3px 0 0 #0a0e16, 0 3px 0 0 #0a0e16, -3px 0 0 0 #0a0e16, 3px 0 0 0 #0a0e16",
                  }}
                >
                  <span
                    className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
                    style={{ background: accent }}
                  />
                  <div
                    className="grid h-20 w-20 shrink-0 place-items-center self-start sm:h-24 sm:w-24"
                    style={{
                      background: `radial-gradient(60% 55% at 50% 60%, ${accent}26, transparent 72%)`,
                    }}
                  >
                    <Sprite
                      id={m.id}
                      name={m.name}
                      kind="meme"
                      size={80}
                      className="transition-transform duration-150 group-hover:scale-110"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="truncate font-display text-[12px] text-bone">{m.name}</h2>
                      <span className="shrink-0 font-display text-[10px] text-chroma">
                        ${m.ticker}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-dim">
                      {m.species ?? "Stockmonster"} · {m.company}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.types.map((t) => (
                        <TypeChip key={t} type={t} size="sm" />
                      ))}
                      {m.bst !== null && (
                        <span className="inline-flex items-center bg-void px-1.5 py-1 font-mono text-[9px] tabular-nums text-dimmer">
                          BST {m.bst}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="mt-3 text-[12px] leading-relaxed text-dim">{m.description}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="border-t border-line bg-pit/60">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
            <div>
              <h2 className="display text-[clamp(1.3rem,4.5vw,2rem)] text-bone">
                The main floor is bigger
              </h2>
              <p className="mt-3 max-w-md text-[13px] leading-relaxed text-dim">
                {CREATURES.length} US tickers, {" "}
                <Link href="/#ledger" className="text-gold underline decoration-dotted underline-offset-4">
                  browsable in the ledger
                </Link>
                , each with a stat line and matchup table.
              </p>
            </div>
            <PlayButton big label="Play now" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
