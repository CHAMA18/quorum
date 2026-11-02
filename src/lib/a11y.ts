import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE_SELECTOR =
  'a[href]:not([tabindex="-1"]), button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]), select:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]:not([tabindex="-1"])';

/** Follow the visitor's motion preference for programmatic scrolling. */
export function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Return the next roving-tab stop for the standard horizontal tab keys. */
export function nextRovingTabIndex(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Keep Tab navigation inside the active dialog, skipping hidden controls. */
export function trapTabFocus<T extends HTMLElement>(event: ReactKeyboardEvent<T>, root: HTMLElement | null) {
  if (event.key !== "Tab") return;
  const activeModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
  if (activeModal && root?.contains(activeModal) && activeModal !== root) return;
  const nodes = Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
    (node) => {
      const nestedModal = node.closest('[role="dialog"][aria-modal="true"]');
      const belongsToNestedModal = nestedModal && nestedModal !== root && root?.contains(nestedModal);
      return (
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== "hidden" &&
        !node.closest('[aria-hidden="true"], [inert]') &&
        !belongsToNestedModal
      );
    },
  );
  if (nodes.length === 0) {
    event.preventDefault();
    root?.focus();
    return;
  }

  const activeIndex = nodes.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && activeIndex <= 0) {
    event.preventDefault();
    nodes[nodes.length - 1].focus();
  } else if (!event.shiftKey && (activeIndex === nodes.length - 1 || activeIndex === -1)) {
    event.preventDefault();
    nodes[0].focus();
  }
}
