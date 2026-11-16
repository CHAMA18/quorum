import { afterAll, describe, expect, it } from "bun:test";

/**
 * Live PostgreSQL checks for the workspace document store.
 *
 * They run only when `QUORUM_PG_TEST=1` and `DATABASE_URL` point at a database
 * you are willing to write to — the same gate the repo uses for live R2 tests,
 * because a unit run must never touch a real deployment's row.
 */

const enabled = process.env.QUORUM_PG_TEST === "1" && Boolean(process.env.DATABASE_URL?.trim());

const rail = enabled ? describe : describe.skip;

rail("postgres workspace store", () => {
  it("round-trips a document and refuses an older revision", async () => {
    const { ensureWebSchema, pgQuery, STORE_ROW_ID } = await import("@/lib/pg");
    const { readStoreDocument, writeStoreDocument } = await import("@/lib/pg-store");

    await ensureWebSchema();
    await pgQuery("DELETE FROM quorum_web_store WHERE id = $1", [STORE_ROW_ID]);

    const first = { revision: 1, users: [{ email: "officer@example.test" }] };
    expect(await writeStoreDocument(first, 1)).toBe(true);

    const read = await readStoreDocument();
    expect(read?.revision).toBe(1);
    expect((read?.body as { users: { email: string }[] }).users[0]?.email).toBe("officer@example.test");

    /* An older revision must never replace a newer one. */
    expect(await writeStoreDocument({ revision: 1, users: [] }, 1)).toBe(false);
    expect((await readStoreDocument())?.revision).toBe(1);

    const second = { revision: 2, users: [] };
    expect(await writeStoreDocument(second, 2)).toBe(true);
    const after = await readStoreDocument();
    expect(after?.revision).toBe(2);
    expect((after?.body as { users: unknown[] }).users).toHaveLength(0);
  });

  afterAll(async () => {
    if (!enabled) return;
    const { pgQuery, STORE_ROW_ID } = await import("@/lib/pg");
    await pgQuery("DELETE FROM quorum_web_store WHERE id = $1", [STORE_ROW_ID]);
  });
});
