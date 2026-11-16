import { sidecarOrigin } from "@/lib/sidecar-origin";
import { NextResponse } from "next/server";
import { storeHealth } from "@/lib/db";
import { postgresHealth } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIDECAR = sidecarOrigin();

/** Public liveness/readiness probe for Render and external uptime monitors. */
const MIN_FREE_BYTES = 50 * 1024 * 1024;

export async function GET() {
  const store = storeHealth();
  const database = await postgresHealth();
  const diskOk = store.freeBytes === null || store.freeBytes >= MIN_FREE_BYTES;
  const recordsOk = store.writable && diskOk;
  /* A configured database that cannot be reached makes the deployment
     unready: writes would only land in the local cache. */
  const persistenceOk = database.configured ? database.reachable : true;
  const ok = recordsOk && persistenceOk;
  try {
    const response = await fetch(`${SIDECAR}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`sidecar returned ${response.status}`);
    return NextResponse.json(
      {
        ok,
        service: "quorum-api",
        sidecar: "healthy",
        store: {
          persistence: store.persistence,
          pendingRevisions: store.pendingRevisions,
          lastSavedRevision: store.lastSavedRevision,
          lastSavedAt: store.lastSavedAt,
          lastError: store.lastError,
          bytes: store.bytes,
          freeBytes: store.freeBytes,
        },
        database,
      },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "quorum-api",
        sidecar: "unavailable",
        store: {
          persistence: store.persistence,
          pendingRevisions: store.pendingRevisions,
          lastSavedRevision: store.lastSavedRevision,
          lastSavedAt: store.lastSavedAt,
          lastError: store.lastError,
          bytes: store.bytes,
          freeBytes: store.freeBytes,
        },
        database,
      },
      { status: 503 },
    );
  }
}
