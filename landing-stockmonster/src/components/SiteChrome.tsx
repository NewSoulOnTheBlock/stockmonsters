import Link from "next/link";
import { CREATURES, MEMES, PLAY_URL, TWITTER_URL, TYPES } from "@/lib/data";
import { NavLink, PlayButton } from "./bits";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`group inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-display text-[13px] leading-none text-gold transition-colors group-hover:text-bone">
        STOCK
      </span>
      <span className="font-display text-[13px] leading-none text-bone transition-colors group-hover:text-gold">
        MONSTERS
      </span>
    </Link>
  );
}

/**
 * The project's account. An inline mark rather than an icon font — one more
 * network request for one glyph is not a trade worth making.
 */
export function XLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={TWITTER_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Stockmonsters on X"
      title="@stonksters"
      className={`inline-flex h-9 w-9 items-center justify-center border border-line text-dim transition-colors hover:border-gold hover:text-gold ${className}`}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-void/85 backdrop-blur-[6px]">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Wordmark />
        <nav className="ml-auto hidden items-center gap-6 md:flex">
          <NavLink href="/#gameplay">Gameplay</NavLink>
          <NavLink href="/#earn">Play to earn</NavLink>
          <NavLink href="/#types">Type chart</NavLink>
          <NavLink href="/#ledger">The ledger</NavLink>
          <NavLink href="/memes">Meme wing</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <XLink className="hidden sm:inline-flex" />
          <PlayButton />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative border-t border-line bg-pit">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="serif-lede mt-4 max-w-sm text-lg leading-snug text-dim">
              A retro monster-collecting RPG where the roster is the US market.
              {" "}
              {CREATURES.length} tickers, {TYPES.length} elements, {MEMES.length} meme
              coins in the side wing.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PlayButton label="Play in browser" />
              <XLink />
            </div>
            <p className="mt-3 max-w-xs text-[11px] leading-relaxed text-dimmer">
              Runs in the browser and on a phone. Bring a wallet — it is how the world
              remembers your trainer.
            </p>
          </div>

          <nav className="text-sm">
            <h3 className="eyebrow">Explore</h3>
            <ul className="mt-4 space-y-2.5">
              {[
                ["/#starters", "Pick a starter"],
                ["/#gameplay", "How it plays"],
                ["/#earn", "Play to earn"],
                ["/#types", "Type effectiveness"],
                ["/#ledger", `All ${CREATURES.length} stockmonsters`],
                ["/memes", "Meme coin wing"],
                ["/#faq", "How it works"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-dim transition-colors hover:text-gold">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="text-sm">
            <h3 className="eyebrow">Notes</h3>
            <ul className="mt-4 space-y-3 text-[12px] leading-relaxed text-dimmer">
              <li>
                Creature names, species lines and dex entries come from the game&apos;s own
                data files. Base stats are the ones the engine actually uses.
              </li>
              <li>
                Percentages on the tape are decorative — a fixed hash of each contract
                address, not a market quote. Nothing here is financial advice.
              </li>
              <li>
                Not affiliated with, endorsed by, or connected to any of the listed
                companies. Tickers are used as parody subject matter.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[11px] text-dimmer sm:flex-row sm:items-center sm:justify-between">
          <span className="font-display text-[9px] tracking-wider">
            © {new Date().getFullYear()} STOCKMONSTERS
          </span>
          <span className="flex items-center gap-4">
            <a
              href={TWITTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gold"
            >
              @stonksters
            </a>
            <a
              href={PLAY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gold"
            >
              {PLAY_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
