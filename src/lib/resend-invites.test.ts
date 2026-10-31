import { afterEach, describe, expect, it } from "bun:test";
import { sendWorkspaceInviteEmail } from "./resend-invites";

const envKeys = ["RESEND_API_KEY", "RESEND_DOMAIN_ID", "RESEND_FROM"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function configureResend() {
  process.env.RESEND_API_KEY = "test_key_never_sent";
  process.env.RESEND_DOMAIN_ID = "test_domain";
  process.env.RESEND_FROM = "Quorum <noreply@quorum-solutions.com>";
}

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

describe("sendWorkspaceInviteEmail", () => {
  it("does not call Resend when its verified-domain settings are incomplete", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_DOMAIN_ID;
    delete process.env.RESEND_FROM;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ id: "unexpected" });
    }) as unknown as typeof fetch;

    const result = await sendWorkspaceInviteEmail({
      to: "teammate@example.com",
      inviterName: "Procurement Officer",
      workspaceName: "Central Office",
      role: "OFFICER",
      code: "Q-ABCD-EFGH",
      inviteUrl: "https://quorum-solutions.com/?inviteCode=Q-ABCD-EFGH#/register",
      inviteId: "invite-1",
    });

    expect(result.status).toBe("SKIPPED");
    expect(called).toBe(false);
  });

  it("sends the recipient a safe, prefilled invite email with an idempotency key", async () => {
    configureResend();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ id: "email-123" }, { status: 200 });
    }) as typeof fetch;

    const result = await sendWorkspaceInviteEmail({
      to: "teammate@example.com",
      inviterName: "<Officer>",
      workspaceName: "Central & Eastern Office",
      role: "COMMITTEE",
      code: "Q-ABCD-EFGH",
      inviteUrl: "https://quorum-solutions.com/?inviteCode=Q-ABCD-EFGH#/register",
      inviteId: "invite-123",
    });

    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    const headers = new Headers(requestInit?.headers);
    expect(requestUrl).toBe("https://api.resend.com/emails");
    expect(requestInit?.method).toBe("POST");
    expect(headers.get("idempotency-key")).toBe("team-invite/invite-123");
    expect(body.from).toBe("Quorum <noreply@quorum-solutions.com>");
    expect(body.to).toEqual(["teammate@example.com"]);
    expect(String(body.html)).toContain("&lt;Officer&gt;");
    expect(String(body.html)).toContain("Central &amp; Eastern Office");
    expect(String(body.html)).toContain("Q-ABCD-EFGH");
    expect(String(body.text)).toContain("https://quorum-solutions.com/?inviteCode=Q-ABCD-EFGH#/register");
    expect(result).toEqual({ status: "SENT", detail: "Resend accepted the invitation email.", messageId: "email-123" });
  });

  it("reports Resend sender/domain rejection without losing the invitation code", async () => {
    configureResend();
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;

    const result = await sendWorkspaceInviteEmail({
      to: "teammate@example.com",
      inviterName: "Procurement Officer",
      workspaceName: "Central Office",
      role: "OFFICER",
      code: "Q-ABCD-EFGH",
      inviteUrl: "https://quorum-solutions.com/?inviteCode=Q-ABCD-EFGH#/register",
      inviteId: "invite-403",
    });

    expect(result.status).toBe("FAILED");
    expect(result.detail).toContain("verified domain");
  });
});
