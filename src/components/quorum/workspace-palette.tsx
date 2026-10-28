"use client";

/**
 * WorkspacePalette — the desk's command line.
 *
 * ⌘K (or Ctrl+K) opens a single searchable surface over every section of the
 * workspace plus the two actions that matter from anywhere: start an
 * evaluation, or leave the desk. It is a Radix dialog (focus trap, scroll
 * lock, escape, restored focus) with cmdk doing the filtering and roving
 * selection, styled in the same panel language as the rest of the desk.
 */

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";

export type PaletteEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  /* Count shown at the right of the row (runs, gates, open findings). */
  badge?: number;
  /* Short status note, e.g. "OPENS PAGE". */
  hint?: string;
  /* The section the officer is already on. */
  current?: boolean;
  /* Extra search words that are not visible (the section id, synonyms). */
  keywords?: string;
  run: () => void;
};

export type PaletteGroup = {
  label: string;
  entries: PaletteEntry[];
};

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-ink-200/80 bg-[#fffdfb] px-1 font-code text-[8px] font-bold leading-none text-ink-500 shadow-[0_1px_0_rgba(11,12,15,0.04)] dark:border-white/[0.12] dark:bg-white/[0.05] dark:text-ink-300">
      {children}
    </kbd>
  );
}

function Hint({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500">
      <Key>{keys}</Key>
      {label.toUpperCase()}
    </span>
  );
}

export function WorkspacePalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[84] bg-night/65 backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          aria-describedby="workspace-palette-description"
          className="panel panel-lift fixed inset-x-0 top-[10vh] z-[85] mx-auto w-[min(600px,calc(100vw-1.5rem))] overflow-hidden rounded-[12px] p-0 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent"
          />
          <DialogPrimitive.Title className="sr-only">Jump to a workspace section</DialogPrimitive.Title>
          <DialogPrimitive.Description id="workspace-palette-description" className="sr-only">
            Search the sections of the desk and the actions available from anywhere. Use the arrow keys to move and
            Enter to open.
          </DialogPrimitive.Description>

          <Command label="Workspace command palette" className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-ink-100/80 px-4 dark:border-white/[0.06]">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-950 text-white dark:bg-white/[0.08] dark:text-ink-100">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <Command.Input
                autoFocus
                aria-label="Search workspace sections and actions"
                placeholder="Jump to a section or run an action…"
                className="h-[54px] w-full min-w-0 bg-transparent text-[16px] text-ink-900 outline-none placeholder:text-ink-500 sm:text-[14px] dark:text-ink-900"
              />
              <Key>ESC</Key>
            </div>

            <Command.List className="max-h-[min(58vh,430px)] overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="flex flex-col items-center px-6 py-12 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-ink-300 text-ink-400 dark:border-white/[0.15]">
                  <Search className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-[13px] font-semibold text-ink-800">No section matches that</p>
                <p className="mt-1.5 max-w-[34ch] text-[11.5px] leading-relaxed text-ink-500">
                  Try “approvals”, “calendar” or “rules” — or start a new evaluation.
                </p>
              </Command.Empty>

              {groups.map((group) => (
                <Command.Group
                  key={group.label}
                  heading={group.label}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-code [&_[cmdk-group-heading]]:text-[8px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.22em][&_[cmdk-group-heading]]:text-ink-500">
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <Command.Item
                        key={entry.id}
                        value={[entry.label, entry.keywords, entry.hint].filter(Boolean).join(" ")}
                        onSelect={() => {
                          onOpenChange(false);
                          entry.run();
                        }}
                        className="group relative flex h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-[12.5px] font-medium text-ink-700 transition-colors data-[selected=true]:bg-ink-950/[0.045] data-[selected=true]:text-ink-950 dark:text-ink-300 dark:data-[selected=true]:bg-white/[0.06] dark:data-[selected=true]:text-white"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-brand-500 opacity-0 transition-opacity group-data-[selected=true]:opacity-100"
                        />
                        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] border border-ink-200/70 bg-[#fffdfb] text-ink-500 transition-colors group-data-[selected=true]:border-ink-300 group-data-[selected=true]:text-brand-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-400 dark:group-data-[selected=true]:border-white/20 dark:group-data-[selected=true]:text-brand-400">
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.badge ? (
                          <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ink-100/80 px-1.5 font-code text-[8.5px] font-bold tabular text-ink-500 dark:bg-white/[0.09] dark:text-ink-700">
                            {entry.badge}
                          </span>
                        ) : null}
                        {entry.current ? (
                          <span className="shrink-0 font-code text-[7px] font-bold tracking-[0.16em] text-brand-600 dark:text-brand-400">
                            CURRENT
                          </span>
                        ) : entry.hint ? (
                          <span className="hidden shrink-0 font-code text-[7px] font-bold tracking-[0.14em] text-ink-500 sm:block">
                            {entry.hint}
                          </span>
                        ) : null}
                        <CornerDownLeft
                          className="h-3 w-3 shrink-0 text-ink-300 opacity-0 transition-opacity group-data-[selected=true]:opacity-100 dark:text-ink-400"
                          aria-hidden="true"
                        />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-ink-100/80 bg-ink-50/40 px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <div className="flex items-center gap-3.5">
                <Hint keys="↑↓" label="Move" />
                <Hint keys="↵" label="Open" />
              </div>
              <span className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-500">
                QUORUM · WORKSPACE
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
