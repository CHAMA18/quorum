/**
 * Portal enable/disable state — persistence tested against a temp file, so
 * the live data/ store is never touched by the test run.
 *
 * These tests prove: an override round-trips with actor and instant; unknown
 * publication ids are filtered on load; toggling off then on restores the
 * all-enabled default; and the enabled/disabled id sets answer correctly.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  disabledPortalIds,
  enabledPortalIds,
  loadPortalState,
  setPortalsEnabled,
} from "./portal-state";
import { OCP_GLOBAL } from "./ocp-global";
import { OCP_REGISTRY } from "./ocp-registry";

const tmp = mkdtempSync(join(tmpdir(), "portal-state-"));
const statePath = join(tmp, "portal-state.json");
const realId = OCP_REGISTRY[0].publicationId;
const otherId = OCP_REGISTRY[1].publicationId;

describe("portal enable/disable state", () => {
  test("absence of the file means every portal enabled", () => {
    expect(loadPortalState(statePath).overrides).toEqual({});
    expect(disabledPortalIds(loadPortalState(statePath)).size).toBe(0);
    expect(enabledPortalIds(loadPortalState(statePath))).toHaveLength(OCP_REGISTRY.length);
  });

  test("a disable transition persists actor, instant and state", () => {
    const file = setPortalsEnabled([realId], false, "Chungu Chipimo Chama", statePath);
    expect(file.overrides[String(realId)].enabled).toBe(false);
    expect(file.overrides[String(realId)].by).toBe("Chungu Chipimo Chama");
    expect(Number.isNaN(new Date(file.overrides[String(realId)].at).getTime())).toBe(false);

    const reloaded = loadPortalState(statePath);
    expect(reloaded.overrides[String(realId)].enabled).toBe(false);
    const disabled = disabledPortalIds(reloaded);
    expect(disabled.has(realId)).toBe(true);
    expect(disabled.has(otherId)).toBe(false);
  });

  test("unknown publication ids are filtered out on load", () => {
    const reloaded = loadPortalState(statePath);
    expect(reloaded.overrides["999999"]).toBeUndefined();
  });

  test("a non-African portal is a first-class switch target too", () => {
    const globalId = OCP_GLOBAL[0].publicationId;
    const file = setPortalsEnabled([globalId], false, "Global Verifier", statePath);
    expect(file.overrides[String(globalId)].enabled).toBe(false);
    expect(disabledPortalIds(loadPortalState(statePath)).has(globalId)).toBe(true);
    setPortalsEnabled([globalId], true, "Global Verifier", statePath);
    expect(disabledPortalIds(loadPortalState(statePath)).has(globalId)).toBe(false);
  });

  test("re-enabling restores the all-enabled default and keeps the actor", () => {
    setPortalsEnabled([realId], true, "Verify Runner", statePath);
    const reloaded = loadPortalState(statePath);
    expect(reloaded.overrides[String(realId)].enabled).toBe(true);
    expect(reloaded.overrides[String(realId)].by).toBe("Verify Runner");
    expect(disabledPortalIds(reloaded).size).toBe(0);
    expect(enabledPortalIds(reloaded)).toHaveLength(OCP_REGISTRY.length);
  });

  test("a mixed state answers both directions correctly", () => {
    setPortalsEnabled([realId], false, "test", statePath);
    const reloaded = loadPortalState(statePath);
    expect(disabledPortalIds(reloaded)).toEqual(new Set([realId]));
    expect(enabledPortalIds(reloaded).includes(realId)).toBe(false);
    expect(enabledPortalIds(reloaded).includes(otherId)).toBe(true);
  });

  test("corrupt state falls back to every portal enabled", () => {
    const bad = join(tmp, "corrupt.json");
    writeFileSync(bad, "{not json");
    expect(loadPortalState(bad).overrides).toEqual({});
  });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});
