/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle (server.js + a trimmed node_modules) —
  // this is what the Electron desktop shell runs, so it doesn't need the
  // whole project checked out to serve the app.
  output: "standalone",
};

export default nextConfig;
