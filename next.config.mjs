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
};

export default nextConfig;
