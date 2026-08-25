import { CREATURE_BY_TICKER, type Creature } from "@/lib/data";
import { Sprite, TypeChip } from "./bits";

function HpBar({ pct, label }: { pct: number; label: string }) {
  const tone = pct > 50 ? "bg-tape" : pct > 20 ? "bg-gold" : "bg-blood";
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[8px] text-gold">{label}</span>
      <div className="h-2 flex-1 bg-[#0a0e16] p-[2px]" style={{ boxShadow: "0 0 0 2px #3f5170" }}>
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Nameplate({
  c,
  lvl,
  hp,
  align,
}: {
  c: Creature;
  lvl: number;
  hp: number;
  align: "left" | "right";
}) {
  return (
    <div
      className={`window w-[190px] max-w-[52vw] px-3 py-2 sm:w-[220px] ${
        align === "right" ? "ml-auto" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[10px] uppercase text-bone">{c.name}</span>
        <span className="font-display text-[8px] text-dim">Lv{lvl}</span>
      </div>
      <div className="mt-1.5">
        <HpBar pct={hp} label="HP" />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-widest text-dimmer">${c.ticker}</span>
        <div className="flex gap-1">
          {c.types.map((t) => (
            <TypeChip key={t} type={t} size="sm" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A real battle screen, rebuilt in DOM: opposing plate top, player plate
 * bottom, message window under it. Both creatures and both type sets are
 * pulled from the ledger, not mocked.
 */
export function BattleScene({
  foe = "NVDA",
  ally = "AAPL",
  className = "",
}: {
  foe?: string;
  ally?: string;
  className?: string;
}) {
  const f = CREATURE_BY_TICKER[foe];
  const a = CREATURE_BY_TICKER[ally];
  if (!f || !a) return null;

  return (
    <div className={`relative ${className}`}>
      <div
        className="frame frame-thick relative overflow-hidden bg-[#0d121c]"
        style={{ ["--bc" as string]: "#3f5170" }}
      >
        {/* arena */}
        <div className="relative h-[300px] sm:h-[340px]">
          <div className="absolute inset-0 grid-floor opacity-40" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 70% at 50% 0%, rgba(74,158,230,.18), transparent 60%), radial-gradient(90% 60% at 40% 100%, rgba(255,198,30,.09), transparent 65%)",
            }}
          />

          {/* opponent */}
          <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
            <Nameplate c={f} lvl={52} hp={64} align="left" />
          </div>
          <div className="absolute right-4 top-14 sm:right-10 sm:top-16">
            <div className="relative">
              <div className="absolute -bottom-3 left-1/2 h-4 w-24 -translate-x-1/2 rounded-[50%] bg-sky/25 blur-[1px]" />
              <Sprite id={f.id} name={f.name} size={112} priority className="animate-bob" />
            </div>
          </div>

          {/* player */}
          <div className="absolute bottom-24 left-4 sm:bottom-24 sm:left-10">
            <div className="relative">
              <div className="absolute -bottom-3 left-1/2 h-5 w-32 -translate-x-1/2 rounded-[50%] bg-gold/20 blur-[1px]" />
              <Sprite
                id={a.id}
                name={a.name}
                size={144}
                priority
                className="animate-bob [animation-delay:1.2s]"
              />
            </div>
          </div>
          <div className="absolute bottom-24 right-3 sm:right-4">
            <Nameplate c={a} lvl={54} hp={91} align="right" />
          </div>

          {/* message window */}
          <div className="absolute inset-x-2 bottom-2 sm:inset-x-3 sm:bottom-3">
            <div className="window px-4 py-3">
              <p className="font-display text-[10px] leading-relaxed text-bone sm:text-[11px]">
                A wild {f.name.toUpperCase()} appeared!
                <span className="ml-2 animate-blink text-gold">▼</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-display text-[9px] text-dim sm:text-[10px]">
                <span className="text-bone">▸ FIGHT</span>
                <span>LEDGER</span>
                <span>BAG</span>
                <span>RUN</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
