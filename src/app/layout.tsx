import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseAnalytics } from "@/components/quorum/firebase-analytics";
import { ThemeProvider } from "@/components/quorum/theme-toggle";

// Self-hosted via next/font — zero runtime requests to Google, so the page
// can never hang on external font CDNs.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// The editorial accent voice — italic serif used for single highlighted
// phrases inside display headlines ("one review run", the greeting's name).
// Italic-only weight 400; anything bolder would read as decoration, not voice.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["italic"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quorum — Agentic tender review for public health procurement",
  description:
    "Quorum reads a public health tender end to end — specs against clinical need, quantities against real consumption, prices against other buyers, every finding cited. Then it stops: the committee decides.",
  keywords: [
    "Quorum",
    "agentic AI",
    "public procurement",
    "health procurement",
    "health commodity tenders",
    "medical supplies",
    "tender review",
    "MCP",
    "Model Context Protocol",
    "Open Contracting",
    "OCDS",
    "human in the loop",
  ],
  authors: [{ name: "Quorum" }],
  openGraph: {
    title: "Quorum — Agentic tender review for public health procurement",
    description:
      "The agent prepares the tender file, every finding cited — and a hard stop before the committee's award.",
    siteName: "Quorum",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quorum — Agentic tender review for public health procurement",
    description:
      "Agents prepare the file, committees award the tender. Agentic procurement for public health supply chains, built for Africa.",
  },
};

export const viewport: Viewport = {
  themeColor: "#d92616",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${archivo.variable} ${inter.variable} ${jetbrains.variable} ${instrument.variable} font-body antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <FirebaseAnalytics />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
