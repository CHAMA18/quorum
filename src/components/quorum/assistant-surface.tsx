"use client";

import type { AuthUser } from "@/lib/auth-types";
import { MuseAssistant } from "./muse-assistant";

/**
 * Which agent surface the shell offers.
 *
 * Barry's floating bubble belongs to the working screens — never the landing
 * page or the auth door — and stands down on the Overview, where the desk
 * composer is the agent surface. Mounted outside the animated view so
 * "fixed" is measured against the viewport, not a transformed parent.
 */

export type ShellView = "landing" | "auth" | "dashboard";

export function shouldShowAssistant(
  view: ShellView,
  user: AuthUser | null,
  section: string,
): boolean {
  if (view !== "dashboard" || !user) return false;
  return section !== "mc-overview";
}

export function FloatingAssistant({
  view,
  user,
  section,
  name,
  onOpenDesk,
}: {
  view: ShellView;
  user: AuthUser | null;
  section: string;
  name?: string;
  onOpenDesk?: () => void;
}) {
  if (!shouldShowAssistant(view, user, section)) return null;
  return <MuseAssistant name={name} onOpenDesk={onOpenDesk} />;
}
