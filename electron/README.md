# Flights — desktop app (Electron)

Unlike the mobile shells, the desktop app bundles and runs the actual
Next.js server locally — full server actions, your real SQLite database,
no network dependency. This is the "full control" desktop experience.

## Try it right now (this machine, no build needed)

```
npm run dev
```
then, in a second terminal:
```
npm run electron:dev
```

This opens a real desktop window pointed at the same `npm run dev` server
(port 3000) that the browser tab and mobile shells use — so you can have
desktop, browser, and phone all open against the same live data at once.
It does not start its own copy of `next dev`: two dev servers sharing one
project's `.next` cache would corrupt each other's build.

## Building an installer

```
npm run electron:build
```

This runs `next build` with `output: "standalone"` (see
`next.config.mjs`), copies in the static assets + Prisma engine that
standalone mode leaves out (`electron/prepare-standalone.js`), then runs
`electron-builder` to produce an installer in `release/`.

- **Windows (.exe/NSIS)**: builds and runs fully on this machine.
- **Mac (.dmg)**: electron-builder needs to actually run on macOS to
  produce a Mac build (hdiutil/codesigning aren't available on Windows) —
  same class of constraint as the iOS app. Once you're on a Mac: clone the
  repo, `npm install`, `npm run electron:build`.

## How data persists

On first launch of a packaged build, the app copies the bundled starter
database into the OS user-data folder (`app.getPath("userData")`, e.g.
`%APPDATA%/Flights` on Windows) and points `DATABASE_URL` there — so
tournament data lives outside the installed app and survives updates or
reinstalls, and isn't shared with the dev database you test against day to
day.

## Code signing

Not set up — unsigned builds will trigger a Windows SmartScreen / macOS
Gatekeeper warning on first run (users can still choose to run it). Signing
requires a paid code-signing certificate; worth adding once you're ready to
distribute outside your own machine.
