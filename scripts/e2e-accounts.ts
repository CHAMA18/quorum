/**
 * E2E test fixture — five verified committee accounts in the local JSON store.
 *
 * This exists only so the tender workflow's statutory gates can be exercised
 * end to end: each account has a known passphrase, is linked to a PRESENT
 * committee seat, and can enrol TOTP for step-up. It is not part of the app.
 *
 * Run with the Next.js dev server stopped (the store is loaded at boot):
 *   bun scripts/e2e-accounts.ts seed
 *   bun scripts/e2e-accounts.ts cleanup
 */

import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const STORE = "db/quorum-store.json";
const WORKSPACE = "cc4eaa81-e4d1-49c4-a2a8-30ba5c6a4386";
const PASSWORD = "E2e!Passw0rd#2026";
const EMAILS = [
  "e2e.mwansa@example.com",
  "e2e.evaluator.one@example.com",
  "e2e.evaluator.two@example.com",
  "e2e.accountant.one@example.com",
  "e2e.accountant.two@example.com",
];

const PEOPLE = [
  { name: "Mwansa Chalwe", email: EMAILS[0], office: "PROCUREMENT_UNIT" },
  { name: "E2E Evaluator One", email: EMAILS[1], office: "EVALUATION_COMMITTEE" },
  { name: "E2E Evaluator Two", email: EMAILS[2], office: "EVALUATION_COMMITTEE" },
  { name: "E2E Accountant One", email: EMAILS[3], office: "ACCOUNTING_OFFICER" },
  { name: "E2E Accountant Two", email: EMAILS[4], office: "ACCOUNTING_OFFICER" },
] as const;

type Row = Record<string, unknown> & { id: string };

function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

function readStore(): { [key: string]: unknown; users: Row[]; committeeMembers: Row[] } {
  return JSON.parse(readFileSync(STORE, "utf8"));
}

function writeStore(store: unknown): void {
  const tmp = `${STORE}.e2e.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, STORE);
}

function seed(): void {
  const store = readStore();
  const now = new Date().toISOString();
  const users = store.users;
  const seats = store.committeeMembers;
  let nextSeat = seats.reduce((max, seat) => Math.max(max, Number(seat.seatOrder) || 0), 0) + 1;

  for (const person of PEOPLE) {
    let user = users.find((row) => row.email === person.email);
    if (!user) {
      user = {
        id: randomUUID(),
        workspaceId: WORKSPACE,
        name: person.name,
        email: person.email,
        password: passwordHash(PASSWORD),
        emailVerified: true,
        organization: null,
        role: "OFFICER",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      users.push(user);
    } else {
      Object.assign(user, {
        workspaceId: WORKSPACE,
        name: person.name,
        password: passwordHash(PASSWORD),
        emailVerified: true,
        role: "OFFICER",
        status: "ACTIVE",
        updatedAt: now,
      });
    }

    let seat = seats.find((row) => row.userId === user!.id) ?? seats.find((row) => row.name === person.name);
    if (!seat) {
      seat = {
        id: `cmb_${randomUUID().slice(0, 8)}`,
        userId: user.id,
        name: person.name,
        role: `E2E ${person.office.toLowerCase().replace(/_/g, " ")} seat`,
        isChair: false,
        status: "PRESENT",
        office: person.office,
        seatOrder: nextSeat++,
        createdAt: now,
        updatedAt: now,
      };
      seats.push(seat);
    } else {
      Object.assign(seat, {
        userId: user.id,
        name: person.name,
        status: "PRESENT",
        office: person.office,
        updatedAt: now,
      });
    }
    console.log(`user ${person.name} <${person.email}> ${user.id} · seat ${seat.id}`);
  }

  writeStore(store);
  console.log(`seeded ${PEOPLE.length} accounts; passphrase ${PASSWORD}`);
}

function cleanup(): void {
  const store = readStore();
  const removedUsers = new Set(store.users.filter((row) => EMAILS.includes(String(row.email))).map((row) => row.id));
  store.users = store.users.filter((row) => !removedUsers.has(row.id));
  store.committeeMembers = store.committeeMembers.filter(
    (row) => !removedUsers.has(String(row.userId)) && !PEOPLE.some((person) => person.name === row.name),
  );
  writeStore(store);
  console.log(`removed ${removedUsers.size} E2E accounts and their committee seats`);
}

const mode = process.argv[2];
if (mode === "seed") seed();
else if (mode === "cleanup") cleanup();
else {
  console.error("usage: bun scripts/e2e-accounts.ts seed|cleanup");
  process.exit(2);
}
