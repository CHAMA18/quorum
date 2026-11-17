import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import {
  buildWhatsAppPayload,
  classifyWhatsAppText,
  isWhatsAppConfigured,
  isWhatsAppTemplateConfigured,
  normalizeWhatsAppNumber,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
  whatsappStatus,
  type WhatsAppConfig,
} from "./whatsapp";

const cfg = (over: Partial<WhatsAppConfig> = {}): WhatsAppConfig => ({
  token: "tok",
  phoneNumberId: "12345",
  templateName: "quorum_alert",
  languageCode: "en",
  verifyToken: "verify-me",
  appSecret: "app-secret",
  ...over,
});

const alert = { headline: "Approval needed: KE-MOH-2026-117", summary: "A decision is ready for review.", url: "https://quorum.example/#mc-gates" };

describe("config gates", () => {
  test("configured means token + phone-number id", () => {
    expect(isWhatsAppConfigured(cfg())).toBe(true);
    expect(isWhatsAppConfigured(cfg({ token: "" }))).toBe(false);
    expect(isWhatsAppConfigured(cfg({ phoneNumberId: "" }))).toBe(false);
  });

  test("template readiness is stricter than configured", () => {
    expect(isWhatsAppTemplateConfigured(cfg())).toBe(true);
    expect(isWhatsAppTemplateConfigured(cfg({ templateName: "" }))).toBe(false);
  });

  test("status names the missing pieces, template included", () => {
    const s = whatsappStatus(cfg({ token: "", templateName: "", verifyToken: "" }));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain("WHATSAPP_TOKEN");
    expect(s.missing).toContain("WHATSAPP_VERIFY_TOKEN (webhook verification)");
    const noTemplate = whatsappStatus(cfg({ templateName: "" }));
    expect(noTemplate.configured).toBe(true);
    expect(noTemplate.templateConfigured).toBe(false);
    expect(noTemplate.missing.some((m) => m.startsWith("WHATSAPP_TEMPLATE_NAME"))).toBe(true);
  });
});

describe("number normalisation", () => {
  test("strips +, spaces and dashes to E.164 digits", () => {
    expect(normalizeWhatsAppNumber("+254 712 345 678")).toBe("254712345678");
    expect(normalizeWhatsAppNumber("254-712-345-678")).toBe("254712345678");
  });

  test("rejects too-short numbers", () => {
    expect(normalizeWhatsAppNumber("123")).toBe("");
    expect(normalizeWhatsAppNumber("")).toBe("");
    expect(normalizeWhatsAppNumber(undefined)).toBe("");
  });
});

describe("payload building", () => {
  test("proactive alerts go out as the approved template with three body params", () => {
    const p = buildWhatsAppPayload(cfg(), "+254 712 345 678", alert) as {
      type: string;
      to: string;
      template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] };
    };
    expect(p.type).toBe("template");
    expect(p.to).toBe("254712345678");
    expect(p.template.name).toBe("quorum_alert");
    expect(p.template.language.code).toBe("en");
    const params = p.template.components[0].parameters.map((x) => x.text);
    expect(params).toEqual([alert.headline, alert.summary, alert.url]);
  });

  test("without a template the payload is free-form text (reply-only)", () => {
    const p = buildWhatsAppPayload(cfg({ templateName: "" }), "254712345678", alert) as {
      type: string;
      text: { body: string };
    };
    expect(p.type).toBe("text");
    expect(p.text.body).toContain(alert.headline);
    expect(p.text.body).toContain(alert.url);
    expect(p.text.body).toContain("Reply STOP to opt out");
  });

  test("template params are collapsed to one line and bounded", () => {
    const p = buildWhatsAppPayload(cfg(), "254712345678", { headline: "A\n\nB", summary: "x".repeat(500), url: alert.url }) as {
      template: { components: { parameters: { text: string }[] }[] };
    };
    const params = p.template.components[0].parameters;
    expect(params[0].text).toBe("A B");
    expect(params[1].text.length).toBe(200);
  });
});

describe("webhook signature", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");

  test("accepts a valid signature over the raw body", () => {
    expect(verifyWhatsAppSignature(body, sig, "app-secret")).toBe(true);
  });

  test("rejects tampered body, wrong secret and missing header", () => {
    expect(verifyWhatsAppSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "other-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, null, "app-secret")).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, "")).toBe(false);
  });
});

describe("webhook parsing", () => {
  test("extracts inbound messages and statuses, ignoring unknown fields", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "254700000000" },
                messages: [{ id: "wamid.1", from: "254712345678", type: "text", text: { body: "STOP" } }],
                statuses: [{ id: "wamid.9", status: "read" }, { id: "wamid.8", status: "failed", errors: [{ title: "131047" }] }],
              },
            },
          ],
        },
      ],
    };
    const { messages, statuses } = parseWhatsAppWebhook(payload);
    expect(messages).toEqual([{ id: "wamid.1", from: "254712345678", text: "STOP" }]);
    expect(statuses).toEqual([
      { id: "wamid.9", status: "read" },
      { id: "wamid.8", status: "failed", error: "131047" },
    ]);
  });

  test("malformed envelopes yield empty lists, never a throw", () => {
    expect(parseWhatsAppWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook({})).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook({ entry: "nope" })).toEqual({ messages: [], statuses: [] });
  });
});

describe("inbound intent", () => {
  test("STOP/START/HELP classify; everything else is other", () => {
    expect(classifyWhatsAppText("STOP")).toBe("opt_out");
    expect(classifyWhatsAppText(" unsubscribe ")).toBe("opt_out");
    expect(classifyWhatsAppText("START")).toBe("opt_in");
    expect(classifyWhatsAppText("help")).toBe("help");
    expect(classifyWhatsAppText("approve gate_1")).toBe("other");
    expect(classifyWhatsAppText("")).toBe("other");
  });

  test("an approval attempt is never an actionable intent", () => {
    expect(classifyWhatsAppText("approve")).toBe("other");
    expect(classifyWhatsAppText("yes approve")).toBe("other");
  });
});
