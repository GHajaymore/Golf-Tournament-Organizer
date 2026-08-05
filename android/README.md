# TourneyHQ — Android shell

Same architecture as the iOS shell (`../ios/README.md`): a thin native
WebView pointed at the live server via `capacitor.config.ts`'s `server.url`
— no offline bundle, since TourneyHQ needs its Next.js server (server
actions, Prisma/SQLite, cookie auth) running.

Unlike iOS, this one **can be built and run directly from this Windows
machine** — Android Studio and its emulator are Windows-native, no Mac
required.

## Running it

1. Install [Android Studio](https://developer.android.com/studio) if it
   isn't already on this machine (it bundles the Android SDK, and its own
   bundled JDK — no separate JDK install needed if you're building through
   the IDE). Building from the command line instead (`gradlew`) needs
   **JDK 21+** on `JAVA_HOME` — this project's Capacitor Android library
   requires source/target compatibility 21; JDK 17 fails with `invalid
   source release: 21`.
2. Confirm `capacitor.config.ts`'s `server.url` points at a server your
   emulator/device can reach — the LAN address `next dev` prints under
   `Network:` (e.g. `http://192.168.x.x:3000`) works for the Android
   Emulator too. A physical device needs to be on the same Wi-Fi network.
3. `npm run cap:sync` to pull the current web config into the native
   project, then `npm run cap:open:android` — this opens the project in
   Android Studio.
4. Pick an emulator (or a plugged-in device with USB debugging on) and hit
   Run. That's a real native Android app running TourneyHQ.

`android:usesCleartextTraffic="true"` is set in `AndroidManifest.xml` to
allow the local `http://` dev server — narrow that (or drop it entirely)
once there's a real HTTPS deployment to point at, since Google Play flags
apps that ship with cleartext traffic enabled unnecessarily.

## Distributing to the Play Store

`.github/workflows/android-release.yml` builds a signed release bundle
(and can upload it straight to Play Console) from a GitHub-hosted runner —
no Android Studio needed once it's configured. It needs a Play Developer
account ($25 one-time), an app record + store listing, an upload keystore,
and a Play Console service account, all supplied as GitHub secrets; see the
comments at the top of that workflow file for the exact list.
