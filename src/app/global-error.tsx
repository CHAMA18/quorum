"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f4ef", color: "#17181c", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section
            style={{
              width: "100%",
              maxWidth: "560px",
              border: "1px solid #ded8cf",
              borderRadius: "16px",
              background: "#fffdfb",
              padding: "28px",
            }}
          >
            <p style={{ margin: 0, fontSize: "10px", letterSpacing: "2px", fontWeight: 700, color: "#b42318" }}>
              QUORUM · RECOVERY
            </p>
            <h1 style={{ margin: "12px 0 0", fontSize: "26px", lineHeight: 1.2 }}>The workspace hit an error.</h1>
            <p style={{ margin: "12px 0 0", fontSize: "14px", lineHeight: 1.6, color: "#55575e" }}>
              No procurement decision was recorded. Reload the workspace; if the problem persists, quote reference{" "}
              <code>{error.digest ?? "no-digest"}</code>.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "22px" }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  minHeight: "44px",
                  border: 0,
                  borderRadius: "10px",
                  background: "#17181c",
                  color: "#fff",
                  padding: "0 18px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              <a
                href="/"
                style={{
                  minHeight: "44px",
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: "10px",
                  border: "1px solid #ded8cf",
                  color: "#17181c",
                  padding: "0 18px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Back to Quorum
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
