import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
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

/* Secure in production: a procurement session must never travel over plain
   HTTP. Development stays usable over localhost, where there is no TLS. */
const SECURE_COOKIES = process.env.NODE_ENV === "production";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: SECURE_COOKIES,
    path: "/",
    expires: expiresAt,
  };
}

export function clearedCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: SECURE_COOKIES,
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

/* ── Rate limiter on a shared file, not process memory ──────────────────
   An in-memory bucket is forgotten on restart, so an attacker simply waits
   for a deploy or hits another worker. The counters live in db/rate-limit.json
   (atomic write, shared by every process on the host) with the in-memory map
   as the read cache. */

type Bucket = { count: number; resetAt: number };

const RATE_FILE = process.env.QUORUM_RATE_FILE?.trim() || path.join(process.cwd(), "db", "rate-limit.json");
let buckets: Record<string, Bucket> | null = null;
let lastWrite = 0;

function loadBuckets(): Record<string, Bucket> {
  if (buckets) return buckets;
  try {
    buckets = JSON.parse(readFileSync(RATE_FILE, "utf8")) as Record<string, Bucket>;
  } catch {
    buckets = {};
  }
  return buckets;
}

function saveBuckets(store: Record<string, Bucket>) {
  const now = Date.now();
  try {
    mkdirSync(path.dirname(RATE_FILE), { recursive: true });
    for (const key of Object.keys(store)) {
      if (store[key].resetAt < now) delete store[key];
    }
    const tmp = `${RATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, RATE_FILE);
  } catch {
    /* a read-only host keeps the in-memory guard — degraded, never open */
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const store = loadBuckets();
  const bucket = store[key];
  let allowed: boolean;
  if (!bucket || bucket.resetAt < now) {
    store[key] = { count: 1, resetAt: now + windowMs };
    allowed = true;
  } else {
    bucket.count += 1;
    allowed = bucket.count <= limit;
  }
  /* Persist at most once a second: the counter still survives a restart, and a
     login storm does not turn into a write storm. */
  if (now - lastWrite > 1000) {
    lastWrite = now;
    saveBuckets(store);
  }
  return allowed;
}

export function clientKey(req: Request, scope: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  return `${scope}:${ip}`;
}
