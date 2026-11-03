import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin/console";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quorum Administration",
  description:
    "Manage user access, supplier organizations, review activity, approvals, system health and audit records.",
  robots: { index: false, follow: false },
};

/**
 * /admin — the administration workspace.
 *
 * The session is verified SERVER-SIDE before a single byte of the console is
 * rendered, and the door is the oversight capability: owners, admins and
 * auditors. A signed-in officer who is not entitled sees the refusal, not a
 * half-rendered shell — and the snapshot route re-checks the same capability
 * on every read, so the page guard is a second lock, never the only one.
 */
export default async function AdminPage() {
  const jar = await cookies();
  const user = await getUserFromToken(jar.get(SESSION_COOKIE)?.value).catch(() => null);

  if (!user) redirect("/#/login");

  if (!can(user.role, "view_oversight")) {
    return (
      <main className="admin-surface grid min-h-screen place-items-center bg-paper px-6">
        <div className="panel w-full max-w-md rounded-2xl px-6 py-7">
          <p className="font-code text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
            ADMINISTRATOR ACCESS REQUIRED
          </p>
          <h1 className="mt-2 font-display text-[24px] font-black tracking-[-0.02em] text-ink-950">
            Your account does not have permission to open this area.
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
            You are signed in as <strong className="text-ink-800">{user.role}</strong>. This area is limited to
            owners, administrators and auditors. Contact your workspace administrator if you need access.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href="/#/dashboard"
              className="focus-brand inline-flex min-h-11 items-center rounded-lg bg-ink-950 px-4 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-white dark:bg-white dark:text-[#0b0c0f]"
            >
              RETURN TO WORKSPACE
            </a>
            <a
              href="/"
              className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-4 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600 dark:border-white/15 dark:text-ink-300"
            >
              PUBLIC SITE
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AdminConsole
      user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
    />
  );
}
