import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, publicUser, SESSION_COOKIE } from "@/lib/auth";

/**
 * GET /api/auth/me — resolve the signed-in user from the session cookie.
 * Always 200: { user: null } when signed out.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await getUserFromToken(token).catch(() => null);
  return NextResponse.json({ user: user ? publicUser(user) : null });
}
