import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthUser } from "@/lib/auth-types";

/* The rule is about where the bubble mounts, so the bubble itself is stubbed:
   rendering the real panel would pull in images, motion and live fetches. */
mock.module("./assistant-bubble", () => ({
  AssistantBubble: ({ name }: { name?: string; onOpenDesk?: () => void }) => (
    <div data-testid="floating-assistant">{name ?? "Assistant"}</div>
  ),
}));

const { FloatingAssistant, shouldShowAssistant } = await import("./assistant-surface");

const officer = { id: "u1", name: "Mwansa Banda", role: "OFFICER" } as unknown as AuthUser;

const render = (view: "landing" | "auth" | "dashboard", section: string, user: AuthUser | null) =>
  renderToStaticMarkup(
    <FloatingAssistant view={view} user={user} section={section} name="Mwansa" onOpenDesk={() => {}} />,
  );

describe("the floating assistant's surface", () => {
  test("is hidden on the Overview, where the desk composer is the agent", () => {
    expect(shouldShowAssistant("dashboard", officer, "mc-overview")).toBe(false);
    expect(render("dashboard", "mc-overview", officer)).toBe("");
  });

  test("is shown on every other workspace section", () => {
    for (const section of ["mc-gates", "mc-runs", "mc-findings", "mc-cycle", "mc-committee"]) {
      expect(shouldShowAssistant("dashboard", officer, section)).toBe(true);
      expect(render("dashboard", section, officer)).toContain('data-testid="floating-assistant"');
    }
  });

  test("is hidden on the landing page and the auth door", () => {
    expect(render("landing", "mc-gates", officer)).toBe("");
    expect(render("auth", "mc-gates", officer)).toBe("");
  });

  test("is hidden without a signed-in user", () => {
    expect(shouldShowAssistant("dashboard", null, "mc-gates")).toBe(false);
    expect(render("dashboard", "mc-gates", null)).toBe("");
  });
});
