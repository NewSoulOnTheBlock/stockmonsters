"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  CREATURES,
  TIERS,
  TYPES,
  TYPE_BY_NAME,
  tierOf,
  type Creature,
  type Tier,
} from "@/lib/data";
import { Sprite, TypeChip } from "./bits";

type Sort = "dex" | "ticker" | "power" | "name";

const SORTS: Array<[Sort, string]> = [
  ["dex", "Dex no."],
  ["ticker", "Ticker A→Z"],
  ["name", "Name A→Z"],
  ["power", "Power ↓"],
];

function MonCard({ c }: { c: Creature }) {
  const accent = TYPE_BY_NAME[c.types[0]]?.color ?? "#3a4a63";
  return (
    <Link
      href={`/ledger/${c.ticker}`}
      className="group defer-paint relative block bg-slab p-3 transition-[transform,background-color] duration-100 hover:-translate-y-[3px] hover:bg-slab-hi focus-visible:-translate-y-[3px]"
      style={{
        boxShadow: `0 -3px 0 0 #0a0e16, 0 3px 0 0 #0a0e16, -3px 0 0 0 #0a0e16, 3px 0 0 0 #0a0e16`,
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-70 transition-opacity group-hover:opacity-100"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] tabular-nums text-dimmer">
          №{String(c.id).padStart(3, "0")}
        </span>
        <span className="font-display text-[10px] text-gold">${c.ticker}</span>
      </div>

      <div
        className="relative mx-auto my-1 grid h-[104px] w-full place-items-center"
        style={{
          background: `radial-gradient(60% 55% at 50% 62%, ${accent}22, transparent 70%)`,
        }}
      >
        <Sprite
          id={c.id}
          name={c.name}
          size={96}
          className="transition-transform duration-150 group-hover:scale-110"
        />
      </div>

      <h3 className="truncate font-display text-[11px] leading-tight text-bone">{c.name}</h3>
      <p className="mt-1 truncate text-[10px] text-dim">{c.company}</p>

      <div className="mt-2.5 flex flex-wrap gap-1">
        {c.types.map((t) => (
          <TypeChip key={t} type={t} size="sm" />
        ))}
      </div>
    </Link>
  );
}

export function Ledger() {
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier | "all">("all");
  const [sort, setSort] = useState<Sort>("dex");
  const dq = useDeferredValue(q);

  const results = useMemo(() => {
    const needle = dq.trim().toLowerCase().replace(/^\$/, "");
    let out = CREATURES.filter((c) => {
      if (types.length && !types.every((t) => c.types.includes(t))) return false;
      if (tier !== "all" && tierOf(c.bst) !== tier) return false;
      if (!needle) return true;
      return (
        c.ticker.toLowerCase().includes(needle) ||
        c.name.toLowerCase().includes(needle) ||
        c.company.toLowerCase().includes(needle) ||
        (c.species ?? "").toLowerCase().includes(needle)
      );
    });
    out = [...out].sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "power") return (b.bst ?? 0) - (a.bst ?? 0);
      return a.id - b.id;
    });
    return out;
  }, [dq, types, tier, sort]);

  const toggleType = (t: string) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const dirty = q !== "" || types.length > 0 || tier !== "all";

  return (
    <div>
      {/* ---- console ---- */}
      <div className="frame frame-thin bg-pit p-4 sm:p-5" style={{ ["--bc" as string]: "#242f40" }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="group relative flex min-w-0 flex-1 items-center gap-2 bg-void px-3 py-2.5">
            <span className="animate-blink font-display text-xs text-tape" aria-hidden>
              &gt;
            </span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search ticker, monster, company…"
              aria-label="Search the ledger"
              className="w-full bg-transparent font-mono text-sm text-bone placeholder:text-dimmer focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="ledger-sort">
              Sort
            </label>
            <select
              id="ledger-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="cursor-pointer bg-void px-3 py-2.5 font-mono text-xs text-bone focus:outline-none"
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* tier */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Tier</span>
          {(["all", ...TIERS] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t as Tier | "all")}
              aria-pressed={tier === t}
              className={`px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                tier === t
                  ? "bg-bone text-void"
                  : "bg-slab text-dim hover:bg-slab-hi hover:text-bone"
              }`}
            >
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>

        {/* types */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1">Element</span>
          {TYPES.map((t) => {
            const on = types.includes(t.name);
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => toggleType(t.name)}
                aria-pressed={on}
                className="px-2 py-1.5 font-display text-[9px] uppercase leading-none transition-all"
                style={
                  on
                    ? { background: t.color, color: "#06070a", boxShadow: "0 2px 0 0 rgba(0,0,0,.6)" }
                    : {
                        background: "transparent",
                        color: t.color,
                        boxShadow: `inset 0 0 0 2px ${t.color}55`,
                      }
                }
              >
                {t.name}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-3">
          <p className="font-mono text-[11px] tabular-nums text-dim">
            <b className="text-gold">{String(results.length).padStart(3, "0")}</b>
            <span className="text-dimmer"> / {CREATURES.length} listed</span>
            {types.length > 1 && (
              <span className="ml-2 text-dimmer">· dual-element match</span>
            )}
          </p>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setTypes([]);
                setTier("all");
              }}
              className="font-mono text-[11px] uppercase tracking-wider text-dim underline decoration-dotted underline-offset-4 transition-colors hover:text-gold"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ---- grid ---- */}
      {results.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {results.map((c) => (
            <MonCard key={c.ticker} c={c} />
          ))}
        </div>
      ) : (
        <div className="window mt-6 p-6">
          <p className="font-display text-[11px] leading-relaxed text-bone">
            No stockmonsters matched that filter.
          </p>
          <p className="mt-3 text-sm text-dim">
            Try a single element, or search by company name — every one of the{" "}
            {CREATURES.length} entries is in here somewhere.
          </p>
        </div>
      )}
    </div>
  );
}
