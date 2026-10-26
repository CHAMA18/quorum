import { NextResponse, type NextRequest } from "next/server";
import { deleteOrgSessionByToken } from "@/lib/db";
import { clearedCookieOptions } from "@/lib/auth";
import { ORG_SESSION_COOKIE } from "@/lib/org-auth";

/**
 * POST /api/org/auth/logout — revoke the current ORGANIZATION session and
 * clear its cookie. Officer sessions are untouched: the two doors never
 * share state.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ORG_SESSION_COOKIE)?.value;
  if (token) {
    deleteOrgSessionByToken(token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ORG_SESSION_COOKIE, "", clearedCookieOptions());
  return res;
}
