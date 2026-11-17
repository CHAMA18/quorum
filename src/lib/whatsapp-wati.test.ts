import { describe, expect, test } from "bun:test";
import {
  WATI_SEND_URL,
  WATI_TEXT_URL,
  buildWatiPayload,
  buildWatiTextPayload,
  findWatiTemplate,
  isWatiConfigured,
  parseWatiSendResponse,
  parseWatiWebhook,
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

describe("parseWatiWebhook", () => {
  test("an inbound message becomes an E.164 sender + text", () => {
    const got = parseWatiWebhook({
      eventType: "message",
      waId: "260771406330",
      text: "STOP",
      senderName: "Chama",
      owner: false,
      type: "text",
      timestamp: "1764238453",
    });
    expect(got.messages).toStrictEqual([{ from: "+260771406330", text: "STOP", senderName: "Chama" }]);
    expect(got.statuses).toStrictEqual([]);
  });

  test("outbound owner copies and unknown events are never actionable", () => {
    expect(parseWatiWebhook({ eventType: "message", waId: "260771406330", text: "STOP", owner: true }).messages).toStrictEqual([]);
    expect(parseWatiWebhook({ eventType: "ctaUrlClicked", waId: "260771406330" })).toStrictEqual({ messages: [], statuses: [] });
    expect(parseWatiWebhook(null)).toStrictEqual({ messages: [], statuses: [] });
  });

  test("delivery / read / failed statuses map with the correlation id", () => {
    expect(
      parseWatiWebhook({
        eventType: "sentMessageDELIVERED_v2",
        statusString: "Delivered",
        localMessageId: "quorum-1",
        whatsappMessageId: "wamid.x",
        timestamp: "1765791326",
      }).statuses,
    ).toStrictEqual([{ id: "quorum-1", wamid: "wamid.x", status: "delivered" }]);
    expect(
      parseWatiWebhook({ eventType: "templateMessageSent_v2", statusString: "SENT", localMessageId: "quorum-2" }).statuses,
    ).toStrictEqual([{ id: "quorum-2", status: "sent" }]);
    const failed = parseWatiWebhook({
      eventType: "templateMessageFailed",
      statusString: "Template not found",
      localMessageId: "quorum-3",
      templateName: "quorum_alert",
      whatsappMessageId: "",
    }).statuses;
    expect(failed).toStrictEqual([{ id: "quorum-3", status: "failed", error: "quorum_alert: Template not found" }]);
  });

  test("status events with no correlation id at all are acked silently", () => {
    expect(parseWatiWebhook({ eventType: "sentMessageREAD_v2", statusString: "Read" }).statuses).toStrictEqual([]);
  });
});

describe("buildWatiTextPayload", () => {
  test("replies target the conversation phone with the given text", () => {
    expect(buildWatiTextPayload("+260771406330", "STOP received.")).toStrictEqual({
      target: "260771406330",
      text: "STOP received.",
    });
    expect(WATI_TEXT_URL(cfg())).toBe(
      "https://live-mt-server.wati.io/api/ext/v3/conversations/messages/text",
    );
  });
});

describe("findWatiTemplate", () => {
  const list = {
    templates: [
      { name: "welcome", status: "approved" },
      { name: "quorum_alert", status: "approved" },
    ],
  };
  test("approved template is reported approved", () => {
    expect(findWatiTemplate(list, "quorum_alert")).toStrictEqual({ state: "approved", templateStatus: "approved" });
  });

  test("unapproved template is rejected, absent template is missing", () => {
    expect(findWatiTemplate({ templates: [{ name: "quorum_alert", status: "pending" }] }, "quorum_alert").state).toBe("rejected");
    expect(findWatiTemplate(list, "quorum_missing")).toStrictEqual({ state: "missing" });
  });

  test("unreadable payloads are unknown, never missing-or-approved", () => {
    expect(findWatiTemplate(null, "quorum_alert")).toStrictEqual({ state: "unknown" });
    expect(findWatiTemplate({ templates: "nope" }, "quorum_alert")).toStrictEqual({ state: "unknown" });
  });
});
