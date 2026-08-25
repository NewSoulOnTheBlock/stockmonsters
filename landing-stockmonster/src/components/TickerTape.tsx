import { CREATURES } from "@/lib/data";

/**
 * The tape. Every one of the 194 tickers scrolls past with its creature
 * name. `drift` is a deterministic hash of the contract address — it is
 * decoration, not a quote, and the section says so.
 */
export function TickerTape({
  speed = "normal",
  reverse = false,
}: {
  speed?: "normal" | "slow";
  reverse?: boolean;
}) {
  const items = reverse ? [...CREATURES].reverse() : CREATURES;
  const run = (key: string) => (
    <div className="flex shrink-0" key={key} aria-hidden={key !== "a"}>
      {items.map((c) => {
        const up = c.drift >= 0;
        return (
          <span
            key={c.ticker}
            className="flex shrink-0 items-baseline gap-2 border-r border-line/70 px-4 py-2 text-[11px]"
          >
            <b className="font-display text-[10px] font-normal text-bone">{c.ticker}</b>
            <span className="text-dimmer">{c.name}</span>
            <span className={up ? "text-tape" : "text-blood"}>
              {up ? "▲" : "▼"}
              {Math.abs(c.drift).toFixed(2)}%
            </span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="tape-window border-y border-line bg-pit/80">
      <div
        className={`tape-track ${speed === "slow" ? "animate-tape-slow" : "animate-tape"}`}
        style={reverse ? { animationDirection: "reverse" } : undefined}
      >
        {run("a")}
        {run("b")}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-void to-transparent" />
    </div>
  );
}
