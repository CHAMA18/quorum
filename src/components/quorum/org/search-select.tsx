"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The house dropdown — a searchable listbox that looks, moves and behaves
 * like the rest of the door: ink borders, brand focus ring, engineering
 * mono group labels, 160ms motion. Hand-built (rather than borrowed from
 * a foreign widget kit) so the trigger is pixel-identical to the door's
 * inputs and the popover obeys the same light/dark tokens.
 *
 * Discipline inside the wizard's <form>: Enter picks the active option
 * and Escape closes — neither ever submits the form. ArrowUp/Down move,
 * Home/End jump, Tab closes and moves on, pointer-down outside closes.
 * The list opens upward when the viewport is crowded below the trigger.
 */

export type SelectOption = {
  value: string;
  /** Right-aligned mono detail (e.g. "ZM · +260"). */
  hint?: string;
  /** Group label; first-seen order is preserved. */
  group?: string;
  /** Extra search text — aliases, dial digits, abbreviations. */
  keywords?: string;
};

type SearchSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Shows a small clear affordance when a value is set (for optional fields). */
  clearable?: boolean;
  /** Optional DOM id for external focus and label associations. */
  id?: string;
  /** Accessible name when the visible label is rendered by the caller. */
  label: string;
};

const EASE = [0.22, 1, 0.36, 1] as const;

const triggerCls =
  "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3.5 text-left text-[14px] outline-none transition-all hover:border-ink-300 focus-visible:border-brand-600 focus-visible:ring-4 focus-visible:ring-brand-600/10 dark:border-white/10 dark:bg-night-2 dark:hover:border-white/15";

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyText = "No matches — check the spelling.",
  clearable = false,
  id,
  label,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.value} ${o.keywords ?? ""} ${o.hint ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  /* Close on pointer-down outside. */
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  /* Keep the active option visible (no-op when it already is). */
  useEffect(() => {
    optionRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openList = () => {
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setQuery("");
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setOpenUp(window.innerHeight - rect.bottom < 300 && rect.top > 340);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (o: SelectOption) => {
    onChange(o.value);
    close();
  };

  const onQuery = (q: string) => {
    setQuery(q);
    setActive(0);
  };

  const last = Math.max(0, filtered.length - 1);
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(last, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // never submits the wizard
      const o = filtered[active];
      if (o) pick(o);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          triggerCls,
          selected ? "text-ink-950 dark:text-white" : "text-ink-300 dark:text-ink-500",
        )}
      >
        <span className="truncate">{selected ? selected.value : placeholder}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {clearable && selected ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Clear ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="grid h-5 w-5 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}
          <ChevronDown
            className={cn("h-4 w-4 text-ink-400 transition-transform duration-200", open && "rotate-180 text-brand-600")}
            aria-hidden="true"
          />
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: openUp ? 4 : -4, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: openUp ? 4 : -4, scale: 0.985 }}
            transition={{ duration: 0.16, ease: EASE }}
            className={cn(
              "absolute z-40 w-full overflow-hidden rounded-lg border border-ink-200 bg-white shadow-[0_24px_60px_rgba(11,12,15,0.16)] dark:border-white/10 dark:bg-night-2 dark:shadow-[0_24px_60px_rgba(0,0,0,0.6)]",
              openUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            <div className="flex items-center gap-2 border-b border-ink-100 px-3 dark:border-white/10">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                role="combobox"
                aria-expanded
                aria-controls={listboxId}
                aria-activedescendant={filtered[active] ? `${listboxId}-opt-${active}` : undefined}
                aria-label={`Search ${label}`}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-300 dark:text-white dark:placeholder:text-ink-500"
              />
            </div>

            <div ref={listRef} role="listbox" id={listboxId} aria-label={label} className="max-h-64 overflow-y-auto overscroll-contain py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center font-code text-[10px] tracking-[0.14em] text-ink-400 dark:text-ink-500">
                  {emptyText}
                </p>
              ) : (
                filtered.map((o, i) => {
                  const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
                  return (
                    <div key={o.value}>
                      {showGroup ? (
                        <p className="px-3 pb-1 pt-2 font-code text-[8.5px] font-semibold uppercase tracking-[0.2em] text-ink-400 dark:text-ink-500">
                          {o.group}
                        </p>
                      ) : null}
                      <div
                        id={`${listboxId}-opt-${i}`}
                        ref={(el) => {
                          if (el) optionRefs.current.set(i, el);
                          else optionRefs.current.delete(i);
                        }}
                        role="option"
                        aria-selected={o.value === value}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(o)}
                        onMouseEnter={() => setActive(i)}
                        className={cn(
                          "mx-1 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors",
                          i === active ? "bg-ink-50 dark:bg-ink-900" : "",
                          o.value === value
                            ? "font-semibold text-ink-950 dark:text-white"
                            : "text-ink-700 dark:text-ink-200",
                        )}
                      >
                        <span className="truncate">{o.value}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {o.hint ? (
                            <span className="font-code text-[9.5px] tracking-[0.08em] text-ink-400 dark:text-ink-500">{o.hint}</span>
                          ) : null}
                          {o.value === value ? <Check className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> : null}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
