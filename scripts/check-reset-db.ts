import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * DB-layer check for the org passphrase-reset primitives, run against a
 * throwaway store and a fresh Bun process so the live register is untouched.
 */
const storeDir = mkdtempSync(path.join(tmpdir(), "quorum-reset-lab-"));
process.env.QUORUM_STORE_PATH = path.join(storeDir, "store.json");

const db = await import("../src/lib/db");
const auth = await import("../src/lib/org-auth");
let failures = 0;
const check = (label: string, condition: unknown) => {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
};

try {
  const email = `reset-lab-${Date.now()}@probe.example`;
  const org = db.createOrganization({
    name: "Reset Flow Lab Ltd",
    email,
    password: "old-passphrase-1",
    registrationNo: `RL${Date.now()}`,
    country: "Zambia",
  });
  check("org created", Boolean(org.id));

  const session = db.createOrgSession(org.id, new Date(Date.now() + 86_400_000), `sess_${Date.now()}`);
  check("session findable by token", db.findOrgSessionWithOrg(session.token)?.org.id === org.id);

  const code = auth.generateResetCode();
  check("code shape XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code));
  const hash1 = auth.hashResetCode(code);
  db.createOrgPasswordReset(org.id, hash1, new Date(Date.now() + 15 * 60_000));
  check("reset row stored", db.findOrgPasswordReset(hash1)?.orgId === org.id);
  check(
    "normalization is case/separator-insensitive",
    auth.hashResetCode(code.replace("-", "").toLowerCase()) === hash1,
  );
  check("normalizer strips separators and folds case", auth.normalizeResetCode("ab-C1d2") === "ABC1D2");

  const code2 = auth.generateResetCode();
  const hash2 = auth.hashResetCode(code2);
  db.createOrgPasswordReset(org.id, hash2, new Date(Date.now() + 15 * 60_000));
  check("new issuance retires the old code", db.findOrgPasswordReset(hash1) === null);
  check("new code is findable", db.findOrgPasswordReset(hash2)?.orgId === org.id);

  db.consumeOrgPasswordReset(hash2);
  check("code consumed once", db.findOrgPasswordReset(hash2)?.usedAt instanceof Date);
  db.consumeOrgPasswordReset(hash2);
  check("consume is idempotent", db.findOrgPasswordReset(hash2)?.usedAt instanceof Date);

  const updated = db.updateOrganizationPassword(org.id, "new-passphrase-9");
  check("password updated", updated?.password === "new-passphrase-9");
  check("one session revoked", db.deleteOrgSessionsByOrg(org.id) === 1);
  check("revoked session is gone", db.findOrgSessionWithOrg(session.token) === null);

  const expiredHash = auth.hashResetCode("ZZZZ-9999");
  db.createOrgPasswordReset(org.id, expiredHash, new Date(Date.now() - 1000));
  const expired = db.findOrgPasswordReset(expiredHash);
  check(
    "expired code rejected by route predicate",
    Boolean(expired && expired.usedAt === null && expired.expiresAt.getTime() <= Date.now()),
  );

  const dbUrl = pathToFileURL(fileURLToPath(new URL("../src/lib/db.ts", import.meta.url))).href;
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      `const { findOrgPasswordReset } = await import(${JSON.stringify(dbUrl)}); const row = findOrgPasswordReset(${JSON.stringify(expiredHash)}); console.log(JSON.stringify({ found: !!row, expiresAtIsDate: row?.expiresAt instanceof Date, createdAtIsDate: row?.createdAt instanceof Date }));`,
    ],
    { env: { ...process.env, QUORUM_STORE_PATH: process.env.QUORUM_STORE_PATH }, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const restored = exitCode === 0 ? JSON.parse(stdout.trim()) as Record<string, unknown> : {};
  check("reset row survives a fresh process", restored.found === true);
  check("expiry revives as Date", restored.expiresAtIsDate === true);
  check("creation time revives as Date", restored.createdAtIsDate === true);
  if (exitCode !== 0) console.error(stderr);

  console.log(failures === 0 ? "\nALL DB-LAYER CHECKS PASS" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  rmSync(storeDir, { recursive: true, force: true });
}
