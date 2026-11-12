import { recentEvents, subscribeEvents } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

/**
 * Real-time desk events (SSE). Only type, sequence and timestamp cross the
 * wire — never bidder names, values or payloads — matching the public
 * summary's disclosure rule. Clients pass ?after=<seq> to catch up.
 *
 * Server-paced at ~20 messages/second: the first frame goes out immediately,
 * the rest drain from a queue so a catch-up backlog never bursts.
 */
export async function GET(req: Request) {
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const queue: string[] = [];
      let first = true;
      const frame = (seq: number | string, body: Record<string, unknown>) =>
        `${seq !== "" ? `id: ${seq}\n` : ""}data: ${JSON.stringify(body)}\n\n`;
      const enqueue = (chunk: string) => {
        if (first) {
          first = false;
          try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
        } else queue.push(chunk);
      };
      timer = setInterval(() => {
        const chunk = queue.shift();
        if (chunk) { try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ } }
      }, 50);
      for (const e of recentEvents(after)) enqueue(frame(e.seq, { seq: e.seq, type: e.type, ts: e.ts }));
      enqueue(frame("", { type: "ready", ts: new Date().toISOString() }));
      unsubscribe = subscribeEvents((e) => enqueue(frame(e.seq, { seq: e.seq, type: e.type, ts: e.ts })));
    },
    cancel() { unsubscribe(); if (timer) clearInterval(timer); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
