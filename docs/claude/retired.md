# Retired paragraphs

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: history only. Index: `CLAUDE.md`.

> Retired (Superseded by the 2026-10-23 testing panel (#937): `qa:changed` no longer maps core to three rounds (core is ONE round plus the nightly; only money/handicap arithmetic keeps three), and the covered-figure bullet is restated in CLAUDE.md as a command to re-measure. The habits themselves live on in CLAUDE.md.)

- **`npm run qa:changed` first, on every finished change.** It reads the files touched and says
  how much testing that needs: nothing ships (tests), its own tests (words, the front door),
  one full round (function in one area), or three (core). Quote it in the pull request.
- **A change is not done until the tests know about it.** A new action needs a spec that DOES
  it as the person who would; a new format needs a scenario; a new language needs a line in the
  date table. `docs/testing.md` has the table of what to add for what, and
  `qa-framework.test.ts` holds the framework's own lists to the files on disk.
- **"Is everything covered?" is answered with the measured figure, never with the size of the
  suite.** End-to-end does NOT cover every action yet: 36 of 263 were performed by a browser
  test when last measured (2026-10-10). Every round re-measures it and names what nothing does.

> Retired (Superseded by Ajay's two rulings of 2026-11-06: "we can't waste time waiting this long. this kind of real tournament [freeze] we should do at the last when we have all other foundations and basic issues fixed", and "let's turn off that freez until Nov 20th". The freeze is now off until 20 Nov 2026 (`FREEZE_RESUMES`), then guards only pilot clubs while sign-ins are held, and is this paragraph's full rule again once accounts are live. CLAUDE.md carries the new wording.)

**SINCE 2026-10-23 THE STEPS ARE IN `deploy.yml`, BEHIND A GATE AND A FREEZE** (the testing
panel's item C). `ci.yml`'s `deploy` job calls it; so do the nightly round (after a clean
verdict), an hourly schedule and *Run workflow*. `scripts/qa/deploy-gate.mjs` deploys a commit
only when `verify` is green on it, every core commit since the last deploy is inside a clean
nightly round, and no club is in its FREEZE — a tournament on today in the club's own time, or a
weekend morning 05:00–14:00 in any club's zone. The freeze is asked of the APP
(`/api/deploy-window`, bearer `DEPLOY_WINDOW_TOKEN`, answering only `{frozen, reason}`), because
this runner must never hold production's database credentials (below); unreachable means not
frozen, said in the summary. A HOLD IS GREEN — the gate working — and the hourly run ships it
later. *Override freeze* is for emergencies and overrides only the freeze. What production holds
is recorded as a GitHub deployment to `tourneyhq-production`. The job's check is now named
`Deploy to production / Deploy to production`, so read it with `endswith`, as below.
