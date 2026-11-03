import {
  Coins,
  ClipboardCheck,
  FileSearch,
  Globe,
  Package,
  Scale,
  ScrollText,
  Stethoscope,
  Ticket,
} from "lucide-react";

/**
 * The wire — Quorum's standing facts, one headline each.
 *
 * Read as a news feed rather than a slogan bar: every item is a discrete
 * verified claim, separated by a hairline tick, and the band pauses under the
 * pointer so a reader can actually finish the line they are on. The fixed
 * collar on the left names the feed; only the feed itself scrolls.
 */
const ITEMS = [
  { icon: ClipboardCheck, text: "PUBLIC HEALTH PROCUREMENT REVIEW" },
  { icon: Globe, text: "PUBLIC PROCUREMENT DATA SOURCES ACROSS AFRICA" },
  { icon: Scale, text: "THE COMMITTEE MAKES THE AWARD DECISION" },
  { icon: FileSearch, text: "FINDINGS LINKED TO SOURCE DOCUMENTS" },
  { icon: Stethoscope, text: "TECHNICAL REQUIREMENTS · CLINICAL REFERENCES" },
  { icon: Package, text: "SUPPLIER DOCUMENTS · QUANTITY CHECKS" },
  { icon: Coins, text: "PRICE REVIEW · PUBLIC AWARD REFERENCES" },
  { icon: ScrollText, text: "A TRACEABLE HISTORY FOR EVERY REVIEW" },
  { icon: Ticket, text: "THREE TENDER REVIEWS AT NO COST" },
];

function Row({ items, hidden }: { items: typeof ITEMS; hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <span key={item.text} className="flex shrink-0 items-center">
          <span className="flex items-center gap-2.5 whitespace-nowrap px-6 font-code text-[10.5px] font-medium tracking-[0.18em] text-ink-300">
            <item.icon className="h-3.5 w-3.5 text-brand-400/90" aria-hidden="true" />
            {item.text}
          </span>
          <span className="h-3.5 w-px shrink-0 bg-white/12" aria-hidden="true" />
        </span>
      ))}
    </div>
  );
}

export function TopTicker() {
  return (
    <div
      className="group relative flex overflow-hidden border-b border-white/[0.07] bg-ink-950"
      aria-label="Quorum review standards"
    >
      {/* Feed collar — names the band and never scrolls away */}
      <span className="relative z-10 hidden shrink-0 items-center gap-2.5 bg-ink-950 pl-4 pr-4 sm:flex sm:pl-6">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
        </span>
        <span className="type-micro text-white">Quorum · review standards</span>
        <span className="h-3.5 w-px bg-white/12" aria-hidden="true" />
      </span>

      {/* The feed — duplicated once for a seamless loop; the copy is hidden
          from assistive tech so the claims are read exactly once. */}
      <div className="mask-x flex min-w-0 flex-1 items-center overflow-hidden py-2.5">
        <div className="flex w-max animate-marquee-slow items-center group-hover:[animation-play-state:paused]">
          <Row items={ITEMS} />
          <Row items={ITEMS} hidden />
        </div>
      </div>
    </div>
  );
}
