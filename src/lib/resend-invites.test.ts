import { afterEach, describe, expect, it } from "bun:test";
import { sendWorkspaceInviteEmail } from "./resend-invites";

const envKeys = ["QUORUM_EDGE_URL", "QUORUM_EDGE_SECRET"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function configureRelay() {
  process.env.QUORUM_EDGE_URL = "https://relay.quorum.test";
  process.env.QUORUM_EDGE_SECRET = "test_edge_secret";
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
  it("does not call the relay when its authenticated edge is not configured", async () => {
    delete process.env.QUORUM_EDGE_URL;
    delete process.env.QUORUM_EDGE_SECRET;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ ok: true, id: "unexpected" });
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

  it("sends the recipient a safe, prefilled invite through the signed edge relay", async () => {
    configureRelay();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ ok: true, id: "email-123" }, { status: 200 });
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
    expect(requestUrl).toBe("https://relay.quorum.test/__edge/email");
    expect(requestInit?.method).toBe("POST");
    expect(headers.get("x-quorum-edge-key")).toBe("test_edge_secret");
    expect(headers.get("idempotency-key")).toBe("team-invite/invite-123");
    expect(body.to).toBe("teammate@example.com");
    expect(String(body.subject)).toContain("<Officer>");
    expect(String(body.html)).toContain("&lt;Officer&gt;");
    expect(String(body.html)).toContain("Central &amp; Eastern Office");
    expect(String(body.html)).toContain("Q-ABCD-EFGH");
    expect(String(body.text)).toContain("https://quorum-solutions.com/?inviteCode=Q-ABCD-EFGH#/register");
    expect(result).toEqual({
      status: "SENT",
      detail: "Resend accepted the invitation email through Quorum's Cloudflare relay.",
      messageId: "email-123",
    });
  });

  it("reports Resend sender/domain rejection without losing the invitation code", async () => {
    configureRelay();
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
    expect(result.detail).toContain("verified sender domain");
  });
});
