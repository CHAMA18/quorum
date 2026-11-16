import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-16 text-ink-950">
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-7 shadow-[0_24px_70px_rgba(11,12,15,0.08)]">
        <p className="font-code text-[10px] font-bold tracking-[0.16em] text-brand-700">QUORUM · 404</p>
        <h1 className="type-display mt-3 text-[27px] leading-tight">That record is not on this desk.</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-600">
          The link may be old, or the record may belong to another workspace. Nothing was changed.
        </p>
        <Link
          href="/"
          className="focus-brand mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink-950 px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Back to Quorum
        </Link>
      </div>
    </main>
  );
}
