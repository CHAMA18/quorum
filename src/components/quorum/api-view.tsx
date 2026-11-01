"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, BookOpen, Braces, Check, CircleAlert, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { API_DIRECTORY } from "@/lib/api-directory";
import { cn } from "@/lib/utils";

type CheckState = "checking" | "online" | "warning" | "offline";
type ApiCheck = { id: string; label: string; state: CheckState; detail: string };
type JsonResponse = { ok: boolean; status: number; body: Record<string, unknown> | null };

const INITIAL_CHECKS: ApiCheck[] = [
  { id: "discovery", label: "API discovery", state: "checking", detail: "Waiting for the API directory" },
  { id: "runtime", label: "Procurement runtime", state: "checking", detail: "Checking the MCP sidecar" },
  { id: "readiness", label: "Web API readiness", state: "checking", detail: "Checking the public health route" },
  { id: "session", label: "Workspace session", state: "checking", detail: "Resolving your Quorum session" },
  { id: "gateway", label: "REST gateway", state: "checking", detail: "Checking an authenticated sidecar read" },
];

const QUICKSTART = [
  'fetch("/api/tools?XTransformPort=3031", {',
  '  credentials: "same-origin",',
  '  headers: { accept: "application/json" }',
  '}).then((response) => response.json());',
].join("\n");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function getJson(path: string): Promise<JsonResponse> {
  try {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
    return {
      ok: response.ok,
      status: response.status,
      body: asRecord(await response.json().catch(() => null)),
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function responseError(response: JsonResponse, fallback: string) {
  const error = response.body?.error;
  if (typeof error === "string" && error.trim()) return error;
  return response.status ? fallback + " (HTTP " + response.status + ")" : fallback + " (request failed)";
}

function stateLabel(state: CheckState) {
  if (state === "online") return "READY";
  if (state === "warning") return "NOTICE";
  if (state === "offline") return "UNAVAILABLE";
  return "CHECKING";
}

function stateClass(state: CheckState) {
  if (state === "online") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  if (state === "warning") return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200";
  if (state === "offline") return "border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300";
  return "border-ink-200 bg-white text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-400";
}

export function ApiView() {
  const [checks, setChecks] = useState<ApiCheck[]>(INITIAL_CHECKS);
  const [checking, setChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState("");
  const baseUrl = "/api";
  const [copied, setCopied] = useState<string | null>(null);

  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    setChecks(INITIAL_CHECKS);

    const [directory, session] = await Promise.all([getJson("/api"), getJson("/api/auth/me")]);
    const directoryOk = directory.ok && directory.body?.service === API_DIRECTORY.service && Array.isArray(directory.body?.surfaces);
    const user = asRecord(session.body?.user);
    const hasSession = session.ok && Boolean(user);

    /* This route self-starts a stopped sidecar, so follow-up checks exercise
       the real request path after the procurement runtime is ready. */
    const runtime = await getJson("/api/agent-status");
    const health = asRecord(runtime.body?.health);
    const runtimeOk = runtime.ok && health?.service === "quorum-mcp";
    const sidecarState = typeof runtime.body?.sidecar === "string" ? runtime.body.sidecar : "unknown";

    const [readiness, gateway] = await Promise.all([
      getJson("/api/health"),
      hasSession && runtimeOk ? getJson("/api/tools?XTransformPort=3031") : Promise.resolve(null),
    ]);

    const healthOk = readiness.ok && readiness.body?.ok === true;
    const toolList = gateway ? gateway.body?.tools : null;
    const gatewayOk = Boolean(gateway?.ok && Array.isArray(toolList));
    const toolCount = Array.isArray(toolList) ? toolList.length : 0;
    const userName = typeof user?.name === "string" ? user.name : "Signed-in workspace session";

    setChecks([
      {
        id: "discovery",
        label: "API discovery",
        state: directoryOk ? "online" : "offline",
        detail: directoryOk ? API_DIRECTORY.surfaces.length + " API surfaces published at /api" : responseError(directory, "Discovery route did not return the API directory"),
      },
      {
        id: "runtime",
        label: "Procurement runtime",
        state: runtimeOk ? "online" : "offline",
        detail: runtimeOk ? "quorum-mcp is " + sidecarState + "; REST tools are responding" : responseError(runtime, "Procurement sidecar did not become ready"),
      },
      {
        id: "readiness",
        label: "Web API readiness",
        state: healthOk ? "online" : "offline",
        detail: healthOk ? "The web API can reach the procurement runtime" : responseError(readiness, "Health route reported the API unavailable"),
      },
      {
        id: "session",
        label: "Workspace session",
        state: hasSession ? "online" : session.ok ? "warning" : "offline",
        detail: hasSession ? "Authenticated as " + userName : session.ok ? "Sign in to use protected workspace API routes" : responseError(session, "Session route failed"),
      },
      {
        id: "gateway",
        label: "REST gateway",
        state: gatewayOk ? "online" : hasSession && runtimeOk ? "offline" : "warning",
        detail: gatewayOk
          ? toolCount + " tools reachable through the session and role-checked gateway"
          : !hasSession
            ? "Sign in to exercise protected REST routes"
            : !runtimeOk
              ? "Waiting for the procurement runtime"
              : gateway
                ? responseError(gateway, "Authenticated sidecar route failed")
                : "Gateway check was skipped",
      },
    ]);
    setLastChecked(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    setChecking(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runDiagnostics(), 0);
    return () => window.clearTimeout(timer);
  }, [runDiagnostics]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden rounded-[12px]" aria-labelledby="api-view-title">
        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
                <Braces className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-code text-[8px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">DEVELOPER · REST API</p>
                <h1 id="api-view-title" className="mt-1 text-[22px] font-black tracking-tight text-ink-950 dark:text-white">Connect to Quorum’s API.</h1>
                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
                  Explore the live API surfaces, see how each one is protected, and check the web service, procurement runtime, and authenticated gateway from this workspace.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runDiagnostics()}
              disabled={checking}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink-950 px-3.5 text-[11px] font-semibold text-white transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-ink-950 dark:hover:bg-ink-100"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} aria-hidden="true" />
              {checking ? "Checking API…" : "Run API checks"}
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.035]">
            <span className="font-code text-[8px] font-bold tracking-[0.15em] text-ink-500 dark:text-ink-400">BASE URL</span>
            <code className="min-w-0 flex-1 break-all text-[11px] text-ink-900 dark:text-white">{baseUrl}</code>
            <button type="button" onClick={() => void copy("base", baseUrl)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 text-[10px] font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[0.06]">
              {copied === "base" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied === "base" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden rounded-[12px]" aria-labelledby="api-diagnostics-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/[0.07] sm:px-7">
          <div className="flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            <h2 id="api-diagnostics-title" className="text-[14px] font-bold text-ink-950 dark:text-white">Live API diagnostics</h2>
          </div>
          <span className="font-code text-[8px] font-semibold tracking-[0.12em] text-ink-500 dark:text-ink-400">
            {lastChecked ? "LAST CHECKED " + lastChecked : "CHECKING ROUTES"}
          </span>
        </div>
        <div className="grid gap-px bg-ink-100 dark:bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-5">
          {checks.map((check) => (
            <div key={check.id} className="min-w-0 bg-white p-4 dark:bg-night-2" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-ink-900 dark:text-white">{check.label}</p>
                <span className={cn("shrink-0 rounded-full border px-2 py-1 font-code text-[7px] font-bold tracking-[0.1em]", stateClass(check.state))}>
                  {stateLabel(check.state)}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-600 dark:text-ink-300">{check.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <section className="panel overflow-hidden rounded-[12px]" aria-labelledby="api-surfaces-title">
          <div className="border-b border-ink-100 px-5 py-4 dark:border-white/[0.07] sm:px-6">
            <h2 id="api-surfaces-title" className="text-[14px] font-bold text-ink-950 dark:text-white">API surfaces</h2>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">Routes currently served by Quorum’s web application, procurement sidecar, and supplier portal.</p>
          </div>
          <div className="divide-y divide-ink-100 dark:divide-white/[0.07]">
            {API_DIRECTORY.surfaces.map((surface) => (
              <article key={surface.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold text-ink-900 dark:text-white">{surface.title}</h3>
                  <span className="rounded-full border border-ink-200 bg-white px-2 py-1 font-code text-[7px] font-bold tracking-[0.1em] text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-400">
                    {surface.auth}
                  </span>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-600 dark:text-ink-300">{surface.description}</p>
                <ul className="mt-2 space-y-1.5">
                  {surface.endpoints.map((endpoint) => (
                    <li key={endpoint} className="break-all font-mono text-[9px] leading-relaxed text-ink-700 dark:text-ink-200">{endpoint}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="panel overflow-hidden rounded-[12px]" aria-labelledby="api-auth-title">
            <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4 dark:border-white/[0.07]">
              <ShieldCheck className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <h2 id="api-auth-title" className="text-[14px] font-bold text-ink-950 dark:text-white">Authentication model</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              {Object.entries(API_DIRECTORY.authentication).map(([key, description]) => (
                <div key={key}>
                  <p className="font-code text-[7px] font-bold uppercase tracking-[0.15em] text-brand-700 dark:text-brand-300">{key === "remote" ? "REMOTE CLIENTS" : key}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-600 dark:text-ink-300">{description}</p>
                </div>
              ))}
            </div>
            <div className="mx-5 mb-5 rounded-lg border border-amber-300/70 bg-amber-50 px-3.5 py-3 dark:border-amber-500/20 dark:bg-amber-500/[0.07]">
              <p className="flex items-start gap-2 text-[10px] leading-relaxed text-amber-950 dark:text-amber-100">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                REST API access uses the signed-in session; Quorum does not issue generic REST API keys. For remote AI clients, use the authenticated read-only MCP setup in Integrations.
              </p>
            </div>
          </section>

          <section className="panel overflow-hidden rounded-[12px]" aria-labelledby="api-quickstart-title">
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/[0.07]">
              <div className="flex items-center gap-2.5">
                <Braces className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                <h2 id="api-quickstart-title" className="text-[14px] font-bold text-ink-950 dark:text-white">Same-origin request</h2>
              </div>
              <button
                type="button"
                onClick={() => void copy("example", QUICKSTART)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 text-[9px] font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[0.06]"
              >
                {copied === "example" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied === "example" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto bg-ink-950 p-4 text-[9px] leading-relaxed text-emerald-100"><code>{QUICKSTART}</code></pre>
            <div className="flex flex-wrap gap-2 px-5 py-4">
              <a href="/api" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[10px] font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[0.05]">
                Open API directory <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
              <a href={API_DIRECTORY.documentation} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[10px] font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[0.05]">
                Read documentation <BookOpen className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
