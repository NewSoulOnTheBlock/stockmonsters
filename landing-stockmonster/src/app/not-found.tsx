import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Window } from "@/components/bits";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <p className="eyebrow">Error 404</p>
        <h1 className="display mt-4 text-[clamp(2rem,8vw,3.4rem)] text-bone hard-shadow-sm">
          Nothing listed here
        </h1>
        <Window className="mt-8">
          <p className="text-[13px] leading-relaxed text-bone">
            That ticker is not on the board. The ledger only holds the 194 listed
            stockmonsters — try the search.
          </p>
        </Window>
        <Link
          href="/#ledger"
          className="mt-8 inline-block bg-gold px-5 py-3 font-display text-[11px] uppercase text-void"
          style={{ boxShadow: "0 4px 0 0 #7a5c05" }}
        >
          ← Open the ledger
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
