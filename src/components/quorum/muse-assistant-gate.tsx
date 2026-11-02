"use client";

import { usePathname } from "next/navigation";
import { MuseAssistant } from "./muse-assistant";

/**
 * The assistant belongs in working areas, not on sign-in screens. The root
 * path holds the landing page, the officer auth door and the workspace behind
 * one URL hash, so the dashboard mounts its own bubble in page.tsx where the
 * active view is known. The supplier sign-in door is /org; its signed-in
 * console remains available at /org/dashboard.
 */

export function MuseAssistantGate({ name }: { name?: string }) {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/org") return null;
  return <MuseAssistant name={name} />;
}
