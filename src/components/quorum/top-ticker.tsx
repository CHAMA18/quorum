import { Braces, Crosshair, FileSearch, Globe, Scale, Stethoscope, Ticket, Timer } from "lucide-react";

const ITEMS = [
  { icon: Globe, text: "BUILT FOR PUBLIC HEALTH PROCUREMENT ACROSS AFRICA" },
  { icon: Scale, text: "AGENTS PREPARE THE FILE — COMMITTEES AWARD THE TENDER" },
  { icon: FileSearch, text: "EVERY FINDING CITED, OR IT DOESN'T COUNT" },
  { icon: Stethoscope, text: "SPECS VS CLINICAL NEED · QUANTITIES VS CONSUMPTION · PRICES VS OTHER BUYERS" },
  { icon: Timer, text: "THE AGENT PREPARES THE FILE · THE COMMITTEE HOLDS THE GATE" },
  { icon: Braces, text: "OCDS IN · SOURCED REPORT OUT" },
  { icon: Ticket, text: "PILOT TIER — FREE FOR YOUR FIRST THREE TENDERS" },
  { icon: Crosshair, text: "THREE TOOLS THAT WORK BEAT NINE THAT HALF-WORK" },
];

/** Top announcement ticker — product facts marquee. */
export function TopTicker() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <div className="relative overflow-hidden bg-ink-950 py-2" aria-label="Quorum announcements">
      <div className="flex w-max animate-marquee items-center gap-10 pr-10">
        {row.map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-2.5 whitespace-nowrap font-code text-[10.5px] font-medium tracking-[0.18em] text-ink-200"
          >
            <item.icon className="h-3.5 w-3.5 text-brand-400" aria-hidden="true" />
            {item.text}
            <span className="ml-6 inline-block h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" />
          </span>
        ))}
      </div>
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink-950 to-transparent" />
    </div>
  );
}
