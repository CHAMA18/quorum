import { publicAward } from "@/lib/public-award";

export const dynamic = "force-dynamic";

export default async function PublicAwardPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const award = await publicAward(ref).catch(() => null);
  return (
    <main style={{ maxWidth: 680, margin: "48px auto", padding: "0 20px", fontFamily: "Georgia, serif", color: "#17191d" }}>
      <p style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 2, color: "#b52b22" }}>QUORUM · PUBLIC AWARD RECORD</p>
      {!award ? (
        <>
          <h1 style={{ fontSize: 30 }}>No signed award for {ref}</h1>
          <p style={{ lineHeight: 1.7, color: "#45484f" }}>This tender has no signed award on record. Unsigned or draft awards are never published here.</p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 30 }}>Award — {String(award.tenderId)}</h1>
          <p style={{ lineHeight: 1.7, color: "#45484f" }}>
            Awarded to <strong>{String(award.recommendation ?? "the recommended bidder")}</strong>
            {award.awardValue ? <> at {(award.awardValue as { currency?: string }).currency ?? ""} {Number((award.awardValue as { amount: number }).amount).toLocaleString("en-KE")}</> : null}.
            Signed {String(award.signedAt).slice(0, 10)} by {String(award.signedBy)}. {String(award.biddersConsidered)} bidder(s) were considered.
          </p>
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#7c7f87", wordBreak: "break-all" }}>Report SHA-256 · {String(award.reportSha)}</p>
          <p style={{ lineHeight: 1.7, color: "#45484f" }}>This page publishes the signed outcome only. Bid documents, losing prices, and committee deliberations remain in the workspace record.</p>
        </>
      )}
    </main>
  );
}
