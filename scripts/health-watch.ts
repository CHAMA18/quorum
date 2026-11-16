#!/usr/bin/env bun
/**
 * Independent health watchdog for the deployed services.
 *
 * The deployed app can fail in ways `GET /api/health` reports honestly but
 * nobody reads: a crash loop, a database that answers but refuses writes, a
 * store backlog that never drains. This script is meant to be run from outside
 * the service — a Render cron job, any uptime monitor, or an operator shell —
 * so it survives the very outage it is watching for.
 *
 * The exit code is the alert signal: 0 healthy, 1 unhealthy. That is
 * deliberate. Render notifies on a failed cron job run, and every uptime
 * monitor understands a non-zero exit, so no vendor or secret is required to
 * get told. When you do want a push channel, set `HEALTH_ALERT_WEBHOOK` (or
 * `--webhook`) and the same run posts to Slack, Discord or Google Chat.
 *
 * A 200 is not proof of health. `evaluateHealth` checks the payload the app
 * returns: `ok`, the sidecar, database reachability, the last store write
 * error and the queued-write backlog. A deployment that answers 200 while
 * failing to persist is down for the only purpose that matters.
 *
 *   bun scripts/health-watch.ts
 *   bun scripts/health-watch.ts --json
 *   HEALTH_ALERT_WEBHOOK=https://hooks.slack.com/... bun scripts/health-watch.ts
 *
 * Environment:
 *   QUORUM_API_URL          default https://quorum-api-tgw2.onrender.com
 *   QUORUM_STATIC_URL       default https://quorum-static.onrender.com
 *   HEALTH_ALERT_WEBHOOK    optional; posts alerts here
 *   HEALTH_ALERT_EMAIL_TO   optional; emails alerts here via Resend
 *   RESEND_API_KEY
 *   RESEND_FROM             the sender on the verified Resend domain
 *   DATABASE_EXPIRES_AT     ISO date the managed database expires (YYYY-MM-DD)
 *   HEALTH_EXPIRY_WARN_DAYS default 14
 *   HEALTH_WATCH_STATE      default .health-watch-state.json
 *
 * Flags: --api <url> --static <url> --no-static --webhook <url> --state <path>
 *        --attempts <n> --timeout <ms> --remind <minutes> --json
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_API_URL = "https://quorum-api-tgw2.onrender.com";
export const DEFAULT_STATIC_URL = "https://quorum-static.onrender.com";

/** Mirrors the readiness floor in `src/app/api/health/route.ts`. */
export const MIN_FREE_BYTES = 50 * 1024 * 1024;

export interface TargetResult {
  target: string;
  url: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  problems: string[];
}

export interface WatchState {
  status: "healthy" | "failing";
  since: string;
  lastNotifiedAt: string | null;
  problems: string[];
  /** UTC date (YYYY-MM-DD) the expiry warning was last sent, so it is daily. */
  expiryNotifiedOn?: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Decide whether a health response means "serving". Every problem names the
 * field that caused it, so the alert says what broke rather than "unhealthy".
 */
export function evaluateHealth(status: number, body: unknown): string[] {
  const problems: string[] = [];
  if (status !== 200) problems.push(`health endpoint returned HTTP ${status}`);

  if (!isObject(body)) {
    problems.push("health endpoint returned no JSON object");
    return problems;
  }

  if (body.ok !== true) problems.push("payload reports ok=false");

  if (body.sidecar !== undefined && body.sidecar !== "healthy") {
    problems.push(`sidecar is ${String(body.sidecar)}`);
  }

  const database = isObject(body.database) ? body.database : null;
  if (database?.configured === true && database.reachable !== true) {
    const reason = typeof database.error === "string" ? `: ${database.error}` : "";
    problems.push(`database configured but unreachable${reason}`);
  }

  const store = isObject(body.store) ? body.store : null;
  if (store) {
    if (typeof store.lastError === "string" && store.lastError.length > 0) {
      problems.push(`store write failing: ${store.lastError}`);
    }
    const pending = num(store.pendingRevisions);
    if (pending !== null && pending > 0) {
      problems.push(`${pending} queued store write(s) not yet persisted`);
    }
    const free = num(store.freeBytes);
    if (free !== null && free < MIN_FREE_BYTES) {
      problems.push(`disk free ${free} bytes is under the ${MIN_FREE_BYTES} byte floor`);
    }
  }

  return problems;
}

async function probe(url: string, timeoutMs: number, inspect: boolean): Promise<TargetResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!inspect) {
      return {
        target: url,
        url,
        ok: response.status === 200,
        status: response.status,
        latencyMs,
        problems: response.status === 200 ? [] : [`static site returned HTTP ${response.status}`],
      };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const problems = evaluateHealth(response.status, body);
    return { target: url, url, ok: problems.length === 0, status: response.status, latencyMs, problems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      target: url,
      url,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      problems: [`request failed: ${message}`],
    };
  }
}

export interface Decision {
  notify: boolean;
  kind: "down" | "recovered" | "reminder" | null;
  nextState: WatchState;
}

/**
 * Alert once when a target goes down, once when it comes back, and then on a
 * slow reminder cadence — an alert every run is an alert nobody reads.
 */
export function decideNotification(
  previous: WatchState | null,
  current: { failing: boolean; problems: string[] },
  now: Date,
  remindMs: number,
): Decision {
  const iso = now.toISOString();

  if (current.failing) {
    const failure = previous?.status === "failing" ? previous : null;
    const lastNotified = failure?.lastNotifiedAt ? Date.parse(failure.lastNotifiedAt) : NaN;
    const dueForReminder = Number.isNaN(lastNotified) || now.getTime() - lastNotified >= remindMs;
    const notify = failure === null || dueForReminder;
    return {
      notify,
      kind: notify ? (failure ? "reminder" : "down") : null,
      nextState: {
        status: "failing",
        since: failure ? failure.since : iso,
        lastNotifiedAt: notify ? iso : failure.lastNotifiedAt,
        problems: current.problems,
        expiryNotifiedOn: previous?.expiryNotifiedOn,
      },
    };
  }

  const recovering = previous?.status === "failing";
  return {
    notify: recovering,
    kind: recovering ? "recovered" : null,
    nextState: {
      status: "healthy",
      since: recovering ? iso : (previous?.since ?? iso),
      lastNotifiedAt: recovering ? iso : (previous?.lastNotifiedAt ?? null),
      problems: [],
      expiryNotifiedOn: previous?.expiryNotifiedOn,
    },
  };
}

/**
 * The free Render Postgres that backs this deployment expires on a fixed date,
 * after which writes stop landing somewhere durable. Nothing in the app can
 * see that date, so it is passed in, and warned about before it bites.
 */
export function expiryWarning(
  expiresAt: Date | null,
  now: Date,
  warnDays: number,
): { daysLeft: number; text: string; subject: string } | null {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return null;
  const day = 86_400_000;
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / day);
  if (daysLeft > warnDays) return null;
  const date = expiresAt.toISOString().slice(0, 10);
  const text =
    daysLeft > 0
      ? `The managed Postgres expires in ${daysLeft} day(s), on ${date}. Upgrade it or writes stop persisting.`
      : `The managed Postgres expired ${Math.abs(daysLeft)} day(s) ago (${date}). Writes are at risk now.`;
  return { daysLeft, text, subject: `Quorum Postgres expires in ${daysLeft} day(s)` };
}

/** Warn once a day, not once a run. */
export function expiryDue(state: WatchState | null, now: Date): boolean {
  return state?.expiryNotifiedOn !== now.toISOString().slice(0, 10);
}

function alertText(kind: "down" | "recovered" | "reminder", state: WatchState): string {
  if (kind === "recovered") {
    return `Quorum is healthy again (down since ${state.since}).`;
  }
  const headline =
    kind === "down"
      ? `Quorum is unhealthy (since ${new Date().toLocaleString("en-GB", { timeZone: "UTC" })} UTC)`
      : `Quorum is still unhealthy (down since ${state.since})`;
  return `${headline}:\n${state.problems.map((problem) => `• ${problem}`).join("\n")}`;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Email through the Resend account the app already sends notifications with.
 * Optional: without the three variables the watchdog still reports and exits
 * non-zero, which is what a cron failure notification consumes.
 */
async function postEmail(to: string, subject: string, text: string, timeoutMs: number): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) {
    console.error("health-watch: HEALTH_ALERT_EMAIL_TO is set but RESEND_API_KEY/RESEND_FROM are not");
    return;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(`health-watch: alert email rejected: HTTP ${response.status} ${detail.slice(0, 200)}`);
      return;
    }
    console.log(`health-watch: alert emailed to ${to}`);
  } catch (error) {
    console.error(`health-watch: alert email failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function postAlert(webhook: string, text: string, timeoutMs: number): Promise<void> {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* `text` is Slack/Google Chat, `content` is Discord; each ignores the other. */
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.error(`health-watch: alert webhook returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`health-watch: alert webhook failed: ${error instanceof Error ? error.message : error}`);
  }
}

function readState(file: string): WatchState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (isObject(parsed) && (parsed.status === "healthy" || parsed.status === "failing")) {
      return parsed as unknown as WatchState;
    }
  } catch {
    /* No state yet, or a torn file: treat as a first run. */
  }
  return null;
}

interface Options {
  api: string;
  staticUrl: string | null;
  webhook: string | null;
  emailTo: string | null;
  expiresAt: Date | null;
  expiryWarnDays: number;
  statePath: string;
  attempts: number;
  timeoutMs: number;
  remindMs: number;
  json: boolean;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const options: Options = {
    api: env.QUORUM_API_URL ?? DEFAULT_API_URL,
    staticUrl: env.QUORUM_STATIC_URL ?? DEFAULT_STATIC_URL,
    webhook: env.HEALTH_ALERT_WEBHOOK ?? null,
    emailTo: env.HEALTH_ALERT_EMAIL_TO ?? null,
    expiresAt: parseDate(env.DATABASE_EXPIRES_AT),
    expiryWarnDays: Number(env.HEALTH_EXPIRY_WARN_DAYS ?? 14),
    statePath: env.HEALTH_WATCH_STATE ?? ".health-watch-state.json",
    attempts: 3,
    timeoutMs: 10_000,
    remindMs: 60 * 60_000,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    switch (flag) {
      case "--api":
        options.api = next();
        break;
      case "--static":
        options.staticUrl = next();
        break;
      case "--no-static":
        options.staticUrl = null;
        break;
      case "--webhook":
        options.webhook = next();
        break;
      case "--email":
        options.emailTo = next();
        break;
      case "--expires":
        options.expiresAt = parseDate(next());
        break;
      case "--expiry-warn-days":
        options.expiryWarnDays = Number(next());
        break;
      case "--state":
        options.statePath = next();
        break;
      case "--attempts":
        options.attempts = Number(next());
        break;
      case "--timeout":
        options.timeoutMs = Number(next());
        break;
      case "--remind":
        options.remindMs = Number(next()) * 60_000;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!Number.isFinite(options.attempts) || options.attempts < 1) throw new Error("--attempts must be >= 1");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout must be >= 1");
  return options;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`health-watch: ${error instanceof Error ? error.message : error}`);
    return 2;
  }

  const apiHealthUrl = `${options.api.replace(/\/$/, "")}/api/health`;
  const staticUrl = options.staticUrl ? options.staticUrl.replace(/\/$/, "") + "/" : null;

  let results: TargetResult[] = [];
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const probes: Promise<TargetResult>[] = [probe(apiHealthUrl, options.timeoutMs, true)];
    if (staticUrl) probes.push(probe(staticUrl, options.timeoutMs, false));
    results = await Promise.all(probes);
    if (results.every((result) => result.ok)) break;
    if (attempt < options.attempts) {
      /* A cold Render instance can miss one probe; back off before believing it. */
      await sleep(Math.min(2_000 * attempt, 8_000));
    }
  }

  const problems = results.flatMap((result) =>
    result.problems.map((problem) => `${result.url}: ${problem}`),
  );
  const failing = problems.length > 0;
  const now = new Date();

  const previous = readState(options.statePath);
  /* A reminder cadence shorter than the run interval would just repeat noise. */
  const decision = decideNotification(previous, { failing, problems }, now, options.remindMs);

  if (decision.notify && decision.kind) {
    const text = alertText(decision.kind, decision.nextState);
    console.error(`health-watch: ${decision.kind} — ${text}`);
    if (options.webhook) await postAlert(options.webhook, text, options.timeoutMs);
    if (options.emailTo) {
      const subject =
        decision.kind === "recovered" ? "Quorum recovered" : `Quorum is ${decision.kind === "reminder" ? "still " : ""}unhealthy`;
      await postEmail(options.emailTo, subject, text, options.timeoutMs);
    }
  }

  /* The database expiring does not make the API unready today, so it warns
     without failing the run — but it still reaches the same channels. */
  const expiry = expiryWarning(options.expiresAt, now, options.expiryWarnDays);
  if (expiry && expiryDue(previous, now)) {
    console.error(`health-watch: expiry — ${expiry.text}`);
    if (options.webhook) await postAlert(options.webhook, expiry.text, options.timeoutMs);
    if (options.emailTo) await postEmail(options.emailTo, expiry.subject, expiry.text, options.timeoutMs);
    decision.nextState.expiryNotifiedOn = now.toISOString().slice(0, 10);
  }

  try {
    mkdirSync(path.dirname(path.resolve(options.statePath)), { recursive: true });
    writeFileSync(options.statePath, JSON.stringify(decision.nextState, null, 2));
  } catch (error) {
    console.error(`health-watch: could not write state: ${error instanceof Error ? error.message : error}`);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          checkedAt: now.toISOString(),
          ok: !failing,
          problems,
          results,
          alert: decision.kind,
          expiry: expiry ? { daysLeft: expiry.daysLeft, text: expiry.text } : null,
        },
        null,
        2,
      ),
    );
  } else {
    for (const result of results) {
      const latency = result.latencyMs === null ? "n/a" : `${result.latencyMs} ms`;
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.url} (${result.status ?? "no response"}, ${latency})`);
    }
    for (const problem of problems) console.log(`  - ${problem}`);
    if (expiry) console.log(`WARN ${expiry.text}`);
    if (!failing) console.log("healthy");
  }

  return failing ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
