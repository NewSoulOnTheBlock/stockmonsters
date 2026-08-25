import Link from "next/link";
import { PLAY_URL, TYPE_BY_NAME } from "@/lib/data";

/* ------------------------------------------------------------------ *
 *  Sprite — pixel art, integer-friendly sizes, never smoothed.
 * ------------------------------------------------------------------ */
export function Sprite({
  id,
  name,
  kind = "mon",
  size = 96,
  className = "",
  priority = false,
}: {
  id: number;
  name: string;
  kind?: "mon" | "meme";
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/${kind}/${id}.png`}
      alt={`${name} sprite`}
      width={size}
      height={size}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={`px block ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/* ------------------------------------------------------------------ *
 *  Type chip — colour comes from Data/Studio/types/*.json
 * ------------------------------------------------------------------ */
export function TypeChip({
  type,
  size = "md",
  as = "span",
}: {
  type: string;
  size?: "sm" | "md";
  as?: "span" | "div";
}) {
  const color = TYPE_BY_NAME[type]?.color ?? "#8a93a3";
  const Tag = as;
  return (
    <Tag
      className={`inline-flex items-center font-display uppercase leading-none text-void ${
        size === "sm" ? "px-1.5 py-1 text-[9px]" : "px-2 py-1.5 text-[10px]"
      }`}
      style={{ background: color, boxShadow: `0 2px 0 0 rgba(0,0,0,.55)` }}
    >
      {type}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 *  Primary CTA. Copy never promises unlimited concurrent play.
 * ------------------------------------------------------------------ */
export function PlayButton({
  className = "",
  label = "PLAY NOW",
  big = false,
}: {
  className?: string;
  label?: string;
  big?: boolean;
}) {
  return (
    <a
      href={PLAY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative inline-flex items-center gap-3 bg-gold font-display uppercase text-void transition-transform duration-100 active:translate-y-[3px] ${
        big ? "px-7 py-4 text-base sm:text-lg" : "px-5 py-3 text-xs sm:text-sm"
      } ${className}`}
      style={{ boxShadow: "0 4px 0 0 #7a5c05, 0 4px 0 0 #7a5c05" }}
    >
      <span className="animate-blink text-void">▶</span>
      {label}
    </a>
  );
}

/* ------------------------------------------------------------------ *
 *  RPG dialogue window with the blinking advance arrow.
 * ------------------------------------------------------------------ */
export function Window({
  children,
  className = "",
  arrow = true,
}: {
  children: React.ReactNode;
  className?: string;
  arrow?: boolean;
}) {
  return (
    <div className={`window relative p-5 sm:p-6 ${className}`}>
      {children}
      {arrow && (
        <span className="absolute bottom-2 right-3 animate-blink text-sm text-gold" aria-hidden>
          ▼
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Section heading — number + rule + title, magazine style.
 * ------------------------------------------------------------------ */
export function SectionHead({
  num,
  eyebrow,
  title,
  lede,
  id,
}: {
  num: string;
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  id?: string;
}) {
  return (
    <header id={id} className="scroll-mt-28">
      <div className="flex items-center gap-4">
        <span className="font-display text-[11px] text-gold">{num}</span>
        <span className="eyebrow">{eyebrow}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <h2 className="display mt-5 text-[clamp(1.6rem,5.5vw,3rem)] text-bone hard-shadow-sm">
        {title}
      </h2>
      {lede && (
        <p className="serif-lede mt-4 max-w-2xl text-[clamp(1.05rem,2.6vw,1.35rem)] leading-snug text-dim">
          {lede}
        </p>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ *
 *  Pixel horizon — the city band from the reskinned title art, tiled
 *  along the bottom of a section at integer scale and faded upward.
 * ------------------------------------------------------------------ */
export function PixelHorizon({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-[198px] [background-size:960px_198px] lg:h-[264px] lg:[background-size:1280px_264px] ${className}`}
      style={{
        backgroundImage: "url(/skyline.png)",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "center bottom",
        imageRendering: "pixelated",
        opacity: 0.34,
        maskImage: "linear-gradient(to top, #000 0%, rgba(0,0,0,.85) 30%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to top, #000 0%, rgba(0,0,0,.85) 30%, transparent 100%)",
      }}
    />
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim transition-colors hover:text-gold"
    >
      {children}
    </Link>
  );
}
