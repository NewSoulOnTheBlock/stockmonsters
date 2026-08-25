"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CREATURE_BY_TICKER,
  STARTER_TICKERS,
  STAT_LABELS,
  TYPE_BY_NAME,
  type Creature,
} from "@/lib/data";
import { Sprite, TypeChip } from "./bits";

/** Types out a string one character at a time, like the game's text box. */
function useTypewriter(text: string) {
  const [n, setN] = useState(text.length);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    timer.current = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          if (timer.current) clearInterval(timer.current);
          return v;
        }
        return v + 2;
      });
    }, 16);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text]);

  return { shown: text.slice(0, n), done: n >= text.length };
}

function StatRow({ label, sub, value }: { label: string; sub: string; value: number }) {
  const pct = Math.min(100, Math.round((value / 130) * 100));
  return (
    <div className="grid grid-cols-[52px_1fr_28px] items-center gap-2">
      <span className="font-display text-[8px] uppercase text-dim">{label}</span>
      <span className="relative block h-2 bg-[#0a0e16]" title={sub}>
        <span
          className="absolute inset-y-0 left-0 bg-gold transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-right font-mono text-[10px] tabular-nums text-bone">{value}</span>
    </div>
  );
}

function Card({
  c,
  active,
  onSelect,
}: {
  c: Creature;
  active: boolean;
  onSelect: () => void;
}) {
  const accent = TYPE_BY_NAME[c.types[0]]?.color ?? "#3a4a63";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative block w-full min-w-0 bg-slab p-3 text-left transition-transform duration-100 sm:p-4 ${
        active ? "-translate-y-1" : "hover:-translate-y-1"
      }`}
      style={{
        boxShadow: active
          ? `0 -3px 0 0 ${accent}, 0 3px 0 0 ${accent}, -3px 0 0 0 ${accent}, 3px 0 0 0 ${accent}`
          : `0 -3px 0 0 #0a0e16, 0 3px 0 0 #0a0e16, -3px 0 0 0 #0a0e16, 3px 0 0 0 #0a0e16`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[10px] text-gold">${c.ticker}</span>
        <span className="font-mono text-[10px] text-dimmer">
          №{String(c.id).padStart(3, "0")}
        </span>
      </div>
      <div
        className="my-2 grid h-20 place-items-center sm:h-[120px]"
        style={{ background: `radial-gradient(58% 52% at 50% 62%, ${accent}26, transparent 70%)` }}
      >
        <Sprite
          id={c.id}
          name={c.name}
          size={112}
          priority
          className={`max-sm:!h-16 max-sm:!w-16 ${
            active ? "animate-bob" : "transition-transform group-hover:scale-105"
          }`}
        />
      </div>
      <h3 className="font-display text-[11px] leading-tight text-bone sm:text-[13px]">{c.name}</h3>
      <p className="mt-1 truncate text-[10px] text-dim sm:text-[11px]">{c.company}</p>
      <div className="mt-2.5 flex flex-wrap gap-1">
        {c.types.map((t) => (
          <TypeChip key={t} type={t} size="sm" />
        ))}
      </div>
      {active && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold px-2 py-1 font-display text-[8px] uppercase text-void">
          Chosen
        </span>
      )}
    </button>
  );
}

export function StarterSelect() {
  const [ticker, setTicker] = useState<string>(STARTER_TICKERS[0]);
  const c = CREATURE_BY_TICKER[ticker];
  const line = c.description ?? "";
  const { shown, done } = useTypewriter(line);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {STARTER_TICKERS.map((t) => (
          <Card
            key={t}
            c={CREATURE_BY_TICKER[t]}
            active={t === ticker}
            onSelect={() => setTicker(t)}
          />
        ))}
      </div>

      <div className="window flex flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-sm text-bone">{c.name}</h3>
          <span className="text-[11px] text-dim">{c.species}</span>
        </div>

        <p className="mt-4 min-h-[6.5rem] text-[13px] leading-relaxed text-bone sm:min-h-[5.5rem]">
          {shown}
          <span className={`ml-0.5 text-gold ${done ? "animate-blink" : ""}`}>
            {done ? "▼" : "▌"}
          </span>
        </p>

        {c.stats && (
          <div className="mt-5 space-y-1.5 border-t border-line pt-4">
            {STAT_LABELS.map(([k, label, sub]) => (
              <StatRow key={k} label={label} sub={sub} value={c.stats![k]} />
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[11px] text-dim">
          <span>
            Height <b className="text-bone">{c.height}m</b>
          </span>
          <span>
            Weight <b className="text-bone">{c.weight}kg</b>
          </span>
          <span>
            Total <b className="text-gold tabular-nums">{c.bst}</b>
          </span>
          <Link
            href={`/ledger/${c.ticker}`}
            className="ml-auto font-display text-[10px] uppercase text-gold underline decoration-dotted underline-offset-4 hover:text-bone"
          >
            Full entry →
          </Link>
        </div>
      </div>
    </div>
  );
}
