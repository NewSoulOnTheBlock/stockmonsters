import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddress } from "@/components/CopyAddress";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PlayButton, Sprite, TypeChip, Window } from "@/components/bits";
import {
  CREATURES,
  CREATURE_BY_TICKER,
  STAT_LABELS,
  TYPE_BY_NAME,
  matchups,
  tierOf,
} from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return CREATURES.map((c) => ({ ticker: c.ticker }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const c = CREATURE_BY_TICKER[ticker];
  if (!c) return { title: "Not found" };
  const desc =
    c.description ??
    `${c.name} — the Stockmonster for $${c.ticker}, tied to ${c.company}.`;
  return {
    title: `${c.name} · $${c.ticker}`,
    description: desc,
    openGraph: {
      title: `${c.name} — $${c.ticker}`,
      description: desc,
      images: [{ url: `/mon/${c.id}.png`, width: 96, height: 96 }],
    },
    twitter: {
      card: "summary",
      title: `${c.name} — $${c.ticker}`,
      description: desc,
      images: [`/mon/${c.id}.png`],
    },
  };
}

function StatBar({ label, sub, value }: { label: string; sub: string; value: number }) {
  const pct = Math.min(100, Math.round((value / 150) * 100));
  const tone = value >= 100 ? "bg-tape" : value >= 65 ? "bg-gold" : "bg-line-hi";
  return (
    <div className="grid grid-cols-[64px_1fr_34px] items-center gap-3">
      <span className="font-display text-[8px] uppercase text-dim">{label}</span>
      <span className="relative block h-2.5 bg-[#0a0e16]">
        <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right font-mono text-[11px] tabular-nums text-bone">{value}</span>
      <span className="sr-only">{sub}</span>
    </div>
  );
}

function MultChip({ name, mult }: { name: string; mult: number }) {
  const color = TYPE_BY_NAME[name]?.color ?? "#8a93a3";
  const label = mult === 0 ? "×0" : mult === 0.25 ? "×¼" : mult === 0.5 ? "×½" : `×${mult}`;
  return (
    <span className="inline-flex items-center gap-1.5 bg-slab py-1 pl-1 pr-2">
      <span
        className="px-1.5 py-1 font-display text-[8px] uppercase leading-none text-void"
        style={{ background: color }}
      >
        {name}
      </span>
      <b className="font-mono text-[10px] tabular-nums text-bone">{label}</b>
    </span>
  );
}

export default async function CreaturePage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const c = CREATURE_BY_TICKER[ticker];
  if (!c) notFound();

  const idx = CREATURES.findIndex((x) => x.ticker === c.ticker);
  const prev = CREATURES[(idx - 1 + CREATURES.length) % CREATURES.length];
  const next = CREATURES[(idx + 1) % CREATURES.length];
  const accent = TYPE_BY_NAME[c.types[0]]?.color ?? "#3a4a63";
  const { weak, resist } = matchups(c.types);
  const up = c.drift >= 0;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-[1200px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <nav className="flex items-center justify-between gap-4 text-[11px]">
          <Link
            href="/#ledger"
            className="font-display uppercase text-dim transition-colors hover:text-gold"
          >
            ← Ledger
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href={`/ledger/${prev.ticker}`}
              className="font-mono text-dim transition-colors hover:text-gold"
            >
              ← {prev.ticker}
            </Link>
            <span className="text-dimmer">·</span>
            <Link
              href={`/ledger/${next.ticker}`}
              className="font-mono text-dim transition-colors hover:text-gold"
            >
              {next.ticker} →
            </Link>
          </div>
        </nav>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
          {/* ------------------------- portrait ------------------------- */}
          <div>
            <div
              className="frame frame-thick relative grid aspect-square place-items-center overflow-hidden bg-[#0d121c]"
              style={{ ["--bc" as string]: "#3f5170" }}
            >
              <div className="absolute inset-0 grid-floor opacity-30" />
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(55% 45% at 50% 58%, ${accent}33, transparent 72%)`,
                }}
              />
              <span className="absolute left-3 top-3 font-mono text-[11px] tabular-nums text-dimmer">
                №{String(c.id).padStart(3, "0")}
              </span>
              <span
                className="absolute right-3 top-3 px-2 py-1 font-display text-[9px] uppercase leading-none text-void"
                style={{ background: accent }}
              >
                {tierOf(c.bst)}
              </span>
              <Sprite
                id={c.id}
                name={c.name}
                size={288}
                priority
                className="relative animate-bob max-sm:!h-48 max-sm:!w-48"
              />
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-dimmer">
                  Field render
                </span>
                <span className={`font-mono text-[11px] tabular-nums ${up ? "text-tape" : "text-blood"}`}>
                  {up ? "▲" : "▼"} {Math.abs(c.drift).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="mt-4">
              <p className="eyebrow mb-2">Contract</p>
              <CopyAddress address={c.address} />
              <p className="mt-2 text-[10px] leading-relaxed text-dimmer">
                The drift figure above is cosmetic — a fixed hash of this address, not a
                price. Nothing on this page is financial advice.
              </p>
            </div>
          </div>

          {/* --------------------------- data --------------------------- */}
          <div>
            <p className="font-display text-[11px] text-gold">${c.ticker}</p>
            <h1 className="display mt-3 text-[clamp(2rem,8vw,3.6rem)] text-bone hard-shadow-sm">
              {c.name}
            </h1>
            <p className="serif-lede mt-3 text-xl italic text-dim">
              {c.species ?? "Stockmonster"} · {c.company}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {c.types.map((t) => (
                <TypeChip key={t} type={t} />
              ))}
            </div>

            {c.description && (
              <Window className="mt-7">
                <p className="text-[13px] leading-relaxed text-bone sm:text-sm">
                  {c.description}
                </p>
              </Window>
            )}

            {c.stats && (
              <section className="mt-8">
                <div className="flex items-baseline justify-between">
                  <h2 className="eyebrow">Base stats</h2>
                  <p className="font-mono text-[11px] text-dim">
                    Total <b className="text-gold tabular-nums">{c.bst}</b>
                  </p>
                </div>
                <div className="mt-4 space-y-2">
                  {STAT_LABELS.map(([k, label, sub]) => (
                    <StatBar key={k} label={label} sub={sub} value={c.stats![k]} />
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-dimmer">
                  Read straight out of the game engine&apos;s creature definitions — these
                  are the numbers battles actually use. Sub-labels: float, buy pressure,
                  support, narrative, conviction, fill speed.
                </p>
              </section>
            )}

            <section className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="eyebrow text-blood">Takes extra from</h2>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {weak.length ? (
                    weak.map(([n, m]) => <MultChip key={n} name={n} mult={m} />)
                  ) : (
                    <span className="text-[11px] text-dimmer">— nothing</span>
                  )}
                </div>
              </div>
              <div>
                <h2 className="eyebrow text-tape">Shrugs off</h2>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {resist.length ? (
                    resist.map(([n, m]) => <MultChip key={n} name={n} mult={m} />)
                  ) : (
                    <span className="text-[11px] text-dimmer">— nothing</span>
                  )}
                </div>
              </div>
            </section>

            <dl className="mt-8 grid grid-cols-3 gap-px bg-line">
              {[
                ["Height", c.height !== null ? `${c.height} m` : "—"],
                ["Weight", c.weight !== null ? `${c.weight} kg` : "—"],
                ["Catch rate", c.catchRate !== null ? String(c.catchRate) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="bg-void px-3 py-4">
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-dimmer">{k}</dt>
                  <dd className="mt-1.5 font-display text-[12px] text-bone">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-9 flex flex-wrap items-center gap-4 border-t border-line pt-7">
              <PlayButton label={`Go catch ${c.name}`} />
              <Link
                href="/#ledger"
                className="font-display text-[10px] uppercase text-dim transition-colors hover:text-gold"
              >
                Back to all {CREATURES.length} →
              </Link>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
