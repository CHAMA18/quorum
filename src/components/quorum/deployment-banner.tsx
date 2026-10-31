"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";

type Deployment = {
  mode: "RECORD_ONLY" | "CONNECTED";
  publication: { portal: string };
};

/**
 * The truth strip.
 *
 * A record-only workspace may rehearse the whole cycle, but the sidecar refuses
 * a contract or a payment. The banner is not dismissible: if the desk is not
 * allowed to sign, the officer should see why on every screen.
 */
export function DeploymentBanner() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/deployment?XTransformPort=3031")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { deployment?: Deployment } | null) => {
        if (alive && data?.deployment) setDeployment(data.deployment);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!deployment || deployment.mode === "CONNECTED") return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-400/25 dark:bg-amber-400/[0.07] dark:text-amber-100"
    >
      <p className="flex items-start gap-2.5 text-[12px] leading-relaxed">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-code text-[9px] tracking-[0.14em]">RECORD-ONLY.</strong>{" "}
          No external publication is connected. Contracts and payment certification are refused; evaluations and
          rehearsals remain available.
        </span>
      </p>
      <Link
        href="/docs"
        className="shrink-0 font-code text-[8px] font-bold tracking-[0.18em] underline decoration-amber-400 underline-offset-4 transition-colors hover:text-amber-950 dark:hover:text-white"
      >
        READ THE LIMITS
      </Link>
    </div>
  );
}
