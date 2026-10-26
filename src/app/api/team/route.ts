import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import {
  createInvite,
  findInviteById,
  listInvites,
  listUsers,
  updateInvite,
} from "@/lib/db";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";

/**
 * Team membership = accounts in this flat workspace.
 * GET /api/team — the member list plus pending/claimed invites.
 * POST /api/team — generate an invite code. Body: { email?, role? }
 * DELETE /api/team?inviteId=... — revoke a pending invite.
 */

function requireUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token).catch(() => null);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — read-aloud safe

function newCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `Q-${code.slice(0, 4)}-${code.slice(4)}`;
}

const ROLES = new Set(["OFFICER", "COMMITTEE"]);

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Sign in to manage workspace access." }, { status: 401 });

  const invites = listInvites(100);
  const users = listUsers();

  const now = Date.now();
  const invitesView = invites.map((inv) => ({
    id: inv.id,
    code: inv.status === "PENDING" ? inv.code : null, // claimed/revoked codes stop being secret
    email: inv.email,
    role: inv.role,
    status: inv.status,
    inviterName: inv.inviterName,
    claimedByEmail: inv.claimedByEmail,
    createdAt: inv.createdAt,
    expiresInDays: Math.max(0, Math.ceil((inv.createdAt.getTime() + 14 * 86_400_000 - now) / 86_400_000)),
  }));

  return NextResponse.json({
    members: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      organization: u.organization,
      joined: u.createdAt,
      currentAccount: u.id === user.id,
    })),
    invites: invitesView,
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Sign in to invite teammates." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" && ROLES.has(body.role) ? body.role : "OFFICER";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 422 });
  }

  const invite = createInvite({
    code: newCode(),
    email: email || null,
    role,
    createdBy: user.id,
    inviterName: user.name,
  });

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        code: invite.code,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        createdAt: invite.createdAt,
        expiresInDays: 14,
      },
    },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Sign in to manage workspace access." }, { status: 401 });

  const inviteId = req.nextUrl.searchParams.get("inviteId") ?? "";
  if (!inviteId) return NextResponse.json({ error: "inviteId required." }, { status: 422 });

  const invite = findInviteById(inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: `Invite already ${invite.status.toLowerCase()}.` }, { status: 409 });
  }

  updateInvite(inviteId, { status: "REVOKED" });
  return NextResponse.json({ ok: true });
}
