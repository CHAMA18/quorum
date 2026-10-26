import { OrgAuthScreen } from "@/components/quorum/org/org-auth-screen";

/**
 * /org — the supplier side's own door. Separate from the officers' auth in
 * every way that matters: route, cookie, account store. Registration builds
 * an organization PROFILE (legal identity, statutory registrations,
 * capabilities), not just a login.
 */
export default function OrgPage() {
  return <OrgAuthScreen />;
}
