import { describe, expect, it } from "bun:test";
import { emailButton, renderEmailHtml, renderEmailText, type EmailModel } from "./email-template";

const model: EmailModel = {
  preheader: "A named human must sign.",
  kicker: "Gate waiting",
  headline: "Gate waiting: KE-GOV-TEST-001",
  intro: "Approve exception needs a named human (accounting officer).",
  tone: "urgent",
  facts: [
    { label: "Reference", value: "KE-GOV-TEST-001" },
    { label: "Status", value: "Waiting for a named human" },
  ],
  ctaLabel: "Open in Quorum",
  ctaUrl: "https://quorum.test/#/dashboard",
  footerNote: "The in-app inbox is the record of delivery.",
  recipient: "officer@example.com",
  appUrl: "https://quorum.test",
};

describe("renderEmailHtml", () => {
  it("renders a table layout with preheader, MSO fallback and bulletproof button", () => {
    const html = renderEmailHtml(model);
    expect(html).toContain('role="presentation"');
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("v:roundrect");
    expect(html).toContain("A named human must sign.");
    expect(html).toContain("KE-GOV-TEST-001");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  it("escapes caller strings everywhere, including the CTA URL", () => {
    const html = renderEmailHtml({
      ...model,
      headline: "<Officer> & 'Co'",
      ctaUrl: 'https://quorum.test/?q="x"',
    });
    expect(html).toContain("&lt;Officer&gt; &amp; &#39;Co&#39;");
    expect(html).not.toContain("<Officer>");
    expect(html).toContain("q=&quot;x&quot;");
  });
});

describe("renderEmailText", () => {
  it("carries the same facts and link without markup", () => {
    const text = renderEmailText(model);
    expect(text).toContain("REFERENCE: KE-GOV-TEST-001");
    expect(text).toContain("OPEN IN QUORUM: https://quorum.test/#/dashboard");
    expect(text).not.toContain("<table");
    expect(renderEmailText({ ...model, bodyText: "Invitation code: ABC123" })).toContain("Invitation code: ABC123");
  });
});

describe("emailButton", () => {
  it("escapes quotes in the href", () => {
    expect(emailButton("Open", 'https://x.test/?a="b"', "#000000")).toContain("a=&quot;b&quot;");
  });
});
