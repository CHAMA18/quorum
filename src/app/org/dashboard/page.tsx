import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OrgConsole } from "@/components/quorum/org/org-console";
import { getOrgFromToken, ORG_SESSION_COOKIE, publicOrg } from "@/lib/org-auth";

export const dynamic = "force-dynamic";

/**
 * /org/dashboard — the organization console. The session is verified
 * SERVER-SIDE against the org session store: no org cookie, no console —
 * back to the supplier door.
 */
export default async function OrgDashboardPage() {
  const store = await cookies();
  const org = getOrgFromToken(store.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    redirect("/org");
  }
  return <OrgConsole initialOrg={publicOrg(org)} />;
}
