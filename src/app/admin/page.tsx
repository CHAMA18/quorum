import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin/console";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quorum Control Room",
  description:
    "The operator's control room: authority, suppliers, evaluation runs, human gates and the hash-chained audit spine — one readout, no softer way in.",
  robots: { index: false, follow: false },
};

/**
 * /admin — the control room.
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
      <main className="grid min-h-screen place-items-center bg-paper px-6">
        <div className="panel w-full max-w-md rounded-2xl px-6 py-7">
          <p className="font-code text-[8px] font-bold uppercase tracking-[0.24em] text-brand-600">
            ACCESS REFUSED
          </p>
          <h1 className="mt-2 font-display text-[24px] font-black tracking-[-0.02em] text-ink-950">
            The control room is oversight, not seniority.
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
            You are signed in as <strong className="text-ink-800">{user.role}</strong>. Only owners, admins and
            auditors may read the whole desk — the roster, the supplier door, every run and the audit spine. Your
            workspace is unchanged.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href="/#/dashboard"
              className="focus-brand inline-flex h-9 items-center rounded-lg bg-ink-950 px-4 font-code text-[9px] font-bold uppercase tracking-[0.16em] text-white dark:bg-white dark:text-ink-950"
            >
              RETURN TO THE WORKSPACE
            </a>
            <a
              href="/"
              className="focus-brand inline-flex h-9 items-center rounded-lg border border-ink-200 px-4 font-code text-[9px] font-bold uppercase tracking-[0.16em] text-ink-600 dark:border-white/15 dark:text-ink-300"
            >
              LANDING
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
