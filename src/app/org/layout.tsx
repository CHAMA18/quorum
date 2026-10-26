import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quorum — Supplier portal",
  description:
    "The organization side of Quorum: create your organization profile and apply for available public tenders directly.",
};

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return children;
}
