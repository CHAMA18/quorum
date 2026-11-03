import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { MotionConfig } from "framer-motion";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseAnalytics } from "@/components/quorum/firebase-analytics";
import { ThemeProvider } from "@/components/quorum/theme-toggle";
import { MuseAssistantGate } from "@/components/quorum/muse-assistant-gate";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Quorum — Public procurement review workspace",
  description:
    "Review public health tenders with consistent criteria, source-linked findings and a traceable decision history. Authorised committees retain control of every award.",
  keywords: [
    "Quorum",
    "procurement review software",
    "public procurement",
    "health procurement",
    "health commodity tenders",
    "medical supplies",
    "tender review",
    "Open Contracting",
    "OCDS",
    "committee approval",
  ],
  authors: [{ name: "Quorum" }],
  openGraph: {
    title: "Quorum — Public procurement review workspace",
    description:
      "Source-linked tender reviews, clear officer dispositions and accountable committee decisions.",
    siteName: "Quorum",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quorum — Public procurement review workspace",
    description:
      "A procurement review workspace for public institutions, health agencies and oversight teams.",
  },
};

export const viewport: Viewport = {
  themeColor: "#d92616",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* The officer's first name rides to the bubble when a session exists — the
     agent greets by it and signs nothing under it; the gavel stays theirs. */
  let firstName: string | undefined;
  if (process.env.STATIC_EXPORT !== "1") {
    const jar = await cookies();
    const officer = await getUserFromToken(jar.get(SESSION_COOKIE)?.value).catch(() => null);
    firstName = officer?.name?.trim().split(/\s+/)[0] || undefined;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@1,2&display=swap"
        />
      </head>
      <body
        suppressHydrationWarning
        className="font-body antialiased bg-background text-foreground"
      >
        <ThemeProvider>
          <MotionConfig reducedMotion="user">
            {children}
            {/* The assistant is for working areas and docs, not sign-in screens. */}
            <MuseAssistantGate name={firstName} />
            <FirebaseAnalytics />
            <Toaster />
          </MotionConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}
