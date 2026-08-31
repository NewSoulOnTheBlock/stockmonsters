"use client";

import { useState } from "react";
import { ECONOMY, shortAddress } from "@/lib/data";

/**
 * The hero's contract-address field — the pill every meme-coin site puts
 * under its title. It has exactly two states and they are driven by one
 * value, `ECONOMY.address` in src/lib/data.ts:
 *
 *   ""      → reads NOT DEPLOYED, inert, nothing to click.
 *   "0x…"   → shows the address and copies it on click.
 *
 * The frame is the same one `CopyAddress` uses on a ledger entry: hairline
 * `bg-line` showing through a 1px gap between cells, so the states share a
 * silhouette and the layout does not jump on launch day.
 */
export function ContractAddress({ className = "" }: { className?: string }) {
  const address = ECONOMY.address;
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <div className={`flex w-full max-w-md items-stretch gap-px bg-line ${className}`}>
      <span
        className="shrink-0 bg-slab px-2.5 py-2.5 font-display text-[9px] uppercase leading-[1.7] text-gold sm:px-3"
        title={`${ECONOMY.symbol} contract address`}
      >
        <span aria-hidden>CA</span>
        <span className="sr-only">Contract address</span>
      </span>

      {address ? (
        <>
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
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate bg-void px-3 py-2.5 font-mono text-[11px] leading-[1.7] text-dimmer sm:text-[12px]">
            NOT DEPLOYED
            <span className="animate-blink text-dim" aria-hidden>
              {" "}
              _
            </span>
          </span>
          {/* deliberately not a button: there is nothing to copy yet */}
          <span className="shrink-0 bg-slab px-3 py-2.5 font-display text-[9px] uppercase leading-[1.7] text-dimmer">
            Soon
          </span>
        </>
      )}
    </div>
  );
}
