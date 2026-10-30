/**
 * quorum-mcp — the whole OCP Data Registry, in one list.
 *
 * `OCP_AFRICA` is the desk's home set; `OCP_GLOBAL` carries the non-African
 * jurisdictions kept on the same screen for cross-border checks. This module
 * is the build-time view of both snapshots; the live sidecar reads the
 * refreshable JSON through `ocp-live.ts`.
 */

import { OCP_AFRICA, type OcpAfricaDataset } from "./ocp-africa";
import { OCP_GLOBAL } from "./ocp-global";

export const OCP_REGISTRY: OcpAfricaDataset[] = [...OCP_AFRICA, ...OCP_GLOBAL];

export const OCP_REGISTRY_COUNT = OCP_REGISTRY.length;
