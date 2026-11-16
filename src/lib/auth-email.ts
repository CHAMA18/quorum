/**
 * First-party account email: verification links and password resets.
 *
 * Firebase used to send both. Quorum now mints the token, stores only its
 * SHA-256 digest, emails the link through its own relay (the same Cloudflare
 * Worker that carries invitations) and spends the token exactly once. A send
 * that cannot happen is reported as SKIPPED/FAILED with a reason — never
 * silently swallowed.
 */

import { createHash, randomBytes } from "node:crypto";
import { escapeEmailHtml, renderEmailHtml, renderEmailText, type EmailModel } from "@/lib/email-template";
import {
  createEmailVerification,
  createPasswordReset,
  pruneAuthTokens,
  type OrganizationRow,
  type UserRow,
} from "@/lib/db";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export type AuthEmailStatus = "SENT" | "SKIPPED" | "FAILED";

export interface AuthEmailResult {
  status: AuthEmailStatus;
  detail: string;
}

export function newAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Where the app is reachable from. The request origin wins; the env is the fallback. */
export function appOrigin(requestUrl: string): string {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return (process.env.QUORUM_WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  }
}

async function deliverEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<AuthEmailResult> {
  const edgeUrl = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "");
  const edgeSecret = process.env.QUORUM_EDGE_SECRET?.trim();

  if (edgeUrl && edgeSecret) {
    try {
      const response = await fetch(`${edgeUrl}/__edge/email`, {
        method: "POST",
        headers: {
          "x-quorum-edge-key": edgeSecret,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({ to: input.to, subject: input.subject, html: input.html, text: input.text }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; detail?: string } | null;
      if (response.ok && payload?.ok === true) {
        return { status: "SENT", detail: "Resend accepted the message through Quorum's email relay." };
      }
      return {
        status: "FAILED",
        detail: `Quorum's email relay refused the message (HTTP ${response.status})${payload?.detail ? `: ${String(payload.detail).slice(0, 200)}` : "."}`,
      };
    } catch {
      return { status: "FAILED", detail: "Quorum could not reach its email relay." };
    }
  }

  /* Fallback: a Resend key held by the web server itself. */
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "SKIPPED",
      detail: "Email delivery is not configured (no QUORUM_EDGE_URL/QUORUM_EDGE_SECRET and no RESEND_API_KEY).",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM?.trim() || "Quorum <onboarding@resend.dev>",
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return { status: "FAILED", detail: `Resend refused the message (HTTP ${response.status})${payload?.message ? `: ${payload.message.slice(0, 200)}` : "."}` };
    }
    return { status: "SENT", detail: "Resend accepted the message." };
  } catch {
    return { status: "FAILED", detail: "Quorum could not reach Resend." };
  }
}

function model(input: {
  origin: string;
  recipient: string;
  preheader: string;
  kicker: string;
  headline: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  ctaNote: string;
  footerNote: string;
  facts?: EmailModel["facts"];
  bodyHtml?: string;
  bodyText?: string;
}): EmailModel {
  return {
    preheader: input.preheader,
    kicker: input.kicker,
    headline: input.headline,
    intro: input.intro,
    tone: "action",
    ...(input.facts ? { facts: input.facts } : {}),
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    ...(input.bodyText ? { bodyText: input.bodyText } : {}),
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
    ctaNote: input.ctaNote,
    footerNote: input.footerNote,
    recipient: input.recipient,
    appUrl: new URL("/", input.origin).toString(),
    logoUrl: new URL("/images/quorum-email-mark.png", input.origin).toString(),
  };
}

/**
 * Mint a fresh verification link for an account and email it. Any earlier
 * outstanding link for that account is retired by `createEmailVerification`.
 */
export async function sendVerificationEmail(input: {
  user: UserRow;
  origin: string;
}): Promise<AuthEmailResult & { url: string }> {
  pruneAuthTokens();
  const token = newAuthToken();
  const url = `${input.origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  createEmailVerification(input.user.id, hashAuthToken(token), new Date(Date.now() + VERIFICATION_TTL_MS));
  const mail = model({
    origin: input.origin,
    recipient: input.user.email,
    preheader: "One link confirms your address and opens your Quorum workspace.",
    kicker: "Confirm your email",
    headline: "Open your workspace",
    intro: `Hello ${input.user.name.split(" ")[0] || "there"} — confirm ${input.user.email} to finish setting up your Quorum account.`,
    ctaLabel: "Confirm my email",
    ctaUrl: url,
    ctaNote: "This link expires in 24 hours and can be used once.",
    footerNote:
      "If you didn't create a Quorum account, ignore this message and no account is opened. The link confirms the address only; it grants no procurement authority.",
    facts: [{ label: "Account", value: input.user.email }],
  });
  const result = await deliverEmail({
    to: input.user.email,
    subject: "Confirm your email — Quorum",
    html: renderEmailHtml(mail),
    text: renderEmailText(mail),
    idempotencyKey: `verify/${input.user.id}/${hashAuthToken(token).slice(0, 24)}`,
  });
  return { ...result, url };
}

/**
 * Mint a password-reset link and email it. Callers reply uniformly whether or
 * not the address exists, so this is only reached for a known account.
 */
/**
 * The supplier door's reset code. The door has a separate account space, so
 * its recovery uses an eight-character code against `/api/org/auth/reset-password`
 * rather than the officer reset link — mailed, never returned to the caller.
 */
export async function sendOrgResetCodeEmail(input: {
  org: OrganizationRow;
  code: string;
  origin: string;
}): Promise<AuthEmailResult> {
  const mail = model({
    origin: input.origin,
    recipient: input.org.email,
    preheader: "Your supplier portal reset code expires in 30 minutes.",
    kicker: "Supplier portal",
    headline: "Your reset code",
    intro: `A passphrase reset was requested for ${input.org.name}. Enter this code on the supplier sign-in screen with your account email.`,
    ctaLabel: "Open the supplier portal",
    ctaUrl: new URL("/#/supplier", input.origin).toString(),
    ctaNote: "The code expires in 30 minutes, works once, and replaces any earlier code.",
    footerNote:
      "If you didn't request this, nothing has changed and the code can be ignored. Quorum staff will never ask you for this code.",
    bodyHtml: `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:#faf9f6;border:1px dashed #d8d2c6;border-radius:10px;"><tr><td align="center" style="padding:16px 10px;font:700 24px/30px ui-monospace,Menlo,Consolas,monospace;letter-spacing:6px;color:#17191d;">${escapeEmailHtml(input.code)}</td></tr></table>`,
    bodyText: `Your reset code: ${input.code}`,
    facts: [{ label: "Organization", value: input.org.name }],
  });
  return deliverEmail({
    to: input.org.email,
    subject: "Your Quorum supplier reset code",
    html: renderEmailHtml(mail),
    text: renderEmailText(mail),
    idempotencyKey: `org-reset/${input.org.id}/${Date.now()}`,
  });
}

export async function sendPasswordResetEmail(input: {
  user: UserRow;
  origin: string;
}): Promise<AuthEmailResult & { url: string }> {
  pruneAuthTokens();
  const token = newAuthToken();
  const url = `${input.origin}/reset?token=${encodeURIComponent(token)}`;
  createPasswordReset(input.user.id, hashAuthToken(token), new Date(Date.now() + RESET_TTL_MS));
  const mail = model({
    origin: input.origin,
    recipient: input.user.email,
    preheader: "Choose a new passphrase. This link works once and expires in an hour.",
    kicker: "Password reset",
    headline: "Choose a new passphrase",
    intro: `A reset was requested for ${escapeEmailHtml(input.user.email)}. Use the button below to set a new passphrase.`,
    ctaLabel: "Set a new passphrase",
    ctaUrl: url,
    ctaNote: "This link expires in 60 minutes and can be used once.",
    footerNote:
      "If you didn't ask for this, nothing has changed — your current passphrase still works, and this link can be ignored. Resetting signs out every existing session.",
  });
  const result = await deliverEmail({
    to: input.user.email,
    subject: "Reset your Quorum passphrase",
    html: renderEmailHtml(mail),
    text: renderEmailText(mail),
    idempotencyKey: `reset/${input.user.id}/${hashAuthToken(token).slice(0, 24)}`,
  });
  return { ...result, url };
}
