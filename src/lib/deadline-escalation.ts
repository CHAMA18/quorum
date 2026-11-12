/** Deadline escalation levels for notifications. Pure. */

export type DeadlineLevel = "none" | "approaching" | "due-today" | "overdue" | "escalated";

export function deadlineLevel(dueAt: string, now = new Date()): DeadlineLevel {
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return "none";
  const days = Math.ceil((due - now.getTime()) / 86_400_000);
  if (days < -1) return "escalated";
  if (days < 0) return "overdue";
  if (days === 0) return "due-today";
  if (days <= 7) return "approaching";
  return "none";
}

/** Escalated deadlines re-notify daily; others dedupe on the deadline itself. */
export function deadlineDedupeSuffix(level: DeadlineLevel, now = new Date()): string {
  return level === "escalated" ? `:esc:${now.toISOString().slice(0, 10)}` : "";
}
