import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listLocalObjects, readLocalObject } from "@/lib/tender-local-store";
import { buildZip } from "@/lib/zip-store";

/** GET /api/tenders/:ref/documents-zip — the whole local pack as one ZIP. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "read_documents")) return NextResponse.json({ error: "Document access required." }, { status: 403 });
  const { ref } = await ctx.params;
  const objects = await listLocalObjects(ref);
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const o of objects.slice(0, 100)) {
    const got = await readLocalObject(ref, o.key);
    if (got) entries.push({ name: o.filename || o.key, data: got.bytes });
  }
  if (!entries.length) {
    /* Fall back to the edge (R2) listing through this app's own signed routes. */
    const origin = request.nextUrl.origin;
    const cookie = request.headers.get("cookie") ?? "";
    const listRes = await fetch(`${origin}/api/tenders/${encodeURIComponent(ref)}/docs`, { headers: { cookie }, cache: "no-store" }).catch(() => null);
    const listData = (await listRes?.json().catch(() => null)) as { objects?: { key: string; filename: string }[] } | null;
    for (const o of (listData?.objects ?? []).slice(0, 100)) {
      const linkRes = await fetch(`${origin}/api/tenders/${encodeURIComponent(ref)}/docs/link?key=${encodeURIComponent(o.key)}`, { headers: { cookie }, cache: "no-store" }).catch(() => null);
      const linkData = (await linkRes?.json().catch(() => null)) as { url?: string } | null;
      if (!linkData?.url) continue;
      const fileRes = await fetch(linkData.url).catch(() => null);
      if (fileRes?.ok) entries.push({ name: o.filename || o.key, data: new Uint8Array(await fileRes.arrayBuffer()) });
    }
  }
  if (!entries.length) return NextResponse.json({ error: "Documents could not be read." }, { status: 404 });
  return new NextResponse(Buffer.from(buildZip(entries)), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="tender-${ref}-documents.zip"` },
  });
}
