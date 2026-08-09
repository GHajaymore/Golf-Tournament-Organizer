/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle (server.js + a trimmed node_modules) —
  // this is what the Electron desktop shell runs, so it doesn't need the
  // whole project checked out to serve the app.
  output: "standalone",
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
