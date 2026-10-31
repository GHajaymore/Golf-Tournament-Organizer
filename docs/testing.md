# Testing TourneyHQ

How the app is tested, how much testing a change needs, and how the tests are kept true as the
app grows. The rules here are Ajay's; the machinery is in `scripts/qa/`.

> "I care more about functionality and operationality of the app that is the meat. anything
> surrounding it like documentations should not fail the app … I can understand if making any
> process flow or navigational thing impacting functionality may require thorough testing."
>
> "you should be building these permanent test script which covers all aspects of the app and use
> it whenever we make any change in the app. Keep it updated whenever we add any functionality."
>
> "make the testing efficient." — Ajay, 2026-10-13

Who decides: the QA lead decides what a round covers and what counts as a finding. The golf
professional and the tournament manager decide whether what a screen shows is right golf and right
operations — against the Rules, not against what the app did last week. The designer decides
whether it can be read and used.

## The four commands

| Command | What it answers | When |
|---|---|---|
| `npm run qa:changed` | What did this change touch, and how much testing does that need? | First, on every finished change. Quote it in the pull request. |
| `npm run qa:round -- <NAME>` | Is this app sound, all over? | Before function or core changes reach production. |
| `npm run qa:status` | How many clean rounds does this app have? | Whenever somebody asks. Never answer from memory. |
| The **Round** workflow on GitHub | The same round, its parts side by side, in under an hour | The normal way to run a whole round. |
| `node scripts/qa/burn-in.mjs` | Do the tests this change adds or touches pass every time, not most times? | Before a round is spent on them. See "What a round costs" below. |
| The **Breaks** workflow on GitHub | Does each new test go red when the app is broken the way it is meant to catch? | With every change that adds a test. See "Proving a test by breaking the app". |
| `npm run mutation` | Would the unit tests notice the foundation being broken, module by module? | The nightly round runs the arithmetic core with the ratchet on (the `mutation` layer); by hand after adding tests to a core module. See "How strong are the tests". |
| `node scripts/qa/retro.mjs --write` | What did the last rounds cost, whose failures were they, and which layers found anything? | When deciding to change the testing. See "The retro". |
| `node scripts/qa/quarantine.mjs` | Is every quarantined test sound and in date? | Before adding to `e2e/quarantine.json`; the nightly runs it. |

`ci.yml` is not on this list because nobody runs it: it runs itself on every push, on one browser,
and answers "did this change break something that was working". A round is a different question.
Nor are the **Nightly round**, the **Weekly round**, the hourly **Deploy** and the **Production
canary**: they run themselves on main (see "Rounds, nights and weeks" and "Deploys").

**Since 2026-10-23 the pipeline is the testing panel's** — rounds by tier, a nightly and a weekly,
the deploy gate and freeze, infrastructure that is "did not run", a quarantine, and three new checks.
The decision and its reasons are in `docs/testing-panel-2026-10-23.md`.

## How much testing a change needs

Decided by **what the change touches**, read off its files by `npm run qa:changed` — never by how
small the change is or what it is called. The first rule that matches a file decides it
(`TIER_RULES` in `scripts/qa/layers.mjs`); a file no rule knows is treated as core.

| Tier | What it is | Before production |
|---|---|---|
| **Tests and tooling** | `e2e/`, `scripts/qa/`, workflows, test files | The tests it changes, run. Nothing ships to anybody. |
| **Words and documents** | The guide, the player's Help, `docs/`, `CLAUDE.md` | Its own tests and CI. No round. |
| **The front door** | The landing page, FAQ, privacy, terms | The landing specs on three sizes, and CI. No round: its stylesheet cannot reach an app screen. |
| **Function in one area** | How a form reads what is typed, one action, one flow, one screen | A browser test for it, proven by breaking the code; CI; and **one round** (`round/<name>-1`) on the commit that will be production, before it merges. |
| **Core and shared** | Scoring, handicaps, money, draws and brackets, sign-in and access, the database, the shells and stylesheets every screen stands on, the build | Batch it, and **one round that visits all six countries** on the commit that will be production, before it merges. It then reaches production only once **the nightly round** on main, on that commit or a later one containing it, is clean — the deploy job holds it until then. |
| *Money or handicap arithmetic* (core) | `ARITHMETIC` in `layers.mjs` | **Three rounds**, all six countries, for now — until property-based tests and the nightly mutation ratchet are on main (`ARITHMETIC_KEEPS_THREE_ROUNDS`). And the nightly, as core. |

`npm run qa:changed` prints the exact rounds: the branches to push, the countries, whether the
console crawl is in them and which file asked for it, and whether the nightly gates production. The
Round workflow reads the same plan off the pushed branch, so push the branches it names and nothing
else. The crawl is in a change's round when it touches what a secretary types or picks (a console
screen or action, or a component or rule named for entry, handicaps, tees, scores, courses, members,
flights, formats and the like — `crawlNeeded`) and for every core change; otherwise the nightly runs it.

Three consecutive clean rounds is also the bar before go-live, whatever has changed.

**The count belongs to the app, not to the commit.** `scripts/qa/app-id.mjs` fingerprints every
file that is function or core. A commit that rewords the guide or recolours the front door has the
same fingerprint, so the count on it stands. Any change to a function or core file is a different
app, and its count starts at nothing.

## What a round is

`npm run qa:round -- --list` prints it from the source. Each layer says who it stands for, what is
really run, and what it cannot see — so a row in the report is never read as more than it is.

| Asked for | Layer | What is really run |
|---|---|---|
| Laptop, phone, Android | **The whole suite** | Chromium at 1280 wide, as a Pixel 5, and at 320 wide: every spec, every screen opened as each kind of person, every control operated and read back, every server action called by a stranger |
| Anybody typing into a box | **Every text box** | `e2e/every-text-box.spec.ts`: every text box on every console and player screen of every seeded tournament given empty, over-long, bad and good input, saved the way its screen saves, reloaded and read back, and put back as it was. Three shares, one machine each (`TEXT_PARTS`) |
| Nearly every visitor | **With the animation on** | The front door's specs with the page's motion left on. Every other layer asks for reduced motion, which almost nobody has set; a test about how a page looks at rest has to wait for rest |
| A club in another time zone | **Somewhere else** | Every screen again with the browser and the club on another calendar day from the server |
| US members and organizers | **An American club** | Every screen with the club in Indiana: dollars, the month first, American golf words |
| International | **Abroad** (three a round, or all six) | Every screen with the club in India, Japan, Australia, South Africa, Ireland — and a Scottish club read from a German browser. A function change's round visits three; a core change's round and the nightly visit all six |
| Tablet (Android) | **An Android tablet** | Chromium as a Galaxy Tab, upright and on its side, touch |
| Chrome, Edge | **As installed** | The real Chrome and the real Edge, not the test build |
| iOS | **An iPhone**, **Safari**, **An iPad** | WebKit — Safari's engine — as an iPhone 13, an iPhone SE, a Mac, and an iPad upright and on its side |
| Firefox | **Firefox** | The standing suite on Firefox at three sizes |
| Security, from outside | In **the whole suite** | `security.spec`: the headers every answer is sent in; that no screen opens signed out and nothing of a club comes back instead; that a "go on to" address cannot be another site; that no secret is in the scripts a browser downloads; that a name, a title, a club's colour and a notice are text wherever they are drawn; that another site cannot act as you; that a wrong address never shows the inside of the app. With `every-action-vs-a-stranger`, which calls every server action as the wrong person |
| Security, known holes | **Known holes in the libraries** | npm's advisory database, asked about everything a deployment installs. High or critical is a finding |
| Security, in the repository | Every push | `no-secret-is-committed.test.ts`: no tracked file carries a key, a token or an address with a password in it |
| Search engines, shared links | In **the whole suite** | `seo.spec`: each public page's title, description, one heading, language and its own canonical address; the share card and its picture; structured data that parses; a sitemap that lists exactly the public pages; and every private screen telling crawlers to keep out |
| People who cannot see it or use a mouse | In **the whole suite** | `a11y.spec`: axe, against WCAG 2.1 A and AA, on every public page, every organizer screen and every player screen |
| A weak signal | In **the whole suite** | `weight.spec`: what a phone downloads for the screens people open most, held to a budget (kept per platform: a build made on Windows hints no font, so GitHub's figure is the one production matches); `fonts.spec`, every font file a screen downloads is one it draws with; `slow-page.spec`, which delivers pages slowly on purpose; and `slow-signal-scoring.spec`, which holds every save back and scores ahead of them |
| The app doing its job | **Eleven tournaments, played** | Eleven tournaments of 110–120 invented players, entered, drawn, scored, cut, ranked and paid through the screens, with the results checked against the Rules of Golf and of Handicapping |

On one machine that is about six hours. On GitHub the same layers are cut into about thirty parts
(`partsFor` in `layers.mjs`), each with a machine and a database of its own and all drawing one
build, so a round takes as long as its slowest part.

### Rounds, nights and weeks

Not every layer runs in every round (the panel, 2026-10-23). Each layer says when (`when` in
`layers.mjs`; `npm run qa:round -- --list --schedule=pr` prints a schedule's layers):

| | Runs | Layers |
|---|---|---|
| **A change's round** (`pr`) | when a change pushes `round/<name>-N` | the whole suite, somewhere else, the American club, abroad, iPhone, Safari, iPad, Firefox, the eleven tournaments — and the console crawl when the change touches input screens |
| **The nightly** | 02:00 UTC on main (`nightly.yml`) | every `pr` layer, all six countries, the console crawl in full, the Android tablet, the libraries' holes and the quarantine's dates. When clean, it deploys what it cleared |
| **The weekly** | Sunday 03:00 UTC (`weekly.yml`) | Chrome and Edge as installed, the front door with its animation on |

`npm run qa:round` on one machine still runs every layer (`--schedule=all`) unless told otherwise.

### Does end-to-end cover everything? Not yet — and the gap has a number

Asked twice by Ajay on 2026-10-12, and the answer he is owed each time is the measured one, not
"the suite is large".

| | Covered by a browser test |
|---|---|
| Every screen opens, as organizer, member and signed out, on every seeded tournament | Yes — the lists are read from the app, so a new screen is included unasked |
| Every dropdown, choice and tick-box is changed, saved and read back | Yes |
| Every action is tried by the wrong person and refused | Yes |
| Whole tournaments played from entry to payout | Yes — eleven |
| **Every action done by the RIGHT person, with the result checked** | **No.** 36 of 263 on 2026-10-10; 127 of 272 in the first clean round (2026-10-13, commit `77d59567`), with 17 more performed by specs written after it. Every round re-measures it and names each action nothing performs |
| Every text box given good, bad, empty and over-long input | Yes, since 2026-10-21 — the **Every text box** layer (`e2e/every-text-box.spec.ts`). A box that appears only after a press the crawl does not make (a dialog, a second step), and a box behind a button that sends, deletes or spends an allowance, are not tried; each share lists them by name |
| Every figure a club can TYPE, in every language it can choose | Amounts, handicaps and course ratings: yes, since 2026-10-13 (`figures-are-read-in-every-language.test.ts`). Any other decimal somebody types: only once it goes through `minorUnitsFrom` or `decimalPoint` |

**What writing a spec per flow has found.** Ten flows were written in the two nights to
2026-10-13, and six of them found at least one fault on the first run — eight faults in all,
each of which every other layer had passed:
a pin that could not be cleared, commentary nobody but the committee could read, four screens
dating things by the server's day, a negative prize left standing in its box, "take 5.00" with no
currency, a stake read as a hundred times what a German club typed, a side bet started for
nothing a head, and a withdrawal whose confirmation was wiped before it could be read. That rate
has not fallen yet. So the reach figure is not a formality: the actions nothing performs are
where the next faults are, and a clean round says nothing about them.

**And it did not fall the next morning.** Four more areas were used in a browser for the first
time on 2026-10-13, and three held faults that were live: a club could only ever have one season,
and a second season wore the first one's rules; members who missed a cut were described as
entries with no roster record; the course editor refused a wrong card in a sentence that was not
on the screen; and one tap on a radio changed somebody's role at the club. The fourth, the
honours board, was right — and the test written for it was wrong about it, which is the other
thing a spec per flow finds.

**Two of those were one fault, and the round now looks for it everywhere.** A refusal printed at
the top of a long screen, under a press made at the bottom, is a button that appears to do
nothing. Every page of every browser test watches for words that look like a refusal, appearing
within four seconds of a press, with none of them on the screen (`watchRefusals` in
`e2e/coverage.ts`); `scripts/e2e-coverage.mjs` lists them beside the reach. It is a list to read,
not a count to fail on: an entry marked "red" was recognised by its colour alone, and a kitty
that is short is red too.

**Roughly thirteen actions cannot be performed here at all**, because they call a paid service
that a test must not reach: reading a card from a photograph (3), drafting words with the AI
(`draftMessage`, `suggestCommentary`, `suggestSetup`, `applySetupProposal`), Stripe
(`startCheckout`, `openBillingPortal`), a text to a whole club (`broadcastToScope`,
`broadcastWithText`) and push (`savePushSubscription`, `removePushSubscription`). They are refused
to the wrong person by the every-action sweep and held by database tests; "done by the right
person in a browser" will stay short of the whole by that many.

The fifth row is the work: a spec per flow, until the named list is empty. The figure is on the
testing board and in every round's verdict, and it is never quoted from memory — the ledger only
means anything against the build it was recorded on (`scripts/e2e-coverage.mjs` says so when the
two do not match).

**What no layer covers, and the report says so every time:** a real phone or tablet in a hand; the
App Store and Google Play builds (an iPhone here is Safari's engine with an iPhone's screen, on a
Linux machine); Safari and Firefox on a Mac or on Windows; push notifications on Safari's engine.
Those are checked by a person with the device.

## Running a round

**On GitHub — the normal way.** Push the branches `npm run qa:changed` names: `round/<anything>-1`
(and `-2`, `-3` when it says three; with three countries, the number decides which three). The plan
job reads the changed files against main and decides the countries and the crawl itself. Or use *Run
workflow* on the **Round** workflow and give the plan by hand. The verdict and the table are the
run's summary, and the summary says which kind of round it was and what it leaves to the nightly or
the weekly.

**A round the machine did not finish is re-run, not read.** When a verdict is INCOMPLETE, the
**Round waiter** workflow re-runs its failed jobs — exactly the parts the machine stopped — up to
the third attempt. Nothing else is re-run: NOT CLEAN is a finding.

**Reading what a part found.** The verdict lists every finding a part printed, not only the line
saying it failed — each of the text-box crawl's, by share. Each machine's own files are an artifact
named `part-<id>`, and inside it every file of the part's own is named by the part
(`.qa/rounds/<tag>/text-boxes-2of3.log`, `…-kept/` with the crawl's ledger of every try,
`summary-text-boxes-2of3.md`), so two parts fetched into one folder do not overwrite each other
(`partFile` in `layers.mjs`; until 2026-10-21 three shares wrote one `text-boxes.log`). Fetch
them one artifact to a folder with a short path: `gh run download <run> -n part-<id> -D <dir>`.

**Reading what a part found.** The verdict lists every finding a part printed, not only the line
saying it failed — each of the text-box crawl's, by share. Each machine's own files are an artifact
named `part-<id>`, and inside it every file of the part's own is named by the part
(`.qa/rounds/<tag>/text-boxes-2of3.log`, `…-kept/` with the crawl's ledger of every try,
`summary-text-boxes-2of3.md`), so two parts fetched into one folder do not overwrite each other
(`partFile` in `layers.mjs`; until 2026-10-21 three shares wrote one `text-boxes.log`). Fetch
them one artifact to a folder with a short path: `gh run download <run> -n part-<id> -D <dir>`.

**On one machine** — for one layer, or when a part needs looking at:

```bash
npm run qa:round -- T1 --build --only=suite          # database suite, fresh build, one layer
npm run qa:round -- T1 --only=scenarios --scenario=c # one tournament
npm run qa:round -- T1 --only=tablet-android
```

It refuses to start with uncommitted changes, or on a build made from a different app. Never two
at once on one machine. No edits to `src`, `e2e` or `scripts` while one runs, and no other build.

**Recording it.** `npm run qa:status -- --record <NAME>` writes a round's verdict into
`docs/qa-ledger.json`, which is committed. `npm run qa:status` then says how many consecutive
clean, all-over rounds the app that is checked out has. That file is the answer to "where are we
with testing" — with the commit, the reach and what was left out beside every count.

## What makes a round not clean

Any one of these, in any layer:

- a test that failed, was flaky, or did not run;
- a run that exited badly, or in which nothing passed (it tested nothing);
- a tournament that stopped part-way;
- a hydration mismatch recorded on any page, whether or not a test was looking at it;
- a server action no screen test calls that `scripts/qa/reach-baseline.json` does not already
  list — something added to the app without a test, or a test that was lost.

A layer that was left out or could not run makes a round **clean, but not all over**. It is said
that way and never rounded up. (A layer the KIND of round leaves to the nightly or the weekly is not
"left out": the summary names it, and where it runs.)

**INCOMPLETE — re-run** is the fourth verdict: no finding, but a part the MACHINE never ran — the
runner lost, the dependencies or the throwaway database not set up, the build not downloaded, the
browser not installed, a registry not reached (`scripts/qa/infra.mjs`, which says why only those).
It is evidence about nothing, so it is neither clean nor not clean, `qa:status` will not record it,
and the waiter re-runs it. A crashed browser, a timed-out test and a server that would not start
are NOT the machine: each has been the app before.

**A quarantined test still runs and does not count.** Zero retries stays. `e2e/quarantine.json`
lists tests known to be wrong about themselves — spec, test, owner, reason, an expiry at most 30
days out. The round reports each in a section of its own; an entry past its date quarantines nothing
and fails the nightly's check. It starts empty, and adding to it is a decision written in the pull
request, with the failing log beside it.

### What a finding costs

"Not clean" means *a finding*, not *the app failed*. Every finding is written down with what a
user would have seen, and then it is one of two things:

- **It touches function** — a wrong score, wrong money, wrong access, lost data, a flow that cannot
  be finished, a screen that cannot be used on a device people hold. It is fixed, the fix is a
  change like any other (so it has a tier), and the count restarts on the new app.
- **It is surroundings** — a word, a document, a picture on the front door, a cosmetic fault on one
  screen. It is fixed and that screen is re-tested. The fix does not change the app's fingerprint
  unless it has to touch a function or core file, so the count stands.

The second kind must not be used to wave through the first. If there is doubt about which it is,
it is the first.

## What a round costs, and how it is kept short

Ajay, 2026-10-13: "how can we reduce the testing time without impacting the testing
efficiencies". Measured that day on a clean round (35 parts):

| | |
|---|---|
| Machine time for one round | 445 minutes |
| Wall clock for one round | 74 minutes |
| Its longest part | 62 minutes: the laptop suite's first shard, which held the console crawl |
| Its next longest part | 34 minutes |
| A part's longest wait for a machine | 21 minutes, with three rounds pushed together |
| Rounds that week which stopped on a test's own mistake | 2 of the last 7; none of the 7 stopped on the app |

So three things, in order of what they save. None of them removes a test.

1. **A round is not spent on a test's own mistakes.** A test that is wrong about timing passes
   most of the time, so one run of it proves little. Before a round, `node scripts/qa/burn-in.mjs`
   runs every spec the change adds or touches five times at laptop and phone size, and each must
   pass every time. A round that stops on a new test costs that round and the one that confirms
   the fix: two hours, against the ten minutes this takes.
2. **A round takes as long as its slowest part, so no part is twice the others.** The console
   crawl is one test and `--shard` cannot cut a test, so it is cut by SCREEN into four parts
   (`E2E_CRAWL_PART`, `CRAWL_PARTS` in `layers.mjs`); the merge adds the four counts and holds the
   total to the crawl's own minimum. When a part grows past about thirty minutes, cut it the same
   way rather than waiting on it. The text-box crawl (2026-10-21) was built cut: it is one test per
   share, so `--shard` splits it exactly, into `TEXT_PARTS` parts of its own layer.
3. **Nothing is run twice for no reason.** The every-push checks do not run on a `round/**`
   branch: a round is a push of a commit that already has its pull request's checks.

**Measured again the same evening, with all three in and forty machines** (Ajay upgraded the
account; `round/league-1`, 39 parts):

| | |
|---|---|
| Wall clock for one round | 39 minutes, for the same checks and eight more |
| The build and the database suite every part waits for | 6 minutes |
| Its longest part | 33 minutes: Firefox at laptop size |
| Its next longest | Firefox phone 30, the iPhone 30, the iPad 27, Chrome 24, the Android tablet 23, Firefox small phone 22, Safari 21 |
| A share of the console crawl, which had been 62 | 16 minutes |
| Everything in the standing suite itself | 16 to 19 minutes a part |

So the limit had moved, as rule 2 says it will: to the other browsers, each still running a whole
suite on one machine. Ajay, that evening: "the test round you promised me was 35 mins. why its
taking so long?" Those eight parts are cut in two by `--shard` (`SHARDS` in `layers.mjs`), which
puts the longest part at about seventeen minutes and a round at about twenty-five. **When a round
is slower than it was said to be, measure the parts before explaining it**: the first answer that
came to mind that evening was the queue, and the queue was nought.

4. **A deliberate break is proven on a machine of its own, not one after another on a desk.**
   A browser test is only worth its green if the app, broken, turns it red, and that takes a
   build per break. Eighteen of them run one at a time on the machine the app is written on took
   eighty-five minutes and held its working tree the whole time. `breaks.yml` gives each break a
   machine: push the list to a `breaks/**` branch (see "Proving a test by breaking the app").

What decides the time of THREE rounds pushed together is machine time over the machines the
account may use at once: about 1,400 minutes over forty is 35 minutes of queue-free running, so
three rounds together finish in a little over the time of one and a half.

**What is not on the list, deliberately:** fewer browsers, a shorter crawl, or re-running a failed
part until it passes. Each of those is where a fault this suite found was found. (Fewer rounds for a
core change WAS decided on 2026-10-23 — one round of all six countries and the nightly before
production, with three kept for money and handicap arithmetic until the instruments that look along
those axes exist. Nothing stopped being tested; the layers that left a change's round run every
night or every week. See `docs/testing-panel-2026-10-23.md`.) And a part the MACHINE did not run is
re-run, which is not re-running a failure: it never got as far as a test.

## Deploys: the gate and the freeze

`deploy.yml` is the only way into production (called by `ci.yml` after `verify`, by the nightly
after a clean round, hourly, and by hand). It deploys a commit when `verify` is green on it, every
core commit since the last deploy is in a clean nightly round, and no club is in its freeze — a
tournament on today in the club's own time, or Saturday and Sunday 05:00–14:00 in any club's zone.
The app answers the freeze itself (`/api/deploy-window`, `{ frozen, reason }` only), because the
runner may not hold production's database credentials. A held deploy is green and says why; the
hourly run picks it up. *Override freeze* on *Run workflow* is for emergencies and overrides the
freeze only — a core fix that cannot wait runs the Nightly round by hand.

Two more read-only watchers: the **Production canary** every hour (the public doors and one public
board; a failed run is GitHub's email to whoever last changed its schedule), and the shotgun load
test (`scripts/load/README.md`: 144 players and 300 phones, against a preview with a
production-sized database — never production).

## The retro

`node scripts/qa/retro.mjs --last=20 --write` is how the testing is refined from evidence rather
than memory (Ajay's standing order: "keep learning and refining the testing approach and keep making
it efficient"). Every round's verdict job writes `retro.json` beside its verdict — wall-clock and
runner-minutes, parts, each failure classed **app / test / infrastructure**, assertion failures per
layer, flaky and quarantined counts — and the retro reads the last N back from GitHub with time to
merge per pull request, runner-minutes per round, the infrastructure share of failures, which layers
found real defects and which found nothing (candidates to move to the nightly or the weekly — for the
panel to decide), and the mutation score once `mutation-baseline.json` exists. It writes
`docs/testing-retro.md`; commit that when it is used to argue a change.

## Proving a test by breaking the app

A test is only worth its green if the app, broken, turns it red. Every change that adds a test
breaks the code it covers, watches the test fail, and puts the code back (`CLAUDE.md`, "Prove a
new test can fail"). For a browser test that is a build per break, so it is not done on a desk:

1. Commit the work. A break is judged against that commit, and is undone with `git checkout`.
2. Write the list: a JSON array, one entry a break. `scripts/qa/breaks.mjs` says what an entry
   holds: the file, the one line to change and what to change it to, and the tests that should
   notice (a browser spec, unit tests, database tests).
3. `node scripts/qa/breaks.mjs --check <list>` says whether every break would apply, before any
   machine is spent. Then, on a branch named `breaks/<anything>`, on top of that commit, commit the list as
   `qa-breaks.json` at the root, and push. The **Breaks** workflow gives every break a machine and
   a database. The branch is thrown away afterwards; the list is never merged.
4. Read the verdict. A job is GREEN when a test went red, so a red job is a break the tests missed.

| Result | What it means |
|---|---|
| CAUGHT | A test the break names failed — and the same tests PASS with nothing broken, which the run checks first on a machine of its own (job 0). If they do not, the verdict says NOTHING PROVEN: a break "caught" by a test that was already red proves nothing, and the first browser list this workflow was given did exactly that. |
| NOT CAUGHT | They all passed. Either the tests cannot see that fault, or the break changes nothing anybody would notice. Work out which and write it in the pull request; do not assume. |
| NOT APPLIED | The line was not found exactly once, so nothing was broken. Never read this as "not caught". |
| DOES NOT COMPILE | The type checker refused the break, so nothing ran. Rewrite the break. |
| DID NOT RUN | A browser test's build or server failed. A break that leaves a variable unused fails the build's lint: keep it used (`x * 0`, `x && ""`). |

One break on a desk, to see it work before pushing a list: `node scripts/qa/breaks.mjs --run=1
qa-breaks.json`. Quote the count in the pull request, with every break that was not caught explained.

## How strong are the tests: properties and mutation

Ajay, 2026-10-23: "I need the foundation / backbone of the app really strong and tested." Two
instruments answer a question a green suite cannot — not "did the tests pass" but "would they have
noticed".

**Property tests** (`src/lib/domain/__tests__/properties-*.test.ts`, fast-check). Each states a
Rule — of Handicapping, of Golf, of a side game, of money — and checks it over thousands of
generated cases against the same Rule worked a second way, in whole numbers, in
`properties-reference.ts`: a Course Handicap as an exact fraction over 1130, strokes handed out one
at a time from stroke index 1, a match walked hole by hole the way a referee walks the card. Fixed
seeds, so a run is the same run on every machine. **A failure fast-check shrinks is pinned as an
ordinary test** beside the property (the first one found a margin no match can finish on —
"6&3" — accepted and stored as 5&4). When you change a rule they cover, run them; when you add a
rule, add its property, worked by a route the code does not take.

**Mutation testing** (`npm run mutation`, Stryker, `stryker.config.mjs`). It breaks the foundation
one small change at a time — a `<` made `<=`, a `+ 1` made `- 1`, a condition made `true` — in the
modules that hold a rule (handicap, strokes by stroke index, a card's points and to-par, a match,
ranking and countback, the cut, the draw, money, a round's allowance, the club's dates) and runs
the unit suite against each. A change no test notices SURVIVED. The score per module is the share
that were noticed.

| Command | What it does |
|---|---|
| `npm run mutation` | the whole set; hours on one machine (incremental: a second run re-tests only what changed) |
| `npm run mutation -- --mutate src/lib/domain/money.ts` | one module, minutes |
| `npm run mutation -- --report-only` | the scores of the last run, from `reports/mutation/mutation.json` |
| `npm run mutation -- --scope=arithmetic` | the arithmetic core only (`ARITHMETIC_CORE` in `scripts/qa/mutation-ratchet.mjs`) — what the nightly runs |
| `npm run mutation -- --ratchet` | the same, and FAILS if any module in scope is below `mutation-baseline.json` |
| `npm run mutation -- --write-baseline` | RAISE the floors of the modules in scope to this run's scores — after the tests that earned them. A floor is never lowered by the script: a lower score is said and the old floor kept |

It is **not in `ci.yml`**: a run is too long for every push. It is a NIGHTLY RATCHET (since
2026-10-31, backlog A7): the nightly round's `mutation` layer runs
`node scripts/mutation.mjs --scope=arithmetic --ratchet --quiet --concurrency 4` — handicap, a
round's allowance and figure, strokes by stroke index, a side's strokes, the split to the cent,
skins and the skins split — and the score of each module may rise and may never fall below its
floor. A fall is one finding per module in the verdict; the score line is printed under the reach
(`**Mutation score:**`) and kept in the round's `retro.json`. Stryker's incremental file is kept
between nights (`round.yml`'s cache), so a night re-tests only the mutants whose code or covering
tests changed. `gameNets`, the sink every side game's money passes through, reads the database and
is out of the unit suite's reach: the audit suite holds it. The rest of the foundation is still run
by hand (`npm run mutation`). The floors started at the first measured score per module
(2026-10-23, `docs/foundation-pass-2026-10-23.md`). The unit suite runs whole under it except three
files that cannot run in Stryker's sandbox, listed with their reasons in `vitest.mutation.config.ts`.

**A timeout counts as caught only when Stryker stopped an endless loop** (its "hit limit"). A
timeout because the tests merely ran slowly depends on the machine's load, and counts as not
caught: on 2026-10-31 three equivalent mutants in `skins.ts` were timeouts in one run and survivors
in the next, and `skins.ts` read 96.77% one night and 91.94% the next with nothing changed. The
arithmetic core's floors were re-measured under this rule that day; the other modules' floors are
still the 2026-10-23 figures, counted the old way (every timeout caught), so re-measure them before
relying on `npm run mutation -- --ratchet` over the whole set.

**Lowering a floor** is a hand edit of `mutation-baseline.json`, in a commit that says which
survivors were read and why they are not golf (an equivalent mutant, a word in an explanation).
`mutation-ratchet.test.ts` holds the ratchet itself: a drop fails, an unmeasured module fails, a
module with no floor fails, and writing a baseline never lowers one.

**In a worktree whose `node_modules` is a junction** Stryker finds no `node_modules` to link into
its sandbox (it skips links), and `font-hosts.test.ts` fails the dry run. Make `node_modules` a real
folder of junctions, one per package, instead of one junction for the whole folder.

Read a survivor before writing a test for it. Some are EQUIVALENT — the change does nothing a
golfer could see (a `>=` that can only ever meet a strict case) — and a test written to kill one
asserts nothing about golf. A survivor in strokes by stroke index or in money is a real gap until
shown otherwise.

## Keeping it true when the app changes

A change is not finished until the tests know about it. What to add, by what was added:

| You added | Add |
|---|---|
| A screen | Nothing for the walk or the layout sweep — they read the screens from the filesystem. Its guide and Help lines (`CLAUDE.md`, "Help and docs travel with the change"). |
| An action, a form, a flow | A spec in `e2e/` that **does** it as the person who would, and reads the result back. Prove it can fail: break the code, watch it go red, put it back. Until it exists the next round reports the action as *no screen test calls it* — a finding, not a note. |
| A format, a draw, a cut, a money rule | A scenario in `e2e/scenarios/`, or a phase in one: a tournament of that kind played by a full field, with a check against the Rules rather than against the app. List it in `SCENARIOS`. And the cell in `src/lib/__tests__/matrix.test.ts`. And its property in `src/lib/domain/__tests__/properties-*.test.ts`, worked by a route the code does not take — and for a money rule, its row in `SIDE_GAME_PAYS` (when its amount may be reported) and a case worked by hand in `side-games-by-their-own-rules.test.ts`. |
| A country, a currency, a language | A language's dates are the app's own: add its tag to `TAGS` in `scripts/build-date-words.mjs`, run it, **read the new line by eye** (it is what a club will see), and only then offer it in `LOCALES` — `date-words.test.ts` refuses a tag the picker offers and the table does not hold. The row in `LOCALES` / `CURRENCIES` is then swept by `formats-agree`. A place for the seeded club is a line in `scripts/seed-club.mjs` and in `ABROAD`. |
| A date or a time on a screen | Nothing new: write it with `formatDay` / `formatDayAt` / `formatMonthDayAt` / `formatDayRange` / `formatClock` / `shortDate`. A screen that asks the platform to word one itself is refused by `date-words.test.ts`, because two browsers word it two ways. |
| A box with no Save button | `onKeyDown={leaveOnEnter}` above its `onBlur` (`src/lib/leave-on-enter.ts`), so Enter keeps what was typed. `saves-on-leave-saves-on-enter.test.ts` finds every box that acts when it is left and holds it to that, or to a stated reason. |
| A sentence that says no | Print it beside the press it answers, with `role="alert"` (and the shared `form-error` class), never in one line at the top of a long screen. The spec that provokes it asserts `toBeInViewport()` as well as `toBeVisible()`; the round lists any refusal that appeared off the screen. |
| A national handicap body, or a word about one | Its row in `HANDICAP_BODIES` (`src/lib/domain/handicap-body.ts`) with what its members' numbers are called, and its country in `defaultHandicapBody` — the body follows the club's COUNTRY, never a picker and never an American default. A line in the country table of `a-club-names-its-own-handicap-body.test.tsx`, and the place in `PLACES` in `e2e/handicap-body.spec.ts`, which reads Club settings, Members and Entries for it. A sentence that names the body takes it as an argument (`refuseHandByHand`, `handicapStanding`), never the word "GHIN". |
| A screen behind a plan | A spec that opens it on a club that HAS the plan. The seeded club is on Birdie; the e2e fixture's club is on none, so a spec there gives it a plan row for as long as it runs and takes it away again (`seasons.spec.ts`). |
| A figure a board prints (a net, a handicap, points, money) | A spec that works the figure out **for itself**, from the stored rows and the Rule, and holds the board to it — never by calling the app's own function, and never by accepting two answers. Use a field where a wrong method gives a different figure, and assert that it does (a control), or the check cannot fail. A golfer's index has a decimal place: a fixture of whole-number handicaps cannot tell rounding first from rounding last, which is how a stroke's error for one player in five sat under 11,800 green tests (`e2e/team-allowance.spec.ts`, `allowance-is-taken-of-the-exact-figure.test.ts`). |
| An allowance, a share, any percentage of a handicap | Take it with `playingHandicapFrom(exact, pct)`, of the figure BEFORE rounding (`CourseHandicaps.exact`, `resolveRoundHandicap().exact`, a side member's `handicapExact`). The sweep in `allowance-is-taken-of-the-exact-figure.test.ts` reads every caller and refuses the arithmetic written out by hand. |
| A block inside an answer or a page that shares the landing chrome | A rule for its class in `lib/landing/styles.ts` (`landing-answers-are-dressed.test.ts` refuses a class with none), and a look at it OPEN in a browser: `e2e/faq-blocks.spec.ts` measures the three the questions page has. |
| Anything in the seeded club (`scripts/seed-club.mjs`), or a control on a console screen | Before a round, the crawl, locally: `E2E_EVERYTHING=1 npx playwright test e2e/every-control.spec.ts e2e/everything.spec.ts --project=desktop`. The ordinary local run leaves it out because it takes most of an hour, and it is the one layer that reads every control on every seeded tournament. Putting the seeded club on a paid plan unlocked one tick-box, the crawl lost track of it, and a round of thirty-four parts was spent finding that out (2026-10-13). `E2E_ONLY_EVENT=<slug> E2E_ONLY_SCREEN=<name>` narrows it to one screen in a few minutes. |
| A printed document, or anything new on one | One renderer: a page kind in `services/print-kit.ts` (its data, sealed with `seal`, so the fingerprint covers what it prints) and its drawing in `components/print/PrintPages.tsx` — never a second print button on a screen. Its count, its page size and the QR on it in `e2e/print-kit.spec.ts` (a page per sheet in the PDF at A4 and Letter, nothing running off a page, every QR decoded, `paperRefusals` over every text); any stroke it prints in `print-kit-paper-equals-screen.audit.test.ts`, hole by hole against the score-entry screen. Decisions: `docs/print-kit-panel-2026-10-23.md`. |
| A text box | Nothing new: the text-box crawl finds it. Run its share locally before a round: `E2E_EVERYTHING=1 E2E_TEXT_BOXES=1 npx playwright test e2e/every-text-box.spec.ts --project=desktop` (add `--shard=k/6` for one share, `E2E_TEXT_SHARES=1` for the whole crawl as one test, `E2E_ONLY_SCREEN` / `E2E_ONLY_BOX` to narrow it, `E2E_TEXT_INVENTORY=1` to list the boxes without typing). Give the box a `maxLength` where the server keeps only so many characters, or the crawl reports it **cut silently**; say a refusal beside the press, or it reports **refused out of view**. Where the crawl reports a fault on a screen that is right, prove it from the screen and fix how it READS (`e2e/text-box-reading.ts`, with a case in `text-box-reading.test.ts`): ten of its first eleven findings were its own. |
| Anything on the front door | `await landingSettled(page)` before measuring or pressing: the page grows by thousands of pixels when its script starts (`e2e/landing-settled.ts`). |
| A kind of file nothing here names | A line in `TIER_RULES`. Until then it is treated as core, which is the safe mistake. |
| A new money or handicap rule file | Its path in `ARITHMETIC` (`layers.mjs`) while `ARITHMETIC_KEEPS_THREE_ROUNDS` is on; `qa-pipeline.test.ts` holds every listed file to existing and being core. |
| A new input screen whose file name says nothing of input | A word in `CRAWL_WORDS`, or the console crawl will be left out of the rounds of changes to it. |
| A layer, or a change to when one runs | Its `when` in `layersFor`, and the table in "Rounds, nights and weeks" — and the panel's say, recorded beside `docs/testing-panel-2026-10-23.md`. |

Three tests hold this page to the code (`src/lib/__tests__/qa-framework.test.ts`): every scenario
file is listed and every listed file exists; the parts of a round add up to exactly its layers;
and every file named as core exists — so a rename cannot quietly demote the scoring engine to
"function in one area".

`scripts/qa/reach-baseline.json` is the list of server actions no screen test calls yet. It may
only get shorter. Shortening it — writing the test that reaches one — is the most useful testing
work there is: a clean round says the paths walked behaved, and that list is the paths nobody
walked.
