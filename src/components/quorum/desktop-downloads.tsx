import Image from "next/image";
import { ArrowDownToLine, ArrowUpRight } from "lucide-react";
import { Aurora } from "@/components/quorum/motion-kit";
import { Reveal } from "@/components/quorum/reveal";

const RELEASE_URL = "https://github.com/CHAMA18/quorum/releases/latest/download";

const PLATFORMS = [
  {
    name: "Windows",
    detail: "64-bit · unzip and launch Quorum.exe",
    file: `${RELEASE_URL}/Quorum-Windows-Portable.zip`,
    icon: "/images/platform-windows.png",
    iconAlt: "Windows logo",
    badge: "PORTABLE APP · ZIP",
  },
  {
    name: "macOS",
    detail: "Apple silicon and Intel Macs",
    file: `${RELEASE_URL}/Quorum-macOS.dmg`,
    icon: "/images/platform-mac.png",
    iconAlt: "Apple logo for macOS",
    badge: "DISK IMAGE · DMG",
  },
];

export function DesktopDownloads() {
  return (
    <section id="desktop-downloads" className="relative overflow-hidden border-y border-ink-200/70 bg-[#f0eee8] dark:border-white/10 dark:bg-[#111216]">
      <Aurora tone="red" slow className="-right-44 -top-52 h-[560px] w-[560px] opacity-20 dark:opacity-25" />
      <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-40 [mask-image:radial-gradient(ellipse_80%_100%_at_50%_50%,black,transparent)]" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-16">
          <div>
            <Reveal>
              <p className="type-micro flex items-center gap-2 text-brand-700 dark:text-brand-300">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                QUORUM · DESKTOP
              </p>
            </Reveal>
            <Reveal delay={0.08} y={20}>
              <h2 className="type-display type-display-md mt-4 max-w-[13ch] text-ink-950 dark:text-white">
                Your procurement workspace, available on your computer.
              </h2>
            </Reveal>
            <Reveal delay={0.16} y={18}>
              <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-ink-600 dark:text-white/75">
                Keep Quorum close on your computer. The secure desktop app opens your workspace in its own window; an internet connection is required.
              </p>
            </Reveal>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {PLATFORMS.map(({ name, detail, file, icon, iconAlt, badge }, i) => (
              <Reveal key={name} delay={0.12 + i * 0.12} y={24} className="h-full">
                <a
                  href={file}
                  className="group focus-brand relative flex min-h-[174px] flex-col justify-between overflow-hidden rounded-xl border border-ink-200/80 bg-paper/90 p-5 shadow-[0_12px_35px_-28px_rgba(20,22,28,0.45)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-500/45 hover:bg-white hover:shadow-[0_22px_48px_-28px_rgba(20,22,28,0.55)] dark:border-white/15 dark:bg-white/[0.045] dark:hover:bg-white/[0.07]"
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-ink-200/70 bg-white transition-transform duration-500 group-hover:scale-105 group-hover:-rotate-3 dark:border-white/10 dark:bg-white">
                      <Image src={icon} alt={iconAlt} width={32} height={32} className="h-7 w-7 object-contain" />
                    </span>
                    <span className="type-micro rounded-full border border-ink-200/70 px-2.5 py-1 text-ink-400 dark:border-white/15 dark:text-white/65">
                      {badge}
                    </span>
                  </div>
                  <div className="mt-6 flex items-end justify-between gap-3">
                    <div>
                      <span className="block text-[18px] font-semibold text-ink-950 dark:text-white">Download for {name}</span>
                      <span className="mt-1 block text-[13px] text-ink-500 dark:text-white/70">{detail}</span>
                    </div>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                      <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal delay={0.22} y={12}>
          <p className="mt-5 flex items-center gap-1.5 text-[12px] text-ink-400 dark:text-white/60">
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            Downloads are built and published from tagged releases on GitHub.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
