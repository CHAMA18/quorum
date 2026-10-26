/** Shared auth types — used by API routes and client components. */

export type AuthMode = "register" | "login";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  organization: string | null;
};
