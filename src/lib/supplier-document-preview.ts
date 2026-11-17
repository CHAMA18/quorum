/**
 * Browser side of the document vault: open and save one stored file.
 *
 * Authorisation is the organization's httpOnly session cookie, which the route
 * resolves to the organization before touching a key. Nothing about the owner
 * travels in the request: the server derives it from the session.
 */

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}) },
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
