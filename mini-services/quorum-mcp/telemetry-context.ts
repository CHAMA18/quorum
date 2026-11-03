import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface TelemetryContext {
  traceId: string;
}

const context = new AsyncLocalStorage<TelemetryContext>();
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export function safeTraceId(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  return candidate && TRACE_ID.test(candidate) ? candidate : null;
}

export function requestTraceId(value: string | null | undefined): string {
  return safeTraceId(value) ?? randomUUID();
}

export function currentTraceId(): string | undefined {
  return context.getStore()?.traceId;
}

export function withTrace<T>(traceId: string, work: () => T): T {
  return context.run({ traceId }, work);
}
