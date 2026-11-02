import { getFirebaseIdToken } from "@/lib/firebase";
import type { MetaProfileDocumentScan } from "@/lib/meta-bid-document-assist";

/**
 * Browser side of the document vault: open, save and scan one stored file.
 *
 * Every call carries the signed-in supplier's Firebase identity token, because
 * the routes verify the organization *and* the person — the org cookie alone is
 * not enough to read another member's standing evidence.
 */

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Reconnect this supplier account to Firebase, then try again.");
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

async function failureMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

export async function loadProfileDocumentPreview(key: string): Promise<Blob> {
  const res = await authorizedFetch(`/api/org/documents/content?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(await failureMessage(res, "This document could not be opened."));
  return res.blob();
}

export async function saveProfileDocument(key: string, filename: string): Promise<void> {
  const res = await authorizedFetch(`/api/org/documents/content?download=1&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(await failureMessage(res, "This document could not be downloaded."));
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "document";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  /* Give the browser a beat to start the save before the blob is released. */
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function scanProfileDocument(key: string): Promise<MetaProfileDocumentScan> {
  const res = await authorizedFetch("/api/org/documents/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, "Muse Spark could not scan this document."));
  const data = (await res.json().catch(() => null)) as { review?: MetaProfileDocumentScan } | null;
  if (!data?.review) throw new Error("Muse Spark returned an empty scan. Try again in a moment.");
  return data.review;
}
