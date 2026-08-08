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
};

export default nextConfig;
