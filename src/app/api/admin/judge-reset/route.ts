import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { NextRequest } from "next/server";

/**
 * POST /api/admin/judge-reset — boot the isolated judge demo (own store, own
 * ports 3100/3131, seeded demo accounts). The live workspace is never touched.
 */
export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_people")) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const child = spawn("bun", ["scripts/judge-proof.ts", "--keep-server"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return NextResponse.json({ started: true, url: "http://localhost:3100", note: "Isolated judge store on ports 3100/3131. Your live workspace is untouched." }, { status: 202 });
}
