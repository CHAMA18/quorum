import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, clientKey, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { getSetting, recordStepUpIssued } from "@/lib/db";
import { gateDocHash, signStepUpToken, STEP_UP_TTL_MS } from "@/lib/step-up";
import { verifyTotp } from "@/lib/totp";
import { isAdminRole } from "@/lib/permissions";

const SIDECAR = process.env.QUORUM_SIDECAR_URL ?? "http://127.0.0.1:3031";

type GateShape = { id: string; inputs: unknown; status: string; tenderId: string; tool: string };

/**
 * POST /api/auth/step-up
 * Body: { gateId, password?, code? }
 * 200 → { token, expiresAt, gateId, docHash, method }
 *
 * The token is bound to the gate's current inputs and the signed-in officer.
 * It is short-lived and single-use: the sidecar consumes the jti on the first
 * decision, so replaying a signature is refused even if it is still fresh.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in to step up." }, { status: 401 });

  if (!rateLimit(clientKey(req, `step-up:${user.id}`), 8, 5 * 60_000)) {
    return NextResponse.json({ error: "Too many step-up attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  /* Anyone who can sign must hold a second factor. Set
     QUORUM_TOTP_POLICY=optional only on a machine that cannot run an
     authenticator app; the default is a hard requirement. */
  const totpPolicy = (process.env.QUORUM_TOTP_POLICY ?? "required").trim().toLowerCase();
  if (totpPolicy !== "optional" && user.totpEnabled !== true) {
    return NextResponse.json(
      {
        error:
          "An authenticator app is required before you can sign a gate. Set one up now — it takes about a minute.",
        totpRequired: true,
      },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const gateId = typeof body.gateId === "string" ? body.gateId.trim() : "";
  if (!gateId) return NextResponse.json({ error: "gateId is required." }, { status: 422 });

  let gate: GateShape | undefined;
  try {
    const res = await fetch(`${SIDECAR}/api/gates`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { gates?: GateShape[] };
    gate = (data.gates ?? []).find((g) => g.id === gateId);
  } catch {
    return NextResponse.json({ error: "The gate service is unreachable — try again." }, { status: 502 });
  }
  if (!gate) return NextResponse.json({ error: "Gate not found." }, { status: 404 });
  if (gate.status !== "PENDING") return NextResponse.json({ error: `This gate is already ${gate.status}.` }, { status: 409 });

  /* Phase 7 (access security): when the MFA-for-privilege policy is on, the
     people who run the desk authenticate with a second factor on every
     irreversible act — a passphrase alone no longer opens the gavel. The
     refusal names the remedy, not just the rule. */
  if (isAdminRole(user.role) && getSetting("require_mfa_admins") === "1" && !user.totpEnabled) {
    return NextResponse.json(
      { error: "Privileged accounts must enroll an authenticator before signing gates. Enroll TOTP from Settings, then step up again." },
      { status: 403 },
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";

  let method: "password" | "totp" | null = null;
  if (code) {
    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json(
        { error: "No authenticator is enrolled for this account.", totpRequired: true },
        { status: 422 },
      );
    }
    if (!verifyTotp(user.totpSecret, code)) {
      return NextResponse.json({ error: "That authenticator code is not valid. Try the current code." }, { status: 401 });
    }
    method = "totp";
  } else if (password) {
    if (!(await verifyPassword(password, user.password))) {
      return NextResponse.json({ error: "That passphrase is not correct." }, { status: 401 });
    }
    method = "password";
  }

  if (!method) {
    return NextResponse.json(
      {
        error: user.totpEnabled
          ? "Enter your authenticator code (or your passphrase) to sign this gate."
          : "Enter your passphrase to sign this gate.",
        totpEnabled: user.totpEnabled === true,
      },
      { status: 422 },
    );
  }

  const docHash = gateDocHash(gate.inputs);
  const now = Date.now();
  const jti = randomUUID();
  const expiresAt = new Date(now + STEP_UP_TTL_MS);
  const token = signStepUpToken({
    v: 1,
    sub: user.id,
    name: user.name,
    gateId,
    docHash,
    jti,
    method,
    iat: now,
    exp: expiresAt.getTime(),
  });

  recordStepUpIssued({
    userId: user.id,
    userName: user.name,
    gateId,
    docHash,
    method,
    jti,
    expiresAt,
  });

  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    gateId,
    docHash,
    method,
    totpEnabled: user.totpEnabled === true,
  });
}

/** GET /api/auth/step-up — whether this account can use an authenticator. */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  return NextResponse.json({
    totpEnabled: user.totpEnabled === true,
    hasTotpSecret: Boolean(user.totpSecret),
  });
}
