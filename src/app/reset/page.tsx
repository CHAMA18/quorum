import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/quorum/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new passphrase — Quorum",
  description: "Complete a Quorum password reset.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The page a reset email opens. The token is read here and handed to the form;
 * the form posts it to `/api/auth/reset-password/confirm`, which spends it.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-16 dark:bg-night">
      <div className="w-full max-w-[420px] rounded-[14px] border border-ink-200 bg-white p-7 shadow-sm dark:border-ink-800 dark:bg-night-2">
        <p className="font-code text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Quorum · account recovery
        </p>
        <h1 className="type-display mt-3 text-[24px] text-ink-950 dark:text-white">
          {token ? "Choose a new passphrase" : "This link is incomplete"}
        </h1>
        {token ? (
          <>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
              Setting a new passphrase signs out every existing session for this account.
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            Open the link from your reset email, or request a new one from the{" "}
            <a className="font-semibold text-ink-950 underline underline-offset-2 dark:text-white" href="/#/login">
              sign-in screen
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
