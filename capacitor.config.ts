import type { CapacitorConfig } from "@capacitor/cli";

// TourneyHQ is a full-stack Next.js app (server actions, Prisma/SQLite,
// cookie-based auth) — it can't run as a static offline bundle inside the
// native shell. Instead the WebView loads the live server directly, the
// same pattern used by most hybrid apps backed by a real server.
//
// For local testing: set `server.url` to `http://<your-lan-ip>:3000`, the
// "Network:" address `next dev` prints on startup (already seen this
// session as http://192.168.86.26:3000 — update it if your machine's LAN
// IP changes). The device/simulator must be on the same network as this
// machine. `cleartext: true` is required because local dev serves plain
// HTTP; once there's a real HTTPS deployment, swap the URL and drop
// `cleartext`.
const config: CapacitorConfig = {
  appId: "com.flights.tournament",
  appName: "TourneyHQ",
  webDir: "ios-shell-web",
  server: {
    url: "http://192.168.86.26:3000",
    cleartext: true,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
