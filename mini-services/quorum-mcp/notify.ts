import { createHmac } from "node:crypto";
import { gateSecret } from "./store";

/**
 * Best-effort webhook into the Next app's notification inbox.
 *
 * The sidecar owns the gate; the web app owns accounts and email addresses.
 * This one-way event carries no secrets — just the gate's identity and state —
 * and is signed so the web app can trust it. A failed delivery never blocks a
 * gate: the browser's inbox also reconciles pending gates on read.
 */
export async function notifyWeb(event: {
  type: "GATE_WAITING" | "GATE_DECIDED";
  gateId: string;
  tenderId: string;
  tool?: string;
  requiredOffice?: string;
  actor?: string;
  outcome?: string;
  note?: string;
}): Promise<void> {
  const base = (process.env.QUORUM_WEB_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
  const body = JSON.stringify({ ...event, ts: Date.now() });
  const secret = process.env.NOTIFY_SECRET?.trim() || gateSecret();
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  try {
    await fetch(`${base}/api/internal/notifications/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-quorum-notify": sig },
      body,
      signal: AbortSignal.timeout(3500),
    });
  } catch {
    /* The inbox reconciles on read; never let a notification break the gate. */
  }
}

/** Fire and forget — gate paths must not wait on the web app. */
export function notifyWebSoon(event: Parameters<typeof notifyWeb>[0]): void {
  void notifyWeb(event);
}
