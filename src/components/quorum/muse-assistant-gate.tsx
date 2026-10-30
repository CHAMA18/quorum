"use client";

import { usePathname } from "next/navigation";
import { MuseAssistant } from "./muse-assistant";

/**
 * The assistant is a desk tool, not part of the public shopfront. Every
 * non-root route (the supplier portal, documentation) keeps it. The root
 * path holds the landing page, the auth door and the workspace behind one
 * URL hash, so the dashboard mounts its own bubble in page.tsx where the
 * active view is known — gating on the hash here would go stale whenever
 * the app leaves the workspace with history.replaceState.
 */

export function MuseAssistantGate({ name }: { name?: string }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <MuseAssistant name={name} />;
}
