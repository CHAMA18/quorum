import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import {
  createSession as storeCreateSession,
  deleteSessionByToken,
  findSessionWithUser,
} from "@/lib/db";
import type { AuthUser } from "@/lib/auth-types";

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "quorum_session";
const DAY_MS = 24 * 60 * 60 * 1000;

/* ── Passwords (scrypt, no native deps) ─────────────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* ── Sessions (opaque token in DB, httpOnly cookie) ─────────────────────── */

export async function createSession(userId: string, remember: boolean) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * DAY_MS);
  storeCreateSession(userId, expiresAt, token);
  return { token, expiresAt };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    expires: expiresAt,
  };
}

export function clearedCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 0,
  };
}

export async function getUserFromToken(token: string | undefined) {
  if (!token) return null;
  const found = findSessionWithUser(token);
  if (!found) return null;
  if (found.session.expiresAt.getTime() < Date.now()) {
    deleteSessionByToken(token);
    return null;
  }
  /* Suspension is checked on every request, not just at sign-in. An open tab
     stops working the moment an admin suspends the account. */
  if (found.user.status === "SUSPENDED") {
    deleteSessionByToken(token);
    return null;
  }
  return found.user;
}

export function publicUser(u: {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  organization: string | null;
  role: AuthUser["role"];
}): AuthUser {
  return { id: u.id, workspaceId: u.workspaceId, name: u.name, email: u.email, organization: u.organization, role: u.role };
}

/* ── Naive in-memory rate limiter (per process, per IP) ─────────────────── */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientKey(req: Request, scope: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  return `${scope}:${ip}`;
}
