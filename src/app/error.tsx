"use client";

import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[quorum] route error", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-16 text-ink-950">
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-7 shadow-[0_24px_70px_rgba(11,12,15,0.08)]">
        <p className="font-code text-[10px] font-bold tracking-[0.16em] text-brand-700">QUORUM · RECOVERY</p>
        <h1 className="type-display mt-3 text-[27px] leading-tight">This screen could not finish loading.</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-600">
          Nothing was filed or changed. Try the screen again; if it keeps failing, return to the workspace and
          quote reference{" "}
          <span className="font-code text-[12px] text-ink-950">{error.digest ?? "no-digest"}</span>.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="focus-brand inline-flex min-h-11 items-center rounded-xl bg-ink-950 px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-600"
          >
            Try again
          </button>
          <a
            href="/"
            className="focus-brand inline-flex min-h-11 items-center rounded-xl border border-ink-200 px-5 text-[13.5px] font-semibold text-ink-800 transition-colors hover:bg-ink-50"
          >
            Back to Quorum
          </a>
        </div>
      </div>
    </main>
  );
}
