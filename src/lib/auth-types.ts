/** Shared auth types — used by API routes and client components. */

import type { WorkspaceRole } from "@/lib/permissions";

export type AuthMode = "register" | "login";

export type AuthUser = {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  organization: string | null;
  role: WorkspaceRole;
};
