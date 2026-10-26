import { cn } from "@/lib/utils";

/**
 * The Quorum lockup — a 3×3 vote grid where five votes are in (the four
 * corners and the centre) and the centre vote is cast in signal red: the
 * deciding one. A quorum is the minimum of members a committee needs
 * before a decision becomes lawful — the mark is that threshold, drawn.
 */
export function QuorumLogo({
  variant = "dark",
  tagline = true,
}: {
  variant?: "dark" | "light";
  /** Hide the mono subtitle where a screen wants the bare wordmark. */
  tagline?: boolean;
}) {
  const vote = variant === "dark" ? "#ffffff" : "#16181d";

  /* Cells of the 3×3 grid — 6px squares on a 22px canvas, 2px gutters. */
  const cell = 6;
  const slots = [0, 8, 16];
  const key = (cx: number, cy: number) => `${cx}-${cy}`;
  const votes = new Set([key(0, 0), key(0, 2), key(1, 1), key(2, 0), key(2, 2)]);

  return (
    <span className="flex items-center gap-3" aria-hidden="true">
      <span
        className={cn(
          "relative grid h-10 w-10 place-items-center rounded-xl transition-colors",
          variant === "dark" ? "bg-ink-950" : "keep-light bg-white"
        )}
      >
        <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
          {slots.map((cy, row) =>
            slots.map((cx, col) => {
              const isVote = votes.has(key(row, col));
              const isCentre = row === 1 && col === 1;
              return (
                <rect
                  key={key(row, col)}
                  x={cx}
                  y={cy}
                  width={cell}
                  height={cell}
                  rx={1.4}
                  fill={isVote ? (isCentre ? "#e8382a" : vote) : "none"}
                  stroke={isVote ? "none" : vote}
                  strokeOpacity={isVote ? undefined : 0.26}
                  strokeWidth={isVote ? undefined : 1.1}
                />
              );
            })
          )}
        </svg>
      </span>
      <span className="leading-none">
        <span
          className={cn(
            "block font-display text-[17px] font-black tracking-[-0.01em]",
            variant === "dark" ? "text-ink-950" : "text-white"
          )}
        >
          QUORUM
        </span>
        {tagline && (
          <span
            className={cn(
              "mt-1 block whitespace-nowrap font-code text-[8.5px] font-semibold tracking-[0.32em]",
              variant === "dark" ? "text-ink-500" : "text-ink-400"
            )}
          >
            AGENTIC PROCUREMENT
          </span>
        )}
      </span>
    </span>
  );
}
