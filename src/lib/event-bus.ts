/**
 * Desk event bus: the publish side of real-time streaming.
 *
 * Producers (run lifecycle, gate decisions) publish typed events; the SSE
 * route subscribes. Events are kept in a bounded ring so a late subscriber
 * can catch up on recent activity, and every event carries a sequence number
 * so clients can detect a gap instead of silently missing a gate change.
 */

export interface DeskEvent { seq: number; type: string; ts: string; data: Record<string, unknown> }

const MAX_EVENTS = 200;
const events: DeskEvent[] = [];
const listeners = new Set<(e: DeskEvent) => void>();
let seq = 0;

export function publishEvent(type: string, data: Record<string, unknown> = {}): DeskEvent {
  const e: DeskEvent = { seq: ++seq, type, ts: new Date().toISOString(), data };
  events.push(e);
  if (events.length > MAX_EVENTS) events.shift();
  for (const fn of listeners) { try { fn(e); } catch { /* a bad listener never blocks the desk */ } }
  return e;
}

export function subscribeEvents(fn: (e: DeskEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recentEvents(afterSeq = 0, limit = 50): DeskEvent[] {
  return events.filter((e) => e.seq > afterSeq).slice(-Math.max(0, limit));
}
