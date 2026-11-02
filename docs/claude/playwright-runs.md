# Running Playwright locally

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: running the e2e suite on this machine. Index: `CLAUDE.md`.

**And PLAYWRIGHT STARTS A BUILD YOU DID NOT TYPE.** `playwright.config.ts` sets
`webServer.command` to `npm run build && npx next start --port 3101`, so running the e2e suite
runs a build whether or not you asked for one.

**It does NOT collide with the dev server.** That build goes to `.next-e2e` —
`webServer.env` sets `NEXT_DIST_DIR` — so the rule above is already satisfied and you do not need
to stop the preview or delete `.next` first. This file used to say the opposite, in detail, and
it was wrong: read `webServer.env` before believing any claim about which directory it writes.

**The trap that IS real is `reuseExistingServer`.** It is `!process.env.CI`, so locally Playwright
will happily attach to whatever is already listening on 3101 and skip the build entirely. And a
Playwright run killed part-way does not take its `next start` down with it — the wrapper dies, the
server keeps listening.

So the shape to recognise is: kill a run, edit code, run again, and the second run **tests the
first run's build**. It passes or fails on code you have changed since, and nothing in the output
says so. On 2026-09-11 a run sat green-looking for six minutes against a build twenty-five minutes
older than the branch.

Two checks settle it in seconds, and are worth making before believing any local e2e result:

```bash
ls -la --time-style=full-iso .next-e2e/BUILD_ID   # older than your last edit? stale.
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3101/   # 200 before you start? stale.
```

The cleanup is to kill the listener and delete the directory, then run:

```bash
powershell -c "Get-NetTCPConnection -LocalPort 3101 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"
rm -rf .next-e2e
```

An earlier entry here blamed a red run — five `offline.spec` tests failing together, then the
whole of `organizer.spec` behind them — on dist-directory contention. The diagnosis was wrong; the
READING of the failure is still right and still worth keeping, because it is how you tell a dead
server from a real regression:

- every failure takes the SAME time (2.6s there), which is a timeout rather than an assertion;
- they CASCADE — everything from test 92 onward, not a scattered few;
- they take out WHOLE FILES, including ones unrelated to each other.

An assertion failure has an expected and a received value, and it does not bring its neighbours
down with it. So read that shape as "the server under it died", the same way `FAIL 0` is read
above — and note it looks nothing like any of the three intermittent e2e failures below, which is
why it is easy to start debugging the wrong thing.

**A build can still take the dev server down with it, and the smoke scripts then blame your
change.** Separate dist directories stop the two corrupting each other's output; they do not stop
the machine being busy enough that the dev server dies mid-run. On 2026-09-08 that happened four
times, always in the same shape: `next build` finishes, the smoke pass starts, and the first one
or two scripts report a route as `FAIL 0` or `[TypeError: fetch failed]` while a later one passes.

Read those two symptoms as "no server", not "broken route". A real 5xx has a status; `FAIL 0`
means nothing answered. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/` settles
it in a second — and note that an UNAUTHENTICATED curl of a console route correctly returns 307,
so a redirect there is the server working, not failing.

So run the smoke pass against a server you have just confirmed is up, and if a script reports a
transport failure, restart the preview and run the whole set again before believing any of it.
A green run after a restart on the same commit is the answer; half a red run is not evidence
about the code.

**And now the MECHANISM, read off `preview_logs` on 2026-09-09 rather than guessed at.** "The
machine being busy" above is the right instinct and not the actual event. Next restarts itself:

```
 ✓ Compiled /prizes in 1918ms (1197 modules)
 ⚠ Server is approaching the used memory threshold, restarting...
   ▲ Next.js 15.5.22
 ✓ Ready in 2.5s
```

That is the dev server deciding, on its own, that it is near its heap limit and starting a fresh
process — and it is MOST likely right after a build, because the smoke pass then walks 39 routes
and each one compiles. It takes a couple of seconds and it is invisible from outside except as
the `fetch failed` the scripts report.

Two things follow. `curl` before the run proves nothing about the middle of it, so a confirmed-up
server followed by a transport failure is this, not your change — do not go looking for the route.
And the answer really is just to run the set again: the process that comes back is healthy, the
same commit, and the second pass has the modules it needs already warm.

**The command at the top is FIVE SIXTHS of the gate. Playwright is the sixth**, and nothing
above it can see what it sees — a scorecard wider than its column, a target under the touch
minimum, a card that opens blank over a round already played, a date rendered in the wrong
words. It needs a database and about four minutes:

```bash
AUTH_SECRET=local-e2e-secret npx playwright test
```

Skipping it on an ordinary change is reasonable; CI runs it on every push. What is NOT
reasonable is skipping it and then saying a branch or `main` is verified. On 2026-09-05 `main`
was declared green after tsc, vitest, the audit config, lint and build all passed — and it was
RED, on an end-to-end test, and had been for twenty minutes. Running five of six and reporting
"the gate" is how a red `main` goes unnoticed, which this file has a whole section about.

It seeds a real fixture through `e2e/fixture.mjs` and tears it down afterwards, so it needs a
database it may write to. Never point it at anything but the development one.
