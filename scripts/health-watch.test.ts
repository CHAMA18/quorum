import { describe, expect, test } from "bun:test";
import { decideNotification, evaluateHealth, expiryDue, expiryWarning, parseArgs } from "./health-watch";

interface HealthBody {
  ok: boolean;
  service: string;
  sidecar: string;
  store: {
    persistence: string;
    pendingRevisions: number;
    lastSavedRevision: number;
    lastSavedAt: string | null;
    lastError: string | null;
    bytes: number;
    freeBytes: number;
  };
  database: { configured: boolean; reachable: boolean; latencyMs: number; error: string | null };
}

const healthyBody = (): HealthBody => ({
  ok: true,
  service: "quorum-api",
  sidecar: "healthy",
  store: {
    persistence: "postgres",
    pendingRevisions: 0,
    lastSavedRevision: 12,
    lastSavedAt: "2026-11-16T09:00:00.000Z",
    lastError: null,
    bytes: 1421,
    freeBytes: 100_360_6016,
  },
  database: { configured: true, reachable: true, latencyMs: 3, error: null },
});

describe("evaluateHealth", () => {
  test("a fully healthy payload has nothing to report", () => {
    expect(evaluateHealth(200, healthyBody())).toEqual([]);
  });

  test("a 503 is a failure even when the payload still claims ok", () => {
    const problems = evaluateHealth(503, healthyBody());
    expect(problems.join(" ")).toContain("HTTP 503");
  });

  test("a 200 that is failing to persist is caught", () => {
    const body = healthyBody();
    body.store.lastError = "could not serialize access due to concurrent update";
    const problems = evaluateHealth(200, body);
    expect(problems.join(" ")).toContain("store write failing");
  });

  test("a queued write backlog is caught", () => {
    const body = healthyBody();
    body.store.pendingRevisions = 2;
    expect(evaluateHealth(200, body).join(" ")).toContain("2 queued store write");
  });

  test("a configured but unreachable database names the reason", () => {
    const body = healthyBody();
    body.database = { configured: true, reachable: false, latencyMs: 0, error: "ECONNREFUSED" };
    const problems = evaluateHealth(200, body);
    expect(problems.join(" ")).toContain("unreachable: ECONNREFUSED");
  });

  test("an unconfigured database is not a failure", () => {
    const body = healthyBody();
    body.database = { configured: false, reachable: false, latencyMs: 0, error: null };
    expect(evaluateHealth(200, body)).toEqual([]);
  });

  test("a degraded sidecar is a failure", () => {
    const body = { ...healthyBody(), sidecar: "unavailable" };
    expect(evaluateHealth(200, body).join(" ")).toContain("sidecar is unavailable");
  });

  test("a non-JSON response is a failure rather than a pass", () => {
    expect(evaluateHealth(200, null).join(" ")).toContain("no JSON object");
  });
});

describe("decideNotification", () => {
  const now = new Date("2026-11-16T10:00:00.000Z");
  const failing = { failing: true, problems: ["api: HTTP 503"] };
  const passing = { failing: false, problems: [] };

  test("the first failure of a run alerts immediately", () => {
    const decision = decideNotification(null, failing, now, 60 * 60_000);
    expect(decision.notify).toBe(true);
    expect(decision.kind).toBe("down");
    expect(decision.nextState.since).toBe(now.toISOString());
  });

  test("a repeated failure inside the reminder window stays quiet", () => {
    const previous = decideNotification(null, failing, now, 60 * 60_000).nextState;
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(decideNotification(previous, failing, later, 60 * 60_000).notify).toBe(false);
  });

  test("a long outage reminds once the window passes", () => {
    const previous = decideNotification(null, failing, now, 60 * 60_000).nextState;
    const later = new Date(now.getTime() + 61 * 60_000);
    const decision = decideNotification(previous, failing, later, 60 * 60_000);
    expect(decision.notify).toBe(true);
    expect(decision.kind).toBe("reminder");
    /* The outage start does not move on a reminder. */
    expect(decision.nextState.since).toBe(previous.since);
  });

  test("recovery alerts once and clears the problem list", () => {
    const previous = decideNotification(null, failing, now, 60 * 60_000).nextState;
    const decision = decideNotification(previous, passing, now, 60 * 60_000);
    expect(decision.kind).toBe("recovered");
    expect(decision.nextState.problems).toEqual([]);
  });

  test("a healthy first run says nothing", () => {
    const decision = decideNotification(null, passing, now, 60 * 60_000);
    expect(decision.notify).toBe(false);
    expect(decision.nextState.status).toBe("healthy");
  });
});

describe("expiryWarning", () => {
  const now = new Date("2026-11-16T10:00:00.000Z");
  const expiry = new Date("2026-12-16T00:00:00.000Z");

  test("stays quiet while the deadline is far off", () => {
    expect(expiryWarning(expiry, now, 14)).toBeNull();
  });

  test("warns inside the window and names the date", () => {
    const warning = expiryWarning(expiry, new Date("2026-12-10T00:00:00.000Z"), 14);
    expect(warning?.daysLeft).toBe(6);
    expect(warning?.text).toContain("2026-12-16");
  });

  test("an expired database says so rather than showing negative days", () => {
    const warning = expiryWarning(expiry, new Date("2026-12-18T00:00:00.000Z"), 14);
    expect(warning?.text).toContain("expired 2 day(s) ago");
  });

  test("no configured expiry means no warning", () => {
    expect(expiryWarning(null, now, 3650)).toBeNull();
  });

  test("the warning is daily rather than per run", () => {
    const first = { status: "healthy" as const, since: now.toISOString(), lastNotifiedAt: null, problems: [] };
    expect(expiryDue(null, now)).toBe(true);
    expect(expiryDue({ ...first, expiryNotifiedOn: "2026-11-16" }, now)).toBe(false);
    expect(expiryDue({ ...first, expiryNotifiedOn: "2026-11-15" }, now)).toBe(true);
  });
});

describe("parseArgs", () => {
  test("defaults target the deployed services", () => {
    const options = parseArgs([], {});
    expect(options.api).toBe("https://quorum-api-tgw2.onrender.com");
    expect(options.staticUrl).toBe("https://quorum-static.onrender.com");
    expect(options.attempts).toBe(3);
  });

  test("--no-static watches only the API", () => {
    expect(parseArgs(["--no-static"], {}).staticUrl).toBeNull();
  });

  test("the webhook comes from the environment unless a flag overrides it", () => {
    expect(parseArgs([], { HEALTH_ALERT_WEBHOOK: "https://example.test/hook" }).webhook).toBe(
      "https://example.test/hook",
    );
    expect(parseArgs(["--webhook", "https://flag.test/hook"], {}).webhook).toBe("https://flag.test/hook");
  });

  test("an unknown flag is a usage error, not a silent pass", () => {
    expect(() => parseArgs(["--nope"], {})).toThrow("unknown flag");
  });

  test("the expiry date comes from the environment, and a bad one is ignored", () => {
    expect(parseArgs([], { DATABASE_EXPIRES_AT: "2026-12-16" }).expiresAt?.toISOString()).toContain("2026-12-16");
    expect(parseArgs([], { DATABASE_EXPIRES_AT: "not-a-date" }).expiresAt).toBeNull();
    expect(parseArgs([], {}).expiryWarnDays).toBe(14);
  });
});
