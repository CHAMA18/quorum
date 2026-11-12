import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Regression: a process started with QUORUM_STORE_PATH must treat that path as
 * authoritative. db.ts used to copy <cwd>/db/quorum-store.json into any missing
 * overridden store, so the judge proof and other isolated runs silently started
 * with the live workspace's accounts, sessions and organizations.
 *
 * The probe runs in its own temporary project root (with a package.json and the
 * mini-services marker, like the repo) holding a sentinel "live" store, so it
 * recreates the exact path the old migration read without touching the real one.
 */
describe("db store isolation", () => {
  test(
    "a fresh QUORUM_STORE_PATH never inherits repo accounts or organizations",
    async () => {
      const root = path.resolve(import.meta.dir, "../..");
      const work = await mkdtemp(path.join(tmpdir(), "quorum-store-isolation-"));
      const fresh = path.join(work, "fresh-store.json");
      try {
        await mkdir(path.join(work, "db"), { recursive: true });
        await mkdir(path.join(work, "mini-services", "quorum-mcp"), { recursive: true });
        await writeFile(path.join(work, "package.json"), JSON.stringify({ name: "quorum-store-isolation-probe" }));
        /* The @/ alias resolves through this cwd tsconfig inside the child. */
        await writeFile(
          path.join(work, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { baseUrl: root, paths: { "@/*": ["src/*"] } } }),
        );
        await writeFile(
          path.join(work, "db", "quorum-store.json"),
          JSON.stringify({
            workspaceId: "live-workspace",
            users: [
              {
                id: "u_live",
                workspaceId: "live-workspace",
                name: "Live Officer",
                email: "live.officer@example.test",
                password: "scrypt:test",
                emailVerified: true,
                organization: null,
                role: "OWNER",
                status: "ACTIVE",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            organizations: [
              {
                id: "org_live",
                name: "Live Supplier Ltd",
                email: "live.supplier@example.test",
                registrationNo: "REG-LIVE",
                country: "Kenya",
                status: "ACTIVE",
                categories: [],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            sessions: [],
            invites: [],
            settings: {},
          }),
        );

        const script = path.join(work, "probe.ts");
        await writeFile(
          script,
          [
            `import { listUsers, listOrganizations } from ${JSON.stringify(path.join(root, "src/lib/db.ts"))};`,
            "console.log(JSON.stringify({",
            "  users: listUsers().map((u) => u.email),",
            "  organizations: listOrganizations().map((o) => o.email),",
            "}));",
          ].join("\n"),
        );

        const proc = Bun.spawn([process.execPath, script], {
          cwd: work,
          env: { ...process.env, QUORUM_STORE_PATH: fresh },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) throw new Error(`isolation probe failed (${exitCode}): ${stderr}`);
        const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
          users?: string[];
          organizations?: string[];
        };
        expect(result.users).toEqual([]);
        expect(result.organizations).toEqual([]);

        /* The configured location, if the store wrote one, must be empty too. */
        if (existsSync(fresh)) {
          const copy = JSON.parse(await readFile(fresh, "utf8")) as {
            users?: unknown[];
            organizations?: unknown[];
          };
          expect(copy.users ?? []).toEqual([]);
          expect(copy.organizations ?? []).toEqual([]);
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
