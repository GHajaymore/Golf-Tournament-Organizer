# TourneyHQ — iOS shell

This is a Capacitor-generated Xcode project. It's a thin native WebView that
loads the live TourneyHQ server (see `capacitor.config.ts` at the repo root) —
there's no offline/static build here, since TourneyHQ relies on server actions,
Prisma/SQLite and cookie auth that can't run inside a static bundle.

## Running it (requires a Mac with Xcode — cannot be done from Windows)

1. Copy or clone this whole repo onto a Mac.
2. On the Mac: `npm install`, then `npx cap sync ios` (also available as
   `npm run cap:sync`) to pull the web config into the native project.
3. Make sure `capacitor.config.ts`'s `server.url` points at a server your
   iPhone/Simulator can actually reach:
   - **Local testing**: run `npm run dev` on the machine hosting the
     database, note the `Network:` address it prints (e.g.
     `http://192.168.x.x:3000`), and put that in `server.url`. The
     Simulator/device must be on the same Wi-Fi network.
   - **Once there's a real deployment**: point `server.url` at that HTTPS
     URL instead, and remove `cleartext: true` — cleartext HTTP is only
     for local dev and Apple will reject a store submission that ships
     with it enabled.
4. Open `ios/App/App.xcodeproj` in Xcode. (This project uses Swift Package
   Manager for its Capacitor dependency, not CocoaPods — there's no separate
   `.xcworkspace` to look for; the `.xcodeproj` is the right thing to open.)
5. In the App target's Signing & Capabilities tab, sign in with your Apple
   ID / team (you mentioned you already have an Apple Developer account) and
   pick a signing team.
6. Choose a Simulator (or your plugged-in iPhone) as the run destination and
   hit Run. That's a real native app window running TourneyHQ.

## Distributing to the App Store

`.github/workflows/ios-testflight.yml` builds, signs, and uploads to
TestFlight on a GitHub-hosted Mac runner — no local Mac needed once it's
configured. It needs App Store Connect setup first (app record, distribution
certificate + provisioning profile, an API key) and several secrets in the
GitHub repo; see the comments at the top of that workflow file for the exact
list. It hasn't been run against real credentials yet, so expect to iterate
on it once you have a real CI run to look at.
