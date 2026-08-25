"use client";

import { useState } from "react";
import { TYPES, effectiveness } from "@/lib/data";

const CELL: Record<string, { bg: string; fg: string; label: string }> = {
  "2": { bg: "#1d3d2c", fg: "#35f0a0", label: "2" },
  "0.5": { bg: "#3a2027", fg: "#ff8fa3", label: "½" },
  "0": { bg: "#5a1520", fg: "#ffd7de", label: "0" },
};

function group(name: string, want: (m: number) => boolean, dir: "atk" | "def") {
  return TYPES.filter((t) =>
    want(dir === "atk" ? effectiveness(name, [t.name]) : effectiveness(t.name, [name]))
  );
}

function Row({
  title,
  items,
  tone,
}: {
  title: string;
  items: { name: string; color: string }[];
  tone: string;
}) {
  return (
    <div>
      <h4 className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: tone }}>
        {title}
      </h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-[11px] text-dimmer">— nothing</span>
        ) : (
          items.map((t) => (
            <span
              key={t.name}
              className="px-2 py-1 font-display text-[9px] uppercase leading-none text-void"
              style={{ background: t.color }}
            >
              {t.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function TypeChart() {
  const [sel, setSel] = useState(TYPES[10].name); // Tide — liquidity, a good default
  const active = TYPES.find((t) => t.name === sel)!;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
      {/* picker + read-out */}
      <div>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => {
            const on = t.name === sel;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => setSel(t.name)}
                aria-pressed={on}
                className="px-2.5 py-1.5 font-display text-[9px] uppercase leading-none transition-all"
                style={
                  on
                    ? { background: t.color, color: "#06070a", boxShadow: "0 3px 0 0 rgba(0,0,0,.6)" }
                    : { color: t.color, boxShadow: `inset 0 0 0 2px ${t.color}44` }
                }
              >
                {t.name}
              </button>
            );
          })}
        </div>

        <div className="window mt-5 p-5">
          <div className="flex items-center gap-3">
            <span
              className="px-2.5 py-1.5 font-display text-[11px] uppercase leading-none text-void"
              style={{ background: active.color }}
            >
              {active.name}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="serif-lede mt-3 text-lg leading-snug text-bone">{active.blurb}</p>

          <div className="mt-5 space-y-4">
            <Row title="Hits hard (×2)" items={group(sel, (m) => m === 2, "atk")} tone="#35f0a0" />
            <Row
              title="Barely dents (×½ or ×0)"
              items={group(sel, (m) => m < 1, "atk")}
              tone="#ff8fa3"
            />
            <Row
              title="Takes double from"
              items={group(sel, (m) => m === 2, "def")}
              tone="#ffc61e"
            />
          </div>
        </div>
      </div>

      {/* full matrix */}
      <figure className="min-w-0">
        <div className="frame frame-thin overflow-x-auto bg-pit p-3 no-bar" style={{ ["--bc" as string]: "#242f40" }}>
          <table className="w-full min-w-[560px] border-separate border-spacing-[2px]">
            <caption className="sr-only">
              Attack type effectiveness matrix. Rows attack, columns defend.
            </caption>
            <thead>
              <tr>
                <th className="w-[68px]" />
                {TYPES.map((t) => (
                  <th key={t.name} className="p-0" title={t.name}>
                    <span
                      className="mx-auto block h-3 w-full"
                      style={{ background: t.color, opacity: sel === t.name ? 1 : 0.5 }}
                    />
                    <span className="sr-only">{t.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TYPES.map((atk) => {
                const rowActive = atk.name === sel;
                return (
                  <tr key={atk.name} className={rowActive ? "" : "opacity-70"}>
                    <th scope="row" className="p-0 text-right">
                      <button
                        type="button"
                        onClick={() => setSel(atk.name)}
                        className="block w-full truncate px-1 py-0.5 text-right font-display text-[8px] uppercase leading-none transition-opacity"
                        style={{ color: atk.color, opacity: rowActive ? 1 : 0.75 }}
                      >
                        {atk.name}
                      </button>
                    </th>
                    {TYPES.map((def) => {
                      const m = effectiveness(atk.name, [def.name]);
                      const c = CELL[String(m)];
                      return (
                        <td key={def.name} className="p-0">
                          <span
                            title={`${atk.name} → ${def.name}: ×${m}`}
                            className="grid h-4 w-full place-items-center font-mono text-[8px] leading-none sm:h-[18px]"
                            style={{
                              background: c ? c.bg : "#0f141d",
                              color: c ? c.fg : "transparent",
                              outline: rowActive ? "1px solid rgba(255,198,30,.35)" : "none",
                            }}
                          >
                            {c ? c.label : "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dimmer">
          <span>Rows attack, columns defend.</span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5" style={{ background: "#1d3d2c" }} /> ×2
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5" style={{ background: "#3a2027" }} /> ×½
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5" style={{ background: "#5a1520" }} /> ×0
          </span>
        </figcaption>
      </figure>
    </div>
  );
}
