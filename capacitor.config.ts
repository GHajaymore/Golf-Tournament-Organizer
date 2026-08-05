import type { CapacitorConfig } from "@capacitor/cli";

// TourneyHQ is a full-stack Next.js app (server actions, Prisma/Postgres,
// cookie-based auth) — it can't run as a static offline bundle inside the
// native shell. Instead the WebView loads the live deployed server, the
// same pattern used by most hybrid apps backed by a real server.
//
// This points at the production deployment over HTTPS, which is what App
// Store / Play Store builds must ship with. Note there is deliberately no
// `cleartext: true` here: plain-HTTP traffic is a store-review red flag and
// isn't needed against an HTTPS origin.
//
// To test against a local dev server instead, temporarily set `server.url`
// to the `Network:` address `next dev` prints (e.g. http://192.168.x.x:3000)
// and add `cleartext: true` — but revert both before producing any build you
// intend to submit to a store.
const config: CapacitorConfig = {
  appId: "com.flights.tournament",
  appName: "TourneyHQ",
  webDir: "ios-shell-web",
  server: {
    url: "https://golf-tournament-organizer-amore3.vercel.app",
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
