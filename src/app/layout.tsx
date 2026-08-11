import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/**
 * Geist, self-hosted.
 *
 * The stylesheets below load icons from a CDN, but a FONT cannot: the app's CSP
 * blocks external font hosts, so the previous `"Inter", -apple-system, …` stack
 * never actually rendered Inter — every visitor was seeing whichever system
 * face came next in the list, which is why the type looked different on every
 * machine.
 *
 * next/font emits the files from node_modules at build time and serves them
 * same-origin, so there is no CDN to block and no flash of fallback text. Geist
 * is a variable grotesque with true tabular figures, which is what a page built
 * around a leaderboard needs — columns of numbers have to lock.
 */

export const metadata: Metadata = {
  title: "TourneyHQ — Golf Tournament Console",
  description: "Run the whole golf event from one console: flights, qualification, brackets and live standings.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TourneyHQ",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#16181a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css"
        />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
