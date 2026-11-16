export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-16" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-5 py-4 text-[13px] font-semibold text-ink-700 shadow-[0_18px_50px_rgba(11,12,15,0.06)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" aria-hidden="true" />
        Opening the workspace…
      </div>
    </main>
  );
}
