import Link from "next/link";
import { MEMES } from "@/lib/data";
import { Sprite } from "./bits";

/** A scrolling strip of the 60 meme-coin monsters, linking to the full wing. */
export function MemeStrip() {
  const run = (key: string) => (
    <div className="flex shrink-0 items-end gap-6 px-3" key={key} aria-hidden={key !== "a"}>
      {MEMES.map((m) => (
        <span key={m.ticker} className="group relative flex shrink-0 flex-col items-center">
          <Sprite id={m.id} name={m.name} kind="meme" size={72} />
          <span className="mt-1 font-display text-[8px] uppercase text-dimmer">{m.ticker}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="tape-window py-4">
      <div className="tape-track animate-strip">
        {run("a")}
        {run("b")}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-void to-transparent" />
    </div>
  );
}

export function MemeWingTeaser() {
  return (
    <div className="frame frame-thin bg-pit" style={{ ["--bc" as string]: "#242f40" }}>
      <MemeStrip />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-4">
        <p className="max-w-lg text-[13px] leading-relaxed text-dim">
          Off the main floor there is a second wing: {MEMES.length} meme coins with their own
          creatures, types and dex entries. Shibazan. Muchwow. Pepetoad. Fartweeze.
        </p>
        <Link
          href="/memes"
          className="inline-flex items-center gap-2 bg-chroma px-4 py-2.5 font-display text-[10px] uppercase text-void transition-transform active:translate-y-[2px]"
          style={{ boxShadow: "0 3px 0 0 #8a1c70" }}
        >
          Enter the meme wing →
        </Link>
      </div>
    </div>
  );
}
