"use client";

import { useState } from "react";
import { ECONOMY, TOKEN_EXPLORER_URL, shortAddress } from "@/lib/data";

/**
 * The hero's contract-address field — the pill every meme-coin site puts under
 * its title. It used to have two states, driven by whether `ECONOMY.address`
 * was still an empty string: NOT DEPLOYED / Soon, or the address. The token
 * launched on Robinhood Chain, so the unlaunched state is gone rather than
 * merely unreachable — a dead branch that ships "NOT DEPLOYED" into the bundle
 * is a stale claim waiting for someone to trip over it.
 *
 * The frame is the one `CopyAddress` uses on a ledger entry: hairline `bg-line`
 * showing through a 1px gap between cells.
 *
 * ON MOBILE THE PILL SHOWS 0x1234…abcd BUT COPIES THE WHOLE STRING. The short
 * form is two spans, not a truncated value — `copy()` always writes
 * `ECONOMY.address` in full, because a half-pasted contract address is how
 * people buy the wrong token.
 */
export function ContractAddress({ className = "" }: { className?: string }) {
  const address = ECONOMY.address;
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <div className={className}>
      <div className="flex w-full max-w-md items-stretch gap-px bg-line">
        <span
          className="shrink-0 bg-slab px-2.5 py-2.5 font-display text-[9px] uppercase leading-[1.7] text-gold sm:px-3"
          title={`${ECONOMY.symbol} contract address`}
        >
          <span aria-hidden>CA</span>
          <span className="sr-only">Contract address</span>
        </span>

        {/* full string on anything wider than a phone, 0x1234…abcd below it —
            either way the button copies the whole thing */}
        <code
          title={address}
          className="min-w-0 flex-1 truncate bg-void px-3 py-2.5 font-mono text-[11px] leading-[1.7] text-bone sm:text-[12px]"
        >
          <span className="hidden sm:inline">{address}</span>
          <span className="sm:hidden">{shortAddress(address)}</span>
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy the ${ECONOMY.symbol} contract address`}
          className="shrink-0 cursor-pointer bg-slab px-3 py-2.5 font-display text-[9px] uppercase leading-[1.7] text-bone transition-colors hover:bg-gold hover:text-void"
        >
          {state === "ok" ? "Copied" : state === "fail" ? "Failed" : "Copy"}
        </button>
      </div>

      <p className="mt-2 flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-dimmer">
        <span className="font-display text-[9px] uppercase tracking-wider text-gold">
          {ECONOMY.symbol}
        </span>
        <span aria-hidden>·</span>
        <span>{ECONOMY.supply} fixed supply</span>
        <span aria-hidden>·</span>
        <a
          href={TOKEN_EXPLORER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-dim underline decoration-dotted underline-offset-4 transition-colors hover:text-gold"
        >
          View on Blockscout ↗
        </a>
      </p>
    </div>
  );
}
