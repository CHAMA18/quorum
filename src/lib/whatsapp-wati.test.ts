import { describe, expect, test } from "bun:test";
import {
  WATI_SEND_URL,
  buildWatiPayload,
  isWatiConfigured,
  parseWatiSendResponse,
  watiStatus,
  type WatiConfig,
} from "./whatsapp-wati";

const cfg = (over: Partial<WatiConfig> = {}): WatiConfig => ({
  token: "wati-token",
  baseUrl: "https://live-mt-server.wati.io",
  templateName: "quorum_alert",
  channelNumber: "",
  broadcastPrefix: "quorum-alert",
  ...over,
});

const alert = { headline: "Approval needed: KE-MOH-2026-117", summary: "A decision is ready for review.", url: "https://quorum.example/#mc-gates" };

describe("config gates", () => {
  test("configured means token + template name", () => {
    expect(isWatiConfigured(cfg())).toBe(true);
    expect(isWatiConfigured(cfg({ token: "" }))).toBe(false);
    expect(isWatiConfigured(cfg({ templateName: "" }))).toBe(false);
  });

  test("status names the missing pieces", () => {
    const s = watiStatus(cfg({ token: "", templateName: "" }));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain("WATI_API_TOKEN");
    expect(s.missing).toContain("WATI_TEMPLATE_NAME (approved alert template name)");
    expect(watiStatus(cfg()).missing).toEqual([]);
  });
});

describe("buildWatiPayload", () => {
  test("builds the v3 send shape with named custom params", () => {
    const p = buildWatiPayload(cfg(), "+254 712 345 678", alert, "quorum-ntf_42") as {
      template_name: string;
      broadcast_name: string;
      recipients: { phone_number: string; local_message_id: string; custom_params: { name: string; value: string }[] }[];
    };
    expect(p.template_name).toBe("quorum_alert");
    expect(p.broadcast_name).toBe("quorum-alert-quorum-ntf_42");
    expect(p.recipients).toHaveLength(1);
    expect(p.recipients[0].phone_number).toBe("254712345678");
    expect(p.recipients[0].local_message_id).toBe("quorum-ntf_42");
    expect(p.recipients[0].custom_params).toEqual([
      { name: "headline", value: alert.headline },
      { name: "summary", value: alert.summary },
      { name: "url", value: alert.url },
    ]);
  });

  test("omits channel_number unless configured, and includes it when set", () => {
    expect(buildWatiPayload(cfg(), "254712345678", alert, "x")).not.toHaveProperty("channel_number");
    const withChannel = buildWatiPayload(cfg({ channelNumber: "254700000000" }), "254712345678", alert, "x") as { channel_number?: string };
    expect(withChannel.channel_number).toBe("254700000000");
  });

  test("send URL targets the v3 batch send endpoint", () => {
    expect(WATI_SEND_URL(cfg())).toBe("https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send");
    expect(WATI_SEND_URL(cfg({ baseUrl: "https://live-mt-server.wati.io/" }))).toBe(
      "https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send",
    );
  });
});

describe("parseWatiSendResponse", () => {
  test("accepted send yields ok + the localMessageId for delivery matching", () => {
    const r = parseWatiSendResponse({
      result: true,
      error: null,
      templateName: "quorum_alert",
      receivers: [{ localMessageId: "quorum-ntf_42", waId: "254712345678", isValidWhatsAppNumber: true, errors: [] }],
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe("quorum-ntf_42");
  });

  test("result:false is a failure, never a SENT", () => {
    const r = parseWatiSendResponse({ result: false, error: "template not found" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("template not found");
  });

  test("invalid WhatsApp numbers fail with a reason", () => {
    const r = parseWatiSendResponse({
      result: true,
      receivers: [{ localMessageId: "x", isValidWhatsAppNumber: false, errors: [] }],
    });
    expect(r.ok).toBe(false);
  });

  test("an accepted body with no receivers is still a failure", () => {
    expect(parseWatiSendResponse({ result: true, receivers: [] }).ok).toBe(false);
    expect(parseWatiSendResponse(null).ok).toBe(false);
  });
});
