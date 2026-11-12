/** Offline outbox: queue safe writes, flush on reconnect. Storage is injectable for tests. */

export interface OutboxItem {
  id: string;
  url: string;
  body: string;
  queuedAt: string;
}

export interface OutboxStorage {
  read(): OutboxItem[];
  write(items: OutboxItem[]): void;
}

const KEY = "quorum-outbox";

export function browserOutboxStorage(): OutboxStorage {
  return {
    read() {
      try {
        const raw = localStorage.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    write(items) {
      try { localStorage.setItem(KEY, JSON.stringify(items.slice(-50))); } catch { /* full/blocked: queue stays in memory for callers */ }
    },
  };
}

export function enqueue(storage: OutboxStorage, url: string, body: unknown): OutboxItem[] {
  const items = [...storage.read(), { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, body: JSON.stringify(body), queuedAt: new Date().toISOString() }];
  storage.write(items);
  return items;
}

/** POST every queued write; keep failures queued. Returns how many were sent. */
export async function flushOutbox(storage: OutboxStorage, post: (url: string, body: string) => Promise<boolean>): Promise<number> {
  const items = storage.read();
  const remaining: OutboxItem[] = [];
  let sent = 0;
  for (const item of items) {
    const ok = await post(item.url, item.body).catch(() => false);
    if (ok) sent += 1;
    else remaining.push(item);
  }
  storage.write(remaining);
  return sent;
}
