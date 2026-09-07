/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Self-contained server bundle (server.js + a trimmed node_modules) — this is
   * what the Electron desktop shell runs, so it doesn't need the whole project
   * checked out to serve the app. `electron/prepare-standalone.js` is its only
   * consumer, and Vercel uses its own build output rather than this.
   *
   * Off for the end-to-end build, and only for that. `next start` prints
   * "does not work with output: standalone" and then mostly works — but on
   * 2026-09-03 a CI run served `/organization` as "Application error: a
   * server-side exception has occurred", with the server logging
   * `Could not find the module HandicapSetup.tsx#HandicapSetup in the React
   * Client Manifest`. Every viewport failed; the same commit passed on another
   * run. A gate should not be built on a combination the framework says is
   * unsupported, whether or not that is what produced this one.
   *
   * Left ON everywhere else deliberately, so the ordinary build still proves
   * the Electron output compiles. Inverted rather than opt-in for the same
   * reason: the default stays exactly what it is today, and only the test
   * server opts out.
   */
  output: process.env.NEXT_NO_STANDALONE ? undefined : "standalone",
  // A second build directory, so a production build can run beside a live
  // dev server. They share .next otherwise, and building corrupts it — the
  // reason the production build went unverified locally for so long.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * EVERY user agent gets its metadata in `<head>`, not streamed into `<body>`.
   *
   * Next 15 streams metadata by default: the shell flushes first and the
   * `<title>`, `<meta>` and `<link>` tags arrive at the END of the body, on the
   * assumption that anything running JavaScript will cope. It is only turned
   * off for the user agents matching `htmlLimitedBots`, whose default list is
   * the unfurlers that cannot run JavaScript — Twitterbot, Slackbot, WhatsApp,
   * facebookexternalhit. Googlebot is deliberately NOT on that list, because it
   * renders.
   *
   * Measured on production rather than reasoned about, and the assumption does
   * not hold. `</head>` closed at character 1,303 and the description, the
   * canonical, `og:image` and the title were all at character ~70,000. They are
   * not hoisted afterwards either — in the live post-hydration DOM
   * `document.head` held 5 meta tags and `document.body` held 22, with the
   * canonical's `parentElement` reading BODY.
   *
   * A canonical in the body is not a canonical. Google's documentation is
   * explicit that the tag is honoured only in the head, so every
   * `alternates.canonical` on this site was inert for the one crawler it was
   * written for — while working perfectly for the four unfurlers that were
   * already being served blocking metadata and never needed it. That is the
   * shape this codebase keeps finding: one rule, two readers, and the reader
   * that matters is the one getting it wrong.
   *
   * Setting this REPLACES the default list rather than extending it, so a
   * match-everything regex means "treat every agent as one that needs its
   * metadata up front". See `shouldServeStreamingMetadata` in next/dist.
   *
   * What it costs is the reason streaming exists: metadata now resolves before
   * the first byte. Two pages in this app export `generateMetadata` — `/live`
   * and `/register`, both token-gated and neither indexable — and every page a
   * crawler can reach exports a static `metadata` object, so there is no query
   * to wait on and the block is a formality.
   *
   * One case this canNOT fix: a request with NO user-agent header still gets
   * streamed metadata, because Next tests `userAgent &&` before the regex.
   * Nothing in config reaches that branch.
   */
  htmlLimitedBots: /.*/,

  /**
   * Two of this app's credentials live in URLs — the leaderboard share token
   * at /live/<token>, and the password-reset token in ?token= — and every page
   * pulls stylesheets from unpkg.com, so every page makes a cross-origin
   * request while one of those is in the address bar. Modern browsers default
   * to strict-origin-when-cross-origin and send only the origin, but that is a
   * default, not a guarantee: older engines and embedded webviews send the
   * full URL, which would hand a live reset token to a CDN's access log.
   * Stating the policy makes it this app's decision rather than the browser's.
   *
   * nosniff and the frame rule are the cheap companions: the public
   * leaderboard is the one page an attacker can frame for clickjacking, and it
   * is served to people who never signed in to anything.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },

  /**
   * STOP EMITTING 7.3 MB OF ICON FONT NOBODY EVER REQUESTS.
   *
   * `@phosphor-icons/web` declares each weight with four `src` entries —
   * woff2, woff, truetype and an SVG font — and webpack resolves every URL in
   * a stylesheet it processes, so all four are copied into the build. Measured
   * on this repository, for the two weights actually imported:
   *
   *     Phosphor.svg        2926.1 KB      Phosphor.woff2      143.9 KB
   *     Phosphor-Fill.svg   2702.1 KB      Phosphor-Fill.woff2 128.7 KB
   *     Phosphor.woff        477.3 KB
   *     Phosphor.ttf         477.2 KB      ← 272.6 KB is all a browser fetches
   *     Phosphor-Fill.woff   438.8 KB
   *     Phosphor-Fill.ttf    438.7 KB
   *
   * `static/media` was 7.9 MB, of which 7.3 MB was dead weight in every deploy
   * and every Docker layer. No browser asks for any of it: `src` is a priority
   * list, woff2 is first, and every engine this app supports takes it.
   *
   * `emit: false` keeps the URL in the stylesheet and skips writing the file.
   * The alternative — vendoring 156 KB of the package's CSS to delete three
   * `src` lines — means owning a copy of a file that changes whenever the icon
   * set does, which is a worse trade than a URL nobody follows.
   *
   * WHAT THIS COSTS, stated plainly: a browser with no woff2 support would now
   * 404 on the fallbacks instead of downloading a 2.9 MB SVG font. woff2 has
   * been supported everywhere since 2016 and Next 15 does not target anything
   * older, so the honest reading is that this removes a fallback that could
   * never have fired. If one ever needs to come back, delete this block —
   * nothing else depends on it.
   */
  webpack(config) {
    config.module.rules.unshift({
      // `.woff2` deliberately absent, and the `$` is what keeps it that way:
      // `\.woff$` does not match `.woff2`.
      test: /@phosphor-icons[\\/]web[\\/].*\.(woff|ttf|svg)$/,
      type: "asset/resource",
      generator: { emit: false },
    });
    return config;
  },
};

export default nextConfig;
