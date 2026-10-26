/**
 * Test sandbox — loaded via bunfig.toml [test] preload BEFORE any test module.
 *
 * The store module resolves its data directory AT IMPORT TIME and every
 * append lands in the live append-only audit log. Without this sandbox, a
 * `bun test` run writes test_event entries into the real chain and breaks it
 * (proven: a test run injected `prev:"genesis"` mid-chain on 2026-10-21).
 * Tests get their own data dir; the live spine is never touched.
 */
import { mkdirSync } from "node:fs";

const sandbox = "/tmp/quorum-test-data";
mkdirSync(sandbox, { recursive: true });
process.env.QUORUM_DATA_DIR = sandbox + "/";
