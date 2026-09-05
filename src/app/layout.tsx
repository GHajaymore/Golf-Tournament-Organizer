import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { siteOrigin } from "@/lib/site";

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
 *
 * Fraunces joins it for DISPLAY TEXT ONLY — the marketing page's headlines and
 * nothing else. Golf's own typography is engraved and printed: honours boards,
 * card stock, the club's crest. A page selling that in the same grotesque as
 * every other SaaS product reads as software about golf rather than something
 * belonging to the game. It is confined to headings on purpose: a serif in a
 * score column, on a phone in sun, would be a worse leaderboard.
 *
 * `next/font/google` downloads at BUILD time and serves the files
 * same-origin, so the CSP note above still holds — there is no external font
 * host at runtime.
 */
const display = Fraunces({
  subsets: ["latin"],
  // A narrow range, requested as a variable font: enough for a headline and a
  // heavier one, without shipping an axis nobody uses.
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  /**
   * "Console" described the organizer's half and nothing else — and by the
   * time the player app had a card, a board, the weekly sign-up and the
   * settle-up, that was half the product missing from its own title. It is
   * also a word nobody searches: people look for golf tournament software and
   * golf league apps, and a title that answers neither is invisible to both.
   *
   * "League" earns its place separately from "tournament": a weekly league is
   * a different search, and a large part of this app — availability, the week
   * view, the season skins table — exists for it.
   *
   * "Management" rather than "software" costs nothing and buys the modern
   * reading: "golf tournament management" is itself a high-intent search, so
   * this is not a trade of findability against how it sounds. The two words
   * that actually carry the search — "golf tournament" — are untouched.
   *
   * What the title then STOPPED describing was the product. "Tournament &
   * league management" is what this was before skins settled to the penny,
   * before expenses and prize splits, before season standings and a handicap
   * policy — a club secretary reading it would not guess that the app also
   * does the money. The exact high-intent phrase is kept whole and the clause
   * after it carries the scope, so this widens what the title claims without
   * spending any of what it ranks for.
   */
  /**
   * A TEMPLATE, because a child title used to replace this one outright.
   *
   * `/play` set `title: "Enter your score"` and that is exactly what the tab,
   * the bookmark and the shared link said — three words with no product, no
   * club and no context. Every page that names itself needs the suffix, and
   * the one page that should carry the full sentence is the landing page, so
   * that is `default`.
   */
  title: {
    default: "TourneyHQ — Golf tournament management, from the draw to the payout",
    template: "%s · TourneyHQ",
  },
  description:
    "Run a club's whole competition: flights, handicaps, brackets, live standings and season-long order of merit — with every player's card, board, skins and settle-up on their own phone.",
  /**
   * The origin every relative URL below is resolved against.
   *
   * Without it Next emits Open Graph and canonical URLs as paths, which no
   * share card and no crawler can follow — so the whole block underneath was
   * inert whether or not it existed. See `src/lib/site.ts` for why this is
   * resolved rather than written down here.
   */
  metadataBase: new URL(siteOrigin()),
  /**
   * NO `alternates.canonical` here, deliberately.
   *
   * Next inherits it, so a canonical set on the root layout is claimed by every
   * page that does not override it — and a canonical is a statement that THIS
   * url is the real one for this content. Setting "/" here told a crawler that
   * `/privacy` is a duplicate of the landing page, which is both false and
   * exactly the kind of instruction search engines act on.
   *
   * Caught by building and reading the emitted HTML rather than by reasoning
   * about it: the tag renders identically on every page and looks right on the
   * only page it IS right for. Each indexable page declares its own below.
   */
  openGraph: {
    type: "website",
    siteName: "TourneyHQ",
    url: "/",
    title: "TourneyHQ — Golf tournament management, from the draw to the payout",
    description:
      "Flights, handicaps, brackets and live standings for a club's whole competition — with every player's card, board, skins and settle-up on their own phone.",
  },
  twitter: {
    card: "summary_large_image",
    title: "TourneyHQ — Golf tournament management",
    description:
      "Flights, handicaps, brackets and live standings — with every player's card, board and settle-up on their own phone.",
  },
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
  /**
   * The status bar and, on Android, the task-switcher chrome.
   *
   * Two entries rather than one: a single dark value painted a dark bar above
   * a light-mode app, which is the tell that a web view has been wrapped
   * rather than built. These match --color-bg on each ground.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ee" },
    { media: "(prefers-color-scheme: dark)", color: "#16181a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Draw into the notch and the home-indicator area. This is opt-in, and the
  // price of opting in is that every fixed or sticky edge has to pay the inset
  // back by hand — see the safe-area block in globals.css.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable}`}>
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
