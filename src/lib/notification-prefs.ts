/** Per-user outbound notification preferences (in-app record always stays). Pure. */

export interface NotificationPrefs {
  email: boolean;
  whatsapp: boolean;
  slack: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { email: true, whatsapp: true, slack: true };

export function parsePrefs(raw: string | null | undefined): NotificationPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<NotificationPrefs>;
    return { email: p.email !== false, whatsapp: p.whatsapp !== false, slack: p.slack !== false };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function prefsKey(userId: string): string {
  return `notif-prefs:${userId}`;
}

export function channelAllowed(prefs: NotificationPrefs, channel: "email" | "whatsapp" | "slack"): boolean {
  return prefs[channel];
}
