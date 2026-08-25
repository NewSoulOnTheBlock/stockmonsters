"use client";

import { useState } from "react";

export function CopyAddress({ address }: { address: string }) {
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
    <div className="flex items-stretch gap-px bg-line">
      <code className="min-w-0 flex-1 truncate bg-void px-3 py-2.5 font-mono text-[11px] text-dim sm:text-[12px]">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 bg-slab px-3 py-2.5 font-display text-[9px] uppercase text-bone transition-colors hover:bg-gold hover:text-void"
      >
        {state === "ok" ? "Copied" : state === "fail" ? "Failed" : "Copy"}
      </button>
    </div>
  );
}
