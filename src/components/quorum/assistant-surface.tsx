"use client";

import type { AuthUser } from "@/lib/auth-types";
import { AssistantBubble } from "./assistant-bubble";

/**
 * Which agent surface the shell offers.
 *
 * The floating assistant's bubble belongs to the working screens — never the landing
 * page or the auth door — and stands down where the desk agent already has
 * its own surface: the Overview, where the chat (including tender building)
 * lives.
 * Mounted outside the animated view so "fixed" is measured against the
 * viewport, not a transformed parent.
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
  return <AssistantBubble name={name} onOpenDesk={onOpenDesk} />;
}
